import type {
  AnswerValue,
  ConflictDetails,
  Diagram,
  Inspection,
  Severity,
  Template,
} from '@fim/shared';
import { and, asc, eq, inArray, lte, ne, sql } from 'drizzle-orm';
import {
  answers,
  drafts,
  gpsTrail,
  jobs,
  meta,
  outbox,
  photos,
  pins,
  templates,
  type LocalState,
  type OutboxKind,
  type UploadProgress,
} from './schema';
import type { LocalDb } from './types';

export type JobRow = typeof jobs.$inferSelect;
export type DraftRow = typeof drafts.$inferSelect;
export type PhotoRow = typeof photos.$inferSelect;
export type PinRow = typeof pins.$inferSelect;
export type OutboxRow = typeof outbox.$inferSelect;

const iso = (d: Date = new Date()) => d.toISOString();

// ---------- meta ----------

export function getMeta(db: LocalDb, key: string): string | null {
  return db.select().from(meta).where(eq(meta.key, key)).get()?.value ?? null;
}

export function setMeta(db: LocalDb, key: string, value: string | null) {
  if (value === null) db.delete(meta).where(eq(meta.key, key)).run();
  else
    db.insert(meta)
      .values({ key, value })
      .onConflictDoUpdate({ target: meta.key, set: { value } })
      .run();
}

// ---------- jobs ----------

/** Has the assessor captured anything that would be lost if the job were dropped? */
export function hasLocalWork(db: LocalDb, inspectionId: string): boolean {
  return db.select().from(drafts).where(eq(drafts.inspectionId, inspectionId)).get() !== undefined;
}

/**
 * Applies a delta-sync page. Server data always wins for job metadata, but the device's
 * workflow state is kept, so a sync never discards an inspection in progress.
 */
export function upsertJobs(db: LocalDb, items: Inspection[], now = new Date()) {
  db.transaction((tx) => {
    for (const item of items) {
      tx.insert(jobs)
        .values({
          id: item.id,
          data: item,
          status: item.status,
          version: item.version,
          dueAt: item.dueAt,
          updatedAt: item.updatedAt,
          downloadedAt: iso(now),
        })
        .onConflictDoUpdate({
          target: jobs.id,
          set: {
            data: item,
            status: item.status,
            version: item.version,
            dueAt: item.dueAt,
            updatedAt: item.updatedAt,
            downloadedAt: iso(now),
          },
        })
        .run();
    }
  });
}

/** Jobs reassigned away: drop untouched ones, flag ones with local work as conflicts. */
export function removeJobs(db: LocalDb, ids: string[]) {
  for (const id of ids) {
    const job = getJob(db, id);
    if (!job) continue;
    if (hasLocalWork(db, id) && job.localState !== 'synced') {
      db.update(jobs)
        .set({
          localState: 'conflict',
          conflict: { reason: 'reassigned', baseVersion: job.version, current: job.data },
        })
        .where(eq(jobs.id, id))
        .run();
    } else {
      discardInspection(db, id);
      db.delete(jobs).where(eq(jobs.id, id)).run();
    }
  }
}

export function listJobs(db: LocalDb): JobRow[] {
  return db.select().from(jobs).orderBy(asc(jobs.dueAt)).all();
}

export function getJob(db: LocalDb, id: string): JobRow | undefined {
  return db.select().from(jobs).where(eq(jobs.id, id)).get();
}

export function setLocalState(db: LocalDb, id: string, localState: LocalState) {
  db.update(jobs).set({ localState }).where(eq(jobs.id, id)).run();
}

export function setConflict(db: LocalDb, id: string, details: ConflictDetails) {
  db.update(jobs)
    .set({
      localState: 'conflict',
      conflict: details,
      data: details.current,
      status: details.current.status,
      version: details.current.version,
      updatedAt: details.current.updatedAt,
    })
    .where(eq(jobs.id, id))
    .run();
}

// ---------- templates ----------

