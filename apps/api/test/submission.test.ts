import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  damagePins,
  idempotencyKeys,
  inspectionAnswers,
  inspectionPhotos,
  reviewEvents,
} from '../src/db/schema.js';
import {
  ASSESSOR_JHB,
  ASSESSOR_PE,
  MANAGER,
  bearer,
  completeSubmission,
  createJob,
  login,
  setupTestApp,
  submit,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
let assessor: string;
let manager: string;

beforeAll(async () => {
  ctx = await setupTestApp();
  assessor = (await login(ctx.app, ASSESSOR_JHB)).accessToken;
  manager = (await login(ctx.app, MANAGER)).accessToken;
});
afterAll(() => ctx.close());

describe('start', () => {
  it('records the start, checks the 200 m geofence and is safe to repeat', async () => {
    const job = await createJob(ctx, manager);
    const far = await ctx.app.inject({
      method: 'POST',
      url: `/v1/inspections/${job.id}/start`,
      headers: bearer(assessor),
      // ~1.1 km north of the address
      payload: {
        startedAt: '2026-10-30T08:00:00.000Z',
        location: { lat: -26.0966, lng: 28.0567, accuracy: 10 },
      },
    });
    expect(far.statusCode).toBe(200);
    const body = far.json();
    expect(body.withinGeofence).toBe(false);
    expect(body.distanceMeters).toBeGreaterThan(1000);
    expect(body.distanceMeters).toBeLessThan(1200);
    expect(body.inspection).toMatchObject({
      status: 'in_progress',
      version: 1,
      startedAt: '2026-10-30T08:00:00.000Z',
    });

    const again = await ctx.app.inject({
      method: 'POST',
      url: `/v1/inspections/${job.id}/start`,
      headers: bearer(assessor),
      payload: { startedAt: '2026-10-30T09:00:00.000Z', location: { lat: -26.1066, lng: 28.0567 } },
    });
    expect(again.json().withinGeofence).toBe(true);
    expect(again.json().inspection.startedAt).toBe('2026-10-30T08:00:00.000Z');

    const events = await ctx.database.db
      .select()
      .from(reviewEvents)
      .where(eq(reviewEvents.inspectionId, job.id));
    expect(events.filter((e) => e.kind === 'started')).toHaveLength(1);
    expect(events.find((e) => e.kind === 'started')?.comment).toMatch(
      /^Started \d+ m from the address$/,
    );
  });

  it('reports a conflict when the job is not yours', async () => {
    const job = await createJob(ctx, manager, { assigneeId: ctx.userIds[ASSESSOR_PE] });
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/inspections/${job.id}/start`,
      headers: bearer(assessor),
      payload: { startedAt: new Date().toISOString(), location: { lat: 0, lng: 0 } },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().details.reason).toBe('reassigned');
  });
});

describe('idempotent submission', () => {
  it('requires an Idempotency-Key', async () => {
    const job = await createJob(ctx, manager);
    const res = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/inspections/${job.id}/submission`,
      headers: bearer(assessor),
      payload: completeSubmission(job),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('replays the original result for a repeated key and creates no duplicates', async () => {
    const job = await createJob(ctx, manager);
    const body = completeSubmission(job);
    const key = randomUUID();
    const first = await submit(ctx, assessor, job.id, body, key);
    expect(first.statusCode).toBe(200);
    const result = first.json();
    expect(result.inspection).toMatchObject({ status: 'submitted', version: 2 });
    expect(result.pendingUploadIds).toHaveLength(body.photos.length + 1);

    const second = await submit(ctx, assessor, job.id, body, key);
    expect(second.statusCode).toBe(200);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.json()).toEqual(result);

    const db = ctx.database.db;
    expect(
      await db.select().from(inspectionAnswers).where(eq(inspectionAnswers.inspectionId, job.id)),
    ).toHaveLength(body.answers.length);
    expect(
      await db.select().from(inspectionPhotos).where(eq(inspectionPhotos.inspectionId, job.id)),
    ).toHaveLength(body.photos.length);
    expect(
      await db.select().from(damagePins).where(eq(damagePins.inspectionId, job.id)),
    ).toHaveLength(1);
    const submitted = (
      await db.select().from(reviewEvents).where(eq(reviewEvents.inspectionId, job.id))
    ).filter((e) => e.kind === 'submitted');
    expect(submitted).toHaveLength(1);
  });

  it('serialises concurrent retries of the same request', async () => {
    const job = await createJob(ctx, manager);
    const body = completeSubmission(job);
    const key = randomUUID();
    const results = await Promise.all(
      [1, 2, 3].map(() => submit(ctx, assessor, job.id, body, key)),
    );
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect(results.filter((r) => r.headers['idempotent-replayed'] === 'true')).toHaveLength(2);
    const versions = new Set(results.map((r) => r.json().inspection.version));
    expect(versions).toEqual(new Set([2]));
  });

  it('refuses to reuse a key for a different body', async () => {
    const job = await createJob(ctx, manager);
    const key = randomUUID();
    const body = completeSubmission(job);
    expect((await submit(ctx, assessor, job.id, body, key)).statusCode).toBe(200);
    const changed = { ...body, completedAt: new Date(Date.now() + 1000).toISOString() };
    const res = await submit(ctx, assessor, job.id, changed, key);
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
    const rows = await ctx.database.db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, key));
    expect(rows).toHaveLength(1);
  });

  it('rejects an incomplete checklist with the shared validation issues', async () => {
    const job = await createJob(ctx, manager);
    const body = completeSubmission(job);
    const res = await submit(ctx, assessor, job.id, {
      ...body,
      answers: body.answers.filter((a) => a.itemKey !== 'odometer'),
      photos: body.photos.filter((p) => p.shotKey !== 'vin_plate'),
      signature: null,
    });
    expect(res.statusCode).toBe(422);
    const kinds = res
      .json()
      .details.issues.map(
        (i: { kind: string; itemKey: string | null }) => `${i.kind}:${i.itemKey}`,
      );
    expect(kinds.sort()).toEqual([
      'photo_required:vin_matches',
      'required:odometer',
      'signature_required:null',
    ]);
  });

  it('rejects a template version mismatch and duplicate photo ids', async () => {
    const job = await createJob(ctx, manager);
    const body = completeSubmission(job);
    expect((await submit(ctx, assessor, job.id, { ...body, templateVersion: 9 })).statusCode).toBe(
      422,
    );
    const dup = { ...body, photos: [...body.photos, { ...body.photos[0]!, shotKey: null }] };
    const res = await submit(ctx, assessor, job.id, dup);
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toMatch(/Duplicate photo ids/);
  });
});

