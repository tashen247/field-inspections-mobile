import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { flattenItems, VEHICLE_TEMPLATE } from '@fim/shared';
import { eq } from 'drizzle-orm';
import {
  addPhoto,
  createDraft,
  getJob,
  listOutbox,
  listPhotos,
  setAnswer,
  setSignature,
  upsertJobs,
  upsertTemplates,
} from '../db/repo';
import { outbox } from '../db/schema';
import { createTestDb } from '../db/test-db';
import type { LocalDb } from '../db/types';
import { discardLocalWork, resubmitOnLatest } from '../sync/conflicts';
import { SyncEngine } from '../sync/engine';
import { queueStart, queueSubmission } from '../sync/submission';
import { FakeServer, TEMPLATE, makeInspection } from './fakes';

const JOB = makeInspection();

/** Fills in a complete, valid inspection on the device and returns its file uris. */
function captureCompleteInspection(db: LocalDb, opts: { photoSize?: number } = {}): Set<string> {
  upsertTemplates(db, [TEMPLATE]);
  upsertJobs(db, [JOB]);
  createDraft(db, JOB, {
    startedAt: '2026-10-30T08:00:00.000Z',
    lat: -26.1,
    lng: 28.05,
    distanceM: 20,
  });
  queueStart(db, JOB.id, {
    startedAt: '2026-10-30T08:00:00.000Z',
    location: { lat: -26.1, lng: 28.05, accuracy: 5 },
  });
  const files = new Set<string>();
  for (const { item } of flattenItems(VEHICLE_TEMPLATE)) {
    const value =
      item.kind === 'passFail'
        ? 'pass'
        : item.kind === 'number'
          ? 5
          : item.kind === 'select'
            ? item.options[0]!.value
            : 'ok';
    setAnswer(db, JOB.id, item.key, value);
    for (const shot of item.shots.filter((s) => s.required)) {
      const id = randomUUID();
      const uri = `file:///photos/${id}.jpg`;
      files.add(uri);
      addPhoto(db, {
        id,
        inspectionId: JOB.id,
        itemKey: item.key,
        shotKey: shot.key,
        fileUri: uri,
        takenAt: '2026-10-30T08:10:00.000Z',
        lat: -26.1,
        lng: 28.05,
        width: 1600,
        height: 1200,
        sizeBytes: opts.photoSize ?? 800,
      });
    }
  }
  const sigUri = 'file:///signatures/sig.png';
  files.add(sigUri);
  setSignature(db, JOB.id, {
    fileId: randomUUID(),
    uri: sigUri,
    size: 400,
    signedName: 'Sipho Dlamini',
    signedAt: '2026-10-30T08:30:00.000Z',
  });
  return files;
}

const later = (ms: number) => new Date(Date.now() + ms);

