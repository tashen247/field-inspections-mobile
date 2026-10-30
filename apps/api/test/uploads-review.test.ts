import { randomUUID } from 'node:crypto';
import type { Inspection, StartUploadResponse } from '@fim/shared';
import { s3Keys } from '@fim/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reports } from '../src/db/schema.js';
import {
  ASSESSOR_JHB,
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

const jpeg = (size: number) => {
  const b = Buffer.alloc(size, 7);
  b[0] = 0xff;
  b[1] = 0xd8;
  return b;
};

async function startUpload(
  inspectionId: string,
  fileId: string,
  kind: 'photo' | 'signature',
  size: number,
) {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/v1/inspections/${inspectionId}/photos/upload`,
    headers: bearer(assessor),
    payload: {
      fileId,
      kind,
      contentType: kind === 'photo' ? 'image/jpeg' : 'image/png',
      sizeBytes: size,
    },
  });
  return res;
}

async function putPart(url: string, data: Buffer): Promise<string> {
  const res = await fetch(url, { method: 'PUT', body: data });
  expect(res.status).toBe(200);
  const etag = res.headers.get('etag');
  if (!etag) throw new Error('no etag');
  return etag;
}

async function completeUpload(
  inspectionId: string,
  fileId: string,
  uploadId: string,
  etag: string,
) {
  return ctx.app.inject({
    method: 'POST',
    url: `/v1/inspections/${inspectionId}/photos/complete`,
    headers: bearer(assessor),
    payload: { fileId, uploadId, parts: [{ partNumber: 1, etag }] },
  });
}

async function uploadAll(job: Inspection, body: ReturnType<typeof completeSubmission>) {
  const files = [
    ...body.photos.map((p) => ({ id: p.id, kind: 'photo' as const })),
    { id: body.signature.fileId, kind: 'signature' as const },
  ];
  let remaining = -1;
  for (const f of files) {
    const slot = (await startUpload(job.id, f.id, f.kind, 1024)).json<StartUploadResponse>();
    const etag = await putPart(slot.parts[0]!.url, jpeg(1024));
    remaining = (await completeUpload(job.id, f.id, slot.uploadId!, etag)).json().remaining;
  }
  return remaining;
}

describe('resumable uploads', () => {
  it('refuses uploads for files that are not in a submission', async () => {
    const job = await createJob(ctx, manager);
    const res = await startUpload(job.id, randomUUID(), 'photo', 100);
    expect(res.statusCode).toBe(404);
  });

  it('resumes an interrupted upload and completes idempotently', async () => {
    const job = await createJob(ctx, manager);
    const body = completeSubmission(job);
    expect((await submit(ctx, assessor, job.id, body)).statusCode).toBe(200);
    const photo = body.photos[0]!;

    const slot = (await startUpload(job.id, photo.id, 'photo', 1024)).json<StartUploadResponse>();
    expect(slot).toMatchObject({ alreadyUploaded: false, uploadedParts: [] });
    expect(slot.parts).toHaveLength(1);
    const etag = await putPart(slot.parts[0]!.url, jpeg(1024));

    // App killed before "complete": asking again resumes the same multipart upload.
    const resumed = (
      await startUpload(job.id, photo.id, 'photo', 1024)
    ).json<StartUploadResponse>();
    expect(resumed.uploadId).toBe(slot.uploadId);
    expect(resumed.uploadedParts.map((p) => p.partNumber)).toEqual([1]);
    expect(resumed.parts).toEqual([]);

    const done = await completeUpload(job.id, photo.id, slot.uploadId!, etag);
    expect(done.statusCode).toBe(200);
    expect(done.json().remaining).toBe(body.photos.length); // other photos + signature

    // Retrying "complete" after success is a no-op.
    const again = await completeUpload(job.id, photo.id, slot.uploadId!, etag);
    expect(again.json().uploadedAt).toBe(done.json().uploadedAt);
    const slotAfter = (
      await startUpload(job.id, photo.id, 'photo', 1024)
    ).json<StartUploadResponse>();
    expect(slotAfter.alreadyUploaded).toBe(true);
    expect(await ctx.app.deps.storage.exists(s3Keys.photo(job.id, photo.id))).toBe(true);
  });

  it('rejects a kind mismatch and a stale upload id', async () => {
    const job = await createJob(ctx, manager);
    const body = completeSubmission(job);
    await submit(ctx, assessor, job.id, body);
    const wrongKind = await startUpload(job.id, body.signature.fileId, 'photo', 100);
    expect(wrongKind.statusCode).toBe(422);
    const slot = (
      await startUpload(job.id, body.signature.fileId, 'signature', 100)
    ).json<StartUploadResponse>();
    const stale = await completeUpload(job.id, body.signature.fileId, 'not-the-upload', 'etag');
    expect(stale.statusCode).toBe(409);
    expect(slot.uploadId).toBeTruthy();
  });

  it('queues the PDF report exactly when the last file lands', async () => {
    const job = await createJob(ctx, manager);
    const body = completeSubmission(job);
    await submit(ctx, assessor, job.id, body);
    await ctx.app.deps.outbox.flush();
    const before = ctx.queue.ofType('generate_report').filter((j) => j.inspectionId === job.id);
    expect(before).toHaveLength(0);

    expect(await uploadAll(job, body)).toBe(0);
    await ctx.app.deps.outbox.flush();
    const after = ctx.queue.ofType('generate_report').filter((j) => j.inspectionId === job.id);
    expect(after).toHaveLength(1);
  });
});

describe('review', () => {
  async function submittedJob() {
    const job = await createJob(ctx, manager);
    const body = completeSubmission(job);
    const res = await submit(ctx, assessor, job.id, body);
    return { job: res.json().inspection as Inspection, body };
  }

  it('sends back with a required comment and lets the assessor resubmit', async () => {
    const { job } = await submittedJob();
    const noComment = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/inspections/${job.id}/review`,
      headers: bearer(manager),
      payload: { action: 'send_back', baseVersion: job.version, comment: '' },
    });
    expect(noComment.statusCode).toBe(422);

    const sentBack = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/inspections/${job.id}/review`,
      headers: bearer(manager),
      payload: {
        action: 'send_back',
        baseVersion: job.version,
        comment: 'VIN photo is blurry, please retake.',
      },
    });
    expect(sentBack.statusCode).toBe(200);
    expect(sentBack.json()).toMatchObject({
      status: 'sent_back',
      version: 3,
      reviewComment: 'VIN photo is blurry, please retake.',
    });
    await ctx.app.deps.outbox.flush();
    expect(
      ctx.queue
        .ofType('push')
        .some((p) => p.data?.kind === 'sent_back' && p.data?.inspectionId === job.id),
    ).toBe(true);

    const resubmit = await submit(ctx, assessor, job.id, {
      ...completeSubmission(job),
      baseVersion: 3,
    });
    expect(resubmit.statusCode).toBe(200);
    expect(resubmit.json().inspection).toMatchObject({
      status: 'submitted',
      reviewComment: null,
      version: 4,
    });
  });

  it('approves, audits every step, and serves the report link once generated', async () => {
    const { job, body } = await submittedJob();
    await uploadAll(job, body);

    const notReady = await ctx.app.inject({
      method: 'GET',
      url: `/v1/inspections/${job.id}/report`,
      headers: bearer(manager),
    });
    expect(notReady.statusCode).toBe(409);
    expect(notReady.json().code).toBe('REPORT_NOT_READY');

    const stale = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/inspections/${job.id}/review`,
      headers: bearer(manager),
      payload: { action: 'approve', baseVersion: 1 },
    });
    expect(stale.statusCode).toBe(409);

    const approved = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/inspections/${job.id}/review`,
      headers: bearer(manager),
      payload: { action: 'approve', baseVersion: job.version, comment: 'Looks good' },
    });
    expect(approved.json()).toMatchObject({ status: 'approved', version: job.version + 1 });

    const twice = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/inspections/${job.id}/review`,
      headers: bearer(manager),
      payload: { action: 'approve', baseVersion: job.version + 1 },
    });
    expect(twice.statusCode).toBe(409);
    expect(twice.json().code).toBe('INVALID_STATE');

    const reassign = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/inspections/${job.id}/assign`,
      headers: bearer(manager),
      payload: { assigneeId: ctx.userIds[ASSESSOR_JHB] },
    });
    expect(reassign.statusCode).toBe(409);

    // Simulate the worker having produced the PDF.
    await ctx.database.db
      .insert(reports)
      .values({ inspectionId: job.id, s3Key: s3Keys.report(job.id, 3), inspectionVersion: 3 });
    const report = await ctx.app.inject({
      method: 'GET',
      url: `/v1/inspections/${job.id}/report`,
      headers: bearer(assessor),
    });
    expect(report.statusCode).toBe(200);
    expect(report.json().url).toContain(`reports/report-v3.pdf`);

    const detail = await ctx.app.inject({
      method: 'GET',
      url: `/v1/inspections/${job.id}`,
      headers: bearer(manager),
    });
    const d = detail.json();
    expect(d.events.map((e: { kind: string }) => e.kind)).toEqual([
      'created',
      'submitted',
      'approved',
    ]);
    expect(d.events.at(-1)).toMatchObject({ actorName: 'Ayesha Moodley', comment: 'Looks good' });
    expect(d.photos.every((p: { url: string | null }) => p.url?.startsWith('http'))).toBe(true);
    expect(d.signature).toMatchObject({ signedName: 'Sipho Dlamini' });
    expect(d.damagePins).toHaveLength(1);
    expect(d.gpsTrail).toHaveLength(1);
    expect(d.answers.length).toBeGreaterThan(10);
    expect(d.report).not.toBeNull();
  });
});