describe('version conflicts', () => {
  it('returns 409 "modified" when a manager changed the job while the assessor was offline', async () => {
    const job = await createJob(ctx, manager);
    await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/inspections/${job.id}`,
      headers: bearer(manager),
      payload: { baseVersion: 1, dueAt: new Date(Date.now() + 7200_000).toISOString() },
    });
    const res = await submit(ctx, assessor, job.id, completeSubmission(job));
    expect(res.statusCode).toBe(409);
    const err = res.json();
    expect(err.code).toBe('VERSION_CONFLICT');
    expect(err.details).toMatchObject({
      reason: 'modified',
      baseVersion: 1,
      current: { version: 2 },
    });

    // The app's "keep my work" path: resubmit against the current version.
    const rebased = await submit(ctx, assessor, job.id, {
      ...completeSubmission(job),
      baseVersion: 2,
    });
    expect(rebased.statusCode).toBe(200);
  });

  it('returns 409 "reassigned" when the job moved to someone else', async () => {
    const job = await createJob(ctx, manager);
    await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/inspections/${job.id}/assign`,
      headers: bearer(manager),
      payload: { assigneeId: ctx.userIds[ASSESSOR_PE] },
    });
    const res = await submit(ctx, assessor, job.id, completeSubmission(job));
    expect(res.statusCode).toBe(409);
    expect(res.json().details).toMatchObject({
      reason: 'reassigned',
      current: { assigneeName: 'Pieter van Wyk' },
    });
  });

  it('returns 409 "closed" when the job was already submitted', async () => {
    const job = await createJob(ctx, manager);
    expect((await submit(ctx, assessor, job.id, completeSubmission(job))).statusCode).toBe(200);
    const res = await submit(ctx, assessor, job.id, { ...completeSubmission(job), baseVersion: 2 });
    expect(res.statusCode).toBe(409);
    expect(res.json().details.reason).toBe('closed');
  });

  it('lets an assessor view only their own inspections', async () => {
    const job = await createJob(ctx, manager, { assigneeId: ctx.userIds[ASSESSOR_PE] });
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/v1/inspections/${job.id}`,
      headers: bearer(assessor),
    });
    expect(res.statusCode).toBe(403);
  });
});