describe('sync queue', () => {
  it('refuses to queue an incomplete inspection', () => {
    const { db } = createTestDb();
    upsertTemplates(db, [TEMPLATE]);
    upsertJobs(db, [JOB]);
    createDraft(db, JOB, {
      startedAt: new Date().toISOString(),
      lat: null,
      lng: null,
      distanceM: null,
    });
    const result = queueSubmission(db, JOB.id);
    expect(result.ok).toBe(false);
    expect(listOutbox(db)).toHaveLength(0);
  });

  it('keeps everything queued while offline, then syncs start, data and photos in order', async () => {
    const { db } = createTestDb();
    const files = captureCompleteInspection(db);
    expect(queueSubmission(db, JOB.id)).toEqual({ ok: true });
    expect(getJob(db, JOB.id)?.localState).toBe('queued');

    const server = new FakeServer();
    server.offline = true;
    const engine = new SyncEngine({ db, api: server.api(), files: server.transport(files) });
    const offline = await engine.run();
    expect(offline.offline).toBe(true);
    expect(listOutbox(db).every((o) => o.status === 'pending')).toBe(true);
    expect(listOutbox(db)[0]?.attempts).toBe(1);

    server.offline = false;
    const online = new SyncEngine({
      db,
      api: server.api(),
      files: server.transport(files),
      now: () => later(60_000),
    });
    const result = await online.run();
    expect(result.offline).toBe(false);
    expect(server.starts).toBe(1);
    expect(server.submissionsApplied).toHaveLength(1);
    expect(server.expectedFiles.size).toBe(0);
    expect(listOutbox(db).every((o) => o.status === 'done')).toBe(true);
    expect(listPhotos(db, JOB.id).every((p) => p.uploadState === 'uploaded')).toBe(true);
    expect(getJob(db, JOB.id)).toMatchObject({
      localState: 'synced',
      status: 'submitted',
      version: 2,
    });
    // start must reach the server before the submission
    expect(server.calls.indexOf('start')).toBeLessThan(server.calls.indexOf('submit'));
  });

  it('resumes a multipart upload after the app is killed, without re-sending parts or data', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fim-'));
    const file = path.join(dir, 'device.db');
    const first = createTestDb(file);
    const files = captureCompleteInspection(first.db, { photoSize: 2500 }); // 3 parts each
    queueSubmission(first.db, JOB.id);
    const firstPhoto = listPhotos(first.db, JOB.id)[0]!;

    const server = new FakeServer();
    // The submission is committed on the server but the response never arrives...
    server.nextFault = 'network-after-commit';
    const engine1 = new SyncEngine({
      db: first.db,
      api: server.api(),
      files: server.transport(files, { failOnPart: { fileId: firstPhoto.id, part: 2 } }),
    });
    await engine1.run({ pull: false });
    expect(server.submissionsApplied).toHaveLength(1);

    // ...then the retry gets further and the process dies mid-photo, after part 1.
    const engine2 = new SyncEngine({
      db: first.db,
      api: server.api(),
      files: server.transport(files, { failOnPart: { fileId: firstPhoto.id, part: 2 } }),
      now: () => later(60_000),
    });
    await engine2.run({ pull: false });
    const uploadOp = listOutbox(first.db).find(
      (o) => o.kind === 'upload' && (o.payload as { fileId: string }).fileId === firstPhoto.id,
    )!;
    expect(uploadOp.progress?.parts.map((p) => p.partNumber)).toEqual([1]);
    // Simulate the OS killing the app with the op still marked in flight.
    first.db.update(outbox).set({ status: 'in_flight' }).where(eq(outbox.id, uploadOp.id)).run();
    first.close();

    // App restarts: same database file, fresh engine.
    const second = createTestDb(file);
    const transport = server.transport(files);
    const engine3 = new SyncEngine({
      db: second.db,
      api: server.api(),
      files: transport,
      now: () => later(10 * 60_000),
    });
    expect(engine3.recover()).toBeGreaterThan(0);
    await engine3.run({ pull: false });

    expect(server.submissionsApplied).toHaveLength(1); // idempotent replay, no duplicate
    expect(transport.puts.filter((p) => p.startsWith(firstPhoto.id))).toEqual([
      `${firstPhoto.id}#2`,
      `${firstPhoto.id}#3`,
    ]);
    expect(server.expectedFiles.size).toBe(0);
    expect(getJob(second.db, JOB.id)?.localState).toBe('synced');
    second.close();
  });

  it('backs off after a server error and retries later', async () => {
    const { db } = createTestDb();
    const files = captureCompleteInspection(db);
    queueSubmission(db, JOB.id);
    const server = new FakeServer();
    server.nextFault = 500;
    const engine = new SyncEngine({ db, api: server.api(), files: server.transport(files) });
    const r = await engine.run({ pull: false });
    expect(r.errors).toContain('Unexpected error');
    const start = listOutbox(db).find((o) => o.kind === 'start')!;
    expect(start.status).toBe('pending');
    expect(Date.parse(start.nextAttemptAt)).toBeGreaterThan(Date.now());
    // Nothing else ran while the head op waits.
    expect(server.submissionsApplied).toHaveLength(0);
  });

  it('blocks on a version conflict, then resubmits on the latest version when asked', async () => {
    const { db } = createTestDb();
    const files = captureCompleteInspection(db);
    queueSubmission(db, JOB.id);
    const server = new FakeServer([{ ...JOB, version: 3, dueAt: '2026-11-02T10:00:00.000Z' }]);
    const engine = new SyncEngine({ db, api: server.api(), files: server.transport(files) });
    await engine.run({ pull: false });

    const job = getJob(db, JOB.id)!;
    expect(job.localState).toBe('conflict');
    expect(job.conflict?.reason).toBe('modified');
    expect(job.version).toBe(3);
    expect(listOutbox(db).find((o) => o.kind === 'submit')?.status).toBe('blocked');
    expect(server.calls).not.toContain('startUpload');

    const oldKey = listOutbox(db).find((o) => o.kind === 'submit')!.idempotencyKey;
    expect(resubmitOnLatest(db, JOB.id)).toBe(true);
    const op = listOutbox(db).find((o) => o.kind === 'submit')!;
    expect(op.idempotencyKey).not.toBe(oldKey);
    expect((op.payload as { baseVersion: number }).baseVersion).toBe(3);

    await engine.run({ pull: false });
    expect(server.submissionsApplied).toHaveLength(1);
    expect(getJob(db, JOB.id)).toMatchObject({ localState: 'synced', version: 4, conflict: null });
  });

  it('marks a missing photo file as failed instead of retrying forever', async () => {
    const { db } = createTestDb();
    const files = captureCompleteInspection(db);
    queueSubmission(db, JOB.id);
    const missing = [...files][0]!;
    files.delete(missing);
    const server = new FakeServer();
    const engine = new SyncEngine({ db, api: server.api(), files: server.transport(files) });
    const r = await engine.run({ pull: false });
    expect(r.errors.some((e) => e.includes('missing'))).toBe(true);
    const failed = listOutbox(db).filter((o) => o.status === 'failed');
    expect(failed).toHaveLength(1);
  });
});

describe('delta pull', () => {
  it('downloads jobs and templates, and handles reassignment with and without local work', async () => {
    const { db } = createTestDb();
    const other = makeInspection({
      id: '44444444-4444-4444-8444-444444444444',
      reference: 'INS-2',
    });
    const server = new FakeServer([JOB, other]);
    const engine = new SyncEngine({ db, api: server.api(), files: server.transport(new Set()) });
    const r = await engine.run();
    expect(r.pulled).toBe(2);
    expect(getJob(db, other.id)).toBeDefined();

    // Local work exists on JOB; nothing on `other`.
    createDraft(db, JOB, {
      startedAt: new Date().toISOString(),
      lat: null,
      lng: null,
      distanceM: null,
    });
    server.inspections.clear();
    server.removedIds = [JOB.id, other.id];
    await engine.run();
    expect(getJob(db, other.id)).toBeUndefined();
    expect(getJob(db, JOB.id)?.conflict?.reason).toBe('reassigned');

    const filesToDelete = discardLocalWork(db, JOB.id);
    expect(filesToDelete).toEqual([]);
    expect(getJob(db, JOB.id)).toBeUndefined();
  });
});
