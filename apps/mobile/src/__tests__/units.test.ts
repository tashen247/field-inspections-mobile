import { VEHICLE_TEMPLATE } from '@fim/shared';
import {
  createDraft,
  setAnswer,
  setSignature,
  upsertJobs,
  upsertTemplates,
  claimDevice,
  enqueue,
  backoffMs,
  nextReadyOps,
  listOutbox,
} from '../db/repo';
import { createTestDb } from '../db/test-db';
import { targetSize } from '../features/camera/process';
import { shotPlan } from '../features/camera/shots';
import { watermarkLines } from '../features/camera/watermark';
import { ApiError, NetworkError, createApiClient } from '../lib/api';
import { draftIssues } from '../sync/submission';
import { TEMPLATE, makeInspection } from './fakes';

jest.mock('expo-image-manipulator', () => ({}));
jest.mock('@shopify/react-native-skia', () => ({}));

describe('photo helpers', () => {
  it('builds a SAST timestamp and hemisphere-aware GPS watermark', () => {
    const lines = watermarkLines({
      takenAt: new Date('2026-10-30T08:15:30Z'),
      lat: -33.96081,
      lng: 25.60221,
      accuracy: 6.4,
      caption: 'INS-1 · VIN plate',
    });
    expect(lines).toEqual([
      'INS-1 · VIN plate',
      '2026-10-30 10:15:30 SAST · 33.96081°S 25.60221°E ±6 m',
    ]);
    expect(
      watermarkLines({
        takenAt: new Date(0),
        lat: null,
        lng: null,
        accuracy: null,
        caption: 'x',
      })[1],
    ).toMatch(/GPS unavailable$/);
  });

  it('caps the long edge at 1600 px', () => {
    expect(targetSize(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(targetSize(3000, 4000)).toEqual({ width: 1200, height: 1600 });
    expect(targetSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('walks the guided shot sequence', () => {
    const first = shotPlan(VEHICLE_TEMPLATE, 'exterior_overview', 'front_left', []);
    expect(first?.label).toBe('Front-left');
    expect(first?.next?.key).toBe('front_right');
    expect(first?.remainingRequired).toBe(3);
    const last = shotPlan(VEHICLE_TEMPLATE, 'exterior_overview', 'rear_right', [
      { itemKey: 'exterior_overview', shotKey: 'front_left' },
      { itemKey: 'exterior_overview', shotKey: 'front_right' },
      { itemKey: 'exterior_overview', shotKey: 'rear_left' },
    ]);
    expect(last?.next).toBeNull();
    expect(shotPlan(VEHICLE_TEMPLATE, 'odometer', null, [])?.label).toBe(
      'Odometer reading (extra photo)',
    );
    expect(shotPlan(VEHICLE_TEMPLATE, 'nope', null, [])).toBeNull();
  });
});

describe('required-field validation on the device', () => {
  it('lists what is missing until the draft is complete', () => {
    const { db } = createTestDb();
    const job = makeInspection();
    upsertTemplates(db, [TEMPLATE]);
    upsertJobs(db, [job]);
    createDraft(db, job, {
      startedAt: new Date().toISOString(),
      lat: null,
      lng: null,
      distanceM: null,
    });
    const before = draftIssues(db, job.id);
    expect(before.some((i) => i.kind === 'signature_required')).toBe(true);
    expect(before.find((i) => i.itemKey === 'odometer' && i.kind === 'required')).toBeTruthy();

    setAnswer(db, job.id, 'odometer', 120000);
    setSignature(db, job.id, {
      fileId: 'f',
      uri: 'file:///s.png',
      size: 10,
      signedName: 'A',
      signedAt: new Date().toISOString(),
    });
    const after = draftIssues(db, job.id);
    expect(after.find((i) => i.itemKey === 'odometer' && i.kind === 'required')).toBeUndefined();
    expect(after.some((i) => i.kind === 'signature_required')).toBe(false);
  });
});

describe('outbox ordering and device ownership', () => {
  it('gates later ops of an inspection behind the first, but runs uploads side by side', () => {
    const { db } = createTestDb();
    const now = new Date('2026-10-30T10:00:00Z');
    enqueue(db, { inspectionId: 'a', kind: 'submit', payload: {}, idempotencyKey: 'k1' }, now);
    enqueue(db, { inspectionId: 'a', kind: 'upload', payload: {}, idempotencyKey: 'p1' }, now);
    enqueue(db, { inspectionId: 'b', kind: 'upload', payload: {}, idempotencyKey: 'p2' }, now);
    enqueue(db, { inspectionId: 'b', kind: 'upload', payload: {}, idempotencyKey: 'p3' }, now);
    expect(nextReadyOps(db, now).map((o) => o.idempotencyKey)).toEqual(['k1', 'p2', 'p3']);
    expect(backoffMs(1)).toBe(5000);
    expect(backoffMs(20)).toBe(600000);
  });

  it('will not hand the device to another user while work is unsynced', () => {
    const { db } = createTestDb();
    expect(claimDevice(db, 'user-1').ok).toBe(true);
    enqueue(db, { inspectionId: 'a', kind: 'submit', payload: {}, idempotencyKey: 'k' });
    expect(claimDevice(db, 'user-2').ok).toBe(false);
    expect(listOutbox(db)).toHaveLength(1);
    expect(claimDevice(db, 'user-1').ok).toBe(true);
  });
});

describe('api client', () => {
  function fakeFetch(responses: Array<{ status: number; body?: unknown } | Error>) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fn = jest.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const r = responses.shift();
      if (!r) throw new Error('no more responses');
      if (r instanceof Error) throw r;
      return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
        status: r.status,
      });
    });
    return { fn: fn as unknown as typeof fetch, calls };
  }

  it('refreshes an expired token once and retries the request', async () => {
    let tokens = { accessToken: 'old', refreshToken: 'r'.repeat(30) };
    const f = fakeFetch([
      { status: 401, body: { code: 'UNAUTHORIZED', message: 'expired' } },
      { status: 200, body: { accessToken: 'new', refreshToken: 's'.repeat(30), expiresIn: 900 } },
      { status: 200, body: { items: [] } },
    ]);
    const api = createApiClient({
      baseUrl: 'http://api',
      fetch: f.fn,
      tokens: { get: () => tokens, set: (t) => void (tokens = t), clear: jest.fn() },
    });
    await expect(api.templates()).resolves.toEqual({ items: [] });
    expect(f.calls.map((c) => c.url)).toEqual([
      'http://api/v1/templates',
      'http://api/v1/auth/refresh',
      'http://api/v1/templates',
    ]);
    expect(new Headers(f.calls[2]!.init.headers).get('authorization')).toBe('Bearer new');
  });

  it('distinguishes network failures, conflicts and permanent errors', async () => {
    const f = fakeFetch([
      new TypeError('Network request failed'),
      {
        status: 409,
        body: {
          code: 'VERSION_CONFLICT',
          message: 'c',
          details: { reason: 'modified', baseVersion: 1, current: makeInspection() },
        },
      },
      { status: 422, body: { code: 'VALIDATION_FAILED', message: 'bad' } },
    ]);
    const api = createApiClient({
      baseUrl: 'http://api',
      fetch: f.fn,
      tokens: { get: () => null, set: jest.fn(), clear: jest.fn() },
    });
    await expect(api.templates()).rejects.toBeInstanceOf(NetworkError);
    const conflict = await api.templates().catch((e: ApiError) => e);
    expect(conflict).toBeInstanceOf(ApiError);
    expect((conflict as ApiError).conflict?.reason).toBe('modified');
    const bad = await api.templates().catch((e: ApiError) => e);
    expect((bad as ApiError).permanent).toBe(true);
  });

  it('sends the idempotency key on submission', async () => {
    const f = fakeFetch([{ status: 200, body: {} }]);
    const api = createApiClient({
      baseUrl: 'http://api',
      fetch: f.fn,
      tokens: { get: () => null, set: jest.fn(), clear: jest.fn() },
    });
    await api.submit('id-1', {} as never, 'key-123');
    expect(new Headers(f.calls[0]!.init.headers).get('idempotency-key')).toBe('key-123');
    expect(f.calls[0]!.init.method).toBe('PUT');
  });
});