export function upsertTemplates(db: LocalDb, items: Template[]) {
  db.transaction((tx) => {
    for (const t of items) {
      tx.insert(templates)
        .values({ id: t.id, name: t.name, type: t.type, version: t.version, schema: t.schema })
        .onConflictDoUpdate({
          target: templates.id,
          set: { name: t.name, schema: t.schema, version: t.version },
        })
        .run();
    }
  });
}

export function getTemplate(db: LocalDb, id: string) {
  return db.select().from(templates).where(eq(templates.id, id)).get();
}

export function countTemplates(db: LocalDb): number {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(templates)
      .get()?.n ?? 0
  );
}

// ---------- drafts ----------

export function getDraft(db: LocalDb, inspectionId: string): DraftRow | undefined {
  return db.select().from(drafts).where(eq(drafts.inspectionId, inspectionId)).get();
}

export function createDraft(
  db: LocalDb,
  job: Inspection,
  start: { startedAt: string; lat: number | null; lng: number | null; distanceM: number | null },
): DraftRow {
  const existing = getDraft(db, job.id);
  if (existing) return existing;
  db.insert(drafts)
    .values({
      inspectionId: job.id,
      baseVersion: job.version,
      templateId: job.templateId,
      templateVersion: job.templateVersion,
      startedAt: start.startedAt,
      startLat: start.lat,
      startLng: start.lng,
      startDistanceM: start.distanceM,
      updatedAt: iso(),
    })
    .run();
  setLocalState(db, job.id, 'working');
  return getDraft(db, job.id)!;
}

function touchDraft(db: LocalDb, inspectionId: string) {
  db.update(drafts).set({ updatedAt: iso() }).where(eq(drafts.inspectionId, inspectionId)).run();
}

export function setAnswer(
  db: LocalDb,
  inspectionId: string,
  itemKey: string,
  value: AnswerValue,
  note?: string | null,
) {
  const now = iso();
  db.insert(answers)
    .values({ inspectionId, itemKey, value, note: note ?? null, updatedAt: now })
    .onConflictDoUpdate({
      target: [answers.inspectionId, answers.itemKey],
      set: note === undefined ? { value, updatedAt: now } : { value, note, updatedAt: now },
    })
    .run();
  touchDraft(db, inspectionId);
}

export function setNote(db: LocalDb, inspectionId: string, itemKey: string, note: string | null) {
  const now = iso();
  db.insert(answers)
    .values({ inspectionId, itemKey, value: null, note, updatedAt: now })
    .onConflictDoUpdate({
      target: [answers.inspectionId, answers.itemKey],
      set: { note, updatedAt: now },
    })
    .run();
  touchDraft(db, inspectionId);
}

export function listAnswers(db: LocalDb, inspectionId: string) {
  return db.select().from(answers).where(eq(answers.inspectionId, inspectionId)).all();
}

export function addPhoto(db: LocalDb, row: typeof photos.$inferInsert) {
  db.insert(photos).values(row).run();
  touchDraft(db, row.inspectionId);
}

export function deletePhoto(db: LocalDb, id: string): PhotoRow | undefined {
  const row = db.select().from(photos).where(eq(photos.id, id)).get();
  if (row) db.delete(photos).where(eq(photos.id, id)).run();
  return row;
}

export function listPhotos(db: LocalDb, inspectionId: string, itemKey?: string): PhotoRow[] {
  return db
    .select()
    .from(photos)
    .where(
      itemKey
        ? and(eq(photos.inspectionId, inspectionId), eq(photos.itemKey, itemKey))
        : eq(photos.inspectionId, inspectionId),
    )
    .orderBy(asc(photos.takenAt))
    .all();
}

export function upsertPin(
  db: LocalDb,
  pin: {
    id: string;
    inspectionId: string;
    diagram: Diagram;
    x: number;
    y: number;
    severity: Severity;
    note: string | null;
  },
) {
  db.insert(pins)
    .values(pin)
    .onConflictDoUpdate({
      target: pins.id,
      set: { x: pin.x, y: pin.y, severity: pin.severity, note: pin.note },
    })
    .run();
  touchDraft(db, pin.inspectionId);
}

export function deletePin(db: LocalDb, id: string) {
  db.delete(pins).where(eq(pins.id, id)).run();
}

