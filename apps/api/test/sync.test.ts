import type { ListInspectionsResponse } from '@fim/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedInspections } from '../src/db/seed-data.js';
import { decodeCursor, encodeCursor } from '../src/lib/cursor.js';
import {
  ASSESSOR_JHB,
  ASSESSOR_PE,
  MANAGER,
  bearer,
  createJob,
  jobBody,
  login,
  setupTestApp,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
let assessor: string;
let other: string;
let manager: string;

beforeAll(async () => {
  ctx = await setupTestApp();
  await seedInspections(ctx.database.db, { count: 300, mixedStatuses: true, seed: 7 });
  assessor = (await login(ctx.app, ASSESSOR_JHB)).accessToken;
  other = (await login(ctx.app, ASSESSOR_PE)).accessToken;
  manager = (await login(ctx.app, MANAGER)).accessToken;
});
afterAll(() => ctx.close());

async function list(token: string, query: string): Promise<ListInspectionsResponse> {
  const res = await ctx.app.inject({
    method: 'GET',
    url: `/v1/inspections?${query}`,
    headers: bearer(token),
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

async function listAll(token: string, query: string) {
  const items: ListInspectionsResponse['items'] = [];
  let cursor: string | null = null;
  let first: ListInspectionsResponse | undefined;
  do {
    const page: ListInspectionsResponse = await list(
      token,
      `${query}&limit=50${cursor ? `&cursor=${cursor}` : ''}`,
    );
    first ??= page;
    expect(page.serverTime).toBe(first.serverTime);
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return { items, serverTime: first.serverTime, removedIds: first.removedIds };
}

describe('delta sync', () => {
  it('pages through every assigned job exactly once', async () => {
    const { items } = await listAll(assessor, 'assignedTo=me');
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(items.every((i) => i.assigneeName === 'Thandi Nkosi')).toBe(true);
    expect(items.length).toBeGreaterThan(50);
    const sorted = [...items].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    expect(items.map((i) => i.id)).toEqual(sorted.map((i) => i.id));
  });

  it('keeps assessors to their own jobs even without assignedTo', async () => {
    const mine = await listAll(assessor, 'status=assigned');
    expect(
      mine.items.every((i) => i.assigneeName === 'Thandi Nkosi' && i.status === 'assigned'),
    ).toBe(true);
    const all = await listAll(manager, 'status=assigned');
    expect(all.items.length).toBeGreaterThan(mine.items.length);
  });

  it('returns only changes since the last serverTime, and reassignments as removals', async () => {
    const job = await createJob(ctx, manager);
    const baseline = await listAll(assessor, 'assignedTo=me');
    expect(baseline.items.some((i) => i.id === job.id)).toBe(true);

    // Nothing changed: the delta (within the overlap window) contains only recent rows.
    const quiet = await list(assessor, `assignedTo=me&since=${baseline.serverTime}`);
    expect(
      quiet.items.every((i) => Date.parse(i.updatedAt) > Date.parse(baseline.serverTime)),
    ).toBe(true);

    const second = await createJob(ctx, manager, { insuredName: 'Lerato Mokoena' });
    const reassign = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/inspections/${job.id}/assign`,
      headers: bearer(manager),
      payload: { assigneeId: ctx.userIds[ASSESSOR_PE], baseVersion: job.version },
    });
    expect(reassign.statusCode).toBe(200);
    expect(reassign.json()).toMatchObject({ version: 2, assigneeName: 'Pieter van Wyk' });

    const delta = await list(assessor, `assignedTo=me&since=${baseline.serverTime}`);
    expect(delta.items.map((i) => i.id)).toContain(second.id);
    expect(delta.items.map((i) => i.id)).not.toContain(job.id);
    expect(delta.removedIds).toEqual([job.id]);

    const theirs = await list(other, `assignedTo=me&since=${baseline.serverTime}`);
    expect(theirs.items.map((i) => i.id)).toContain(job.id);
    await ctx.app.deps.outbox.flush();
    const pushes = ctx.queue.ofType('push').filter((j) => j.data?.inspectionId === job.id);
    expect(pushes.map((p) => p.userId)).toEqual([
      ctx.userIds[ASSESSOR_JHB],
      ctx.userIds[ASSESSOR_PE],
    ]);
  });

  it('rejects a tampered cursor', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/inspections?cursor=garbage',
      headers: bearer(assessor),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('cursor codec', () => {
  it('round-trips and rejects malformed input', () => {
    const c = {
      updatedAt: '2026-10-30T10:00:00.123456Z',
      id: '1134fee0-0f4e-4ab7-9509-8d01b5560c52',
      serverTime: '2026-10-30T10:00:00.000Z',
    };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor(Buffer.from('a|b').toString('base64url'))).toBeNull();
    expect(
      decodeCursor(
        Buffer.from('nope|1134fee0-0f4e-4ab7-9509-8d01b5560c52|x').toString('base64url'),
      ),
    ).toBeNull();
    expect(
      decodeCursor(Buffer.from(`${c.updatedAt}|zzz|${c.serverTime}`).toString('base64url')),
    ).toBeNull();
  });
});

describe('manager job management', () => {
  it('creates, edits and refuses mismatched templates or non-assessor assignees', async () => {
    const job = await createJob(ctx, manager, { assigneeId: null });
    expect(job).toMatchObject({ status: 'assigned', assigneeId: null, version: 1 });
    expect(job.reference).toMatch(/^INS-\d{6}-[A-Z0-9]{6}$/);

    const edit = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/inspections/${job.id}`,
      headers: bearer(manager),
      payload: {
        baseVersion: 1,
        priority: 'urgent',
        dueAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    expect(edit.json()).toMatchObject({ priority: 'urgent', version: 2 });

    const stale = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/inspections/${job.id}`,
      headers: bearer(manager),
      payload: { baseVersion: 1, priority: 'low' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().details.reason).toBe('modified');

    const wrongTemplate = await ctx.app.inject({
      method: 'POST',
      url: '/v1/inspections',
      headers: bearer(manager),
      payload: { ...jobBody(ctx), templateId: ctx.templateIds.property },
    });
    expect(wrongTemplate.statusCode).toBe(422);

    const toManager = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/inspections/${job.id}/assign`,
      headers: bearer(manager),
      payload: { assigneeId: ctx.userIds[MANAGER] },
    });
    expect(toManager.statusCode).toBe(422);

    const missing = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/inspections/00000000-0000-4000-8000-000000000000/assign`,
      headers: bearer(manager),
      payload: { assigneeId: ctx.userIds[ASSESSOR_JHB] },
    });
    expect(missing.statusCode).toBe(404);
  });
});