export function listPins(db: LocalDb, inspectionId: string): PinRow[] {
  return db.select().from(pins).where(eq(pins.inspectionId, inspectionId)).all();
}

export function addGpsPoint(
  db: LocalDb,
  p: {
    inspectionId: string;
    lat: number;
    lng: number;
    accuracy: number | null;
    recordedAt: string;
  },
) {
  db.insert(gpsTrail).values(p).run();
}

export function listGps(db: LocalDb, inspectionId: string) {
  return db
    .select()
    .from(gpsTrail)
    .where(eq(gpsTrail.inspectionId, inspectionId))
    .orderBy(asc(gpsTrail.id))
    .all();
}

export function setSignature(
  db: LocalDb,
  inspectionId: string,
  sig: { fileId: string; uri: string; size: number; signedName: string; signedAt: string } | null,
) {
  db.update(drafts)
    .set({
      signatureFileId: sig?.fileId ?? null,
      signatureUri: sig?.uri ?? null,
      signatureSize: sig?.size ?? null,
      signedName: sig?.signedName ?? null,
      signedAt: sig?.signedAt ?? null,
      updatedAt: iso(),
    })
    .where(eq(drafts.inspectionId, inspectionId))
    .run();
}

/** Removes every local trace of an inspection's capture; returns file uris to delete. */
export function discardInspection(db: LocalDb, inspectionId: string): string[] {
  const files: string[] = [];
  db.transaction((tx) => {
    const photoRows = tx.select().from(photos).where(eq(photos.inspectionId, inspectionId)).all();
    files.push(...photoRows.map((p) => p.fileUri));
    const draft = tx.select().from(drafts).where(eq(drafts.inspectionId, inspectionId)).get();
    if (draft?.signatureUri) files.push(draft.signatureUri);
    tx.delete(photos).where(eq(photos.inspectionId, inspectionId)).run();
    tx.delete(answers).where(eq(answers.inspectionId, inspectionId)).run();
    tx.delete(pins).where(eq(pins.inspectionId, inspectionId)).run();
    tx.delete(gpsTrail).where(eq(gpsTrail.inspectionId, inspectionId)).run();
    tx.delete(outbox).where(eq(outbox.inspectionId, inspectionId)).run();
    tx.delete(drafts).where(eq(drafts.inspectionId, inspectionId)).run();
    tx.update(jobs)
      .set({ localState: 'idle', conflict: null })
      .where(eq(jobs.id, inspectionId))
      .run();
  });
  return files;
}

// ---------- outbox ----------

export function enqueue(
  db: LocalDb,
  op: { inspectionId: string; kind: OutboxKind; payload: unknown; idempotencyKey: string },
  now = new Date(),
) {
  db.insert(outbox)
    .values({ ...op, nextAttemptAt: iso(now), createdAt: iso(now) })
    .run();
}

/**
 * The next op to run: the oldest unfinished op of each inspection gates the rest, so a
 * submission never goes before its start, and uploads never go before their submission.
 */
export function nextReadyOps(db: LocalDb, now = new Date()): OutboxRow[] {
  const open = db
    .select()
    .from(outbox)
    .where(inArray(outbox.status, ['pending', 'in_flight', 'blocked', 'failed']))
    .orderBy(asc(outbox.id))
    .all();
  const heads = new Map<string, OutboxRow>();
  const ready: OutboxRow[] = [];
  for (const op of open) {
    const head = heads.get(op.inspectionId);
    if (!head) {
      heads.set(op.inspectionId, op);
      if (op.status === 'pending' && op.nextAttemptAt <= iso(now)) ready.push(op);
    } else if (
      op.kind === 'upload' &&
      head.kind === 'upload' &&
      op.status === 'pending' &&
      op.nextAttemptAt <= iso(now)
    ) {
      // Uploads of one inspection are independent of each other.
      ready.push(op);
    }
  }
  return ready;
}

export function markInFlight(db: LocalDb, id: number) {
  db.update(outbox)
    .set({ status: 'in_flight', attempts: sql`${outbox.attempts} + 1` })
    .where(eq(outbox.id, id))
    .run();
}

export function markDone(db: LocalDb, id: number) {
  db.update(outbox).set({ status: 'done', lastError: null }).where(eq(outbox.id, id)).run();
}

/** Exponential backoff with a cap: 5s, 10s, 20s ... 10 min. */
export function backoffMs(attempts: number): number {
  return Math.min(10 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1));
}

export function markRetry(db: LocalDb, op: OutboxRow, error: string, now = new Date()) {
  const attempts = op.attempts + 1;
  db.update(outbox)
    .set({
      status: 'pending',
      lastError: error,
      nextAttemptAt: iso(new Date(now.getTime() + backoffMs(attempts))),
    })
    .where(eq(outbox.id, op.id))
    .run();
}

export function markBlocked(db: LocalDb, id: number, error: string) {
  db.update(outbox).set({ status: 'blocked', lastError: error }).where(eq(outbox.id, id)).run();
}

export function markFailed(db: LocalDb, id: number, error: string) {
  db.update(outbox).set({ status: 'failed', lastError: error }).where(eq(outbox.id, id)).run();
}

export function saveUploadProgress(db: LocalDb, id: number, progress: UploadProgress | null) {
  db.update(outbox).set({ progress }).where(eq(outbox.id, id)).run();
}

/** After a crash or kill, anything that was mid-flight is simply retried. */
export function resetInFlight(db: LocalDb): number {
  const rows = db
    .update(outbox)
    .set({ status: 'pending' })
    .where(eq(outbox.status, 'in_flight'))
    .returning({ id: outbox.id })
    .all();
  return rows.length;
}

/** Retry now: failed or waiting ops become due immediately. */
export function retryNow(db: LocalDb, inspectionId?: string, now = new Date()) {
  db.update(outbox)
    .set({ status: 'pending', nextAttemptAt: iso(now) })
    .where(
      and(
        inArray(outbox.status, ['pending', 'failed']),
        inspectionId ? eq(outbox.inspectionId, inspectionId) : undefined,
      ),
    )
    .run();
}

export function listOutbox(db: LocalDb, inspectionId?: string): OutboxRow[] {
  return db
    .select()
    .from(outbox)
    .where(inspectionId ? eq(outbox.inspectionId, inspectionId) : undefined)
    .orderBy(asc(outbox.id))
    .all();
}

export function openOutboxCount(db: LocalDb, inspectionId?: string): number {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(outbox)
      .where(
        and(
          ne(outbox.status, 'done'),
          inspectionId ? eq(outbox.inspectionId, inspectionId) : undefined,
        ),
      )
      .get()?.n ?? 0
  );
}

export function pruneDone(db: LocalDb, olderThan: Date) {
  db.delete(outbox)
    .where(and(eq(outbox.status, 'done'), lte(outbox.createdAt, iso(olderThan))))
    .run();
}

export function setPhotoUploadState(
  db: LocalDb,
  ids: string[],
  state: (typeof photos.$inferSelect)['uploadState'],
) {
  if (ids.length === 0) return;
  db.update(photos).set({ uploadState: state }).where(inArray(photos.id, ids)).run();
}

// ---------- device owner ----------

const OWNER_KEY = 'ownerUserId';

/**
 * One device, one assessor's data. Signing in as someone else is only allowed once the
 * previous user's work has synced; then the local cache is cleared for the new user.
 */
export function claimDevice(
  db: LocalDb,
  userId: string,
): { ok: true } | { ok: false; reason: string } {
  const owner = getMeta(db, OWNER_KEY);
  if (owner && owner !== userId) {
    if (openOutboxCount(db) > 0) {
      return {
        ok: false,
        reason:
          'Another user has inspections on this device that have not synced yet. They need to sign in and sync first.',
      };
    }
    db.transaction((tx) => {
      for (const table of [photos, answers, pins, gpsTrail, outbox, drafts, jobs, meta]) {
        tx.delete(table).run();
      }
    });
  }
  setMeta(db, OWNER_KEY, userId);
  return { ok: true };
}
