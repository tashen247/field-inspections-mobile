import { partCount, type StartBody, type SubmissionBody } from '@fim/shared';
import {
  getJob,
  getMeta,
  listOutbox,
  markBlocked,
  markDone,
  markFailed,
  markInFlight,
  markRetry,
  nextReadyOps,
  removeJobs,
  resetInFlight,
  saveUploadProgress,
  setConflict,
  setLocalState,
  setMeta,
  setPhotoUploadState,
  upsertJobs,
  upsertTemplates,
  type OutboxRow,
} from '../db/repo';
import { jobs, type UploadProgress } from '../db/schema';
import type { LocalDb } from '../db/types';
import { ApiError, NetworkError, type ApiClient } from '../lib/api';
import type { UploadPayload } from './submission';
import { eq } from 'drizzle-orm';

export interface FileTransport {
  /** PUTs bytes [start, end) of a local file to a pre-signed URL and returns the ETag. */
  putPart(
    url: string,
    uri: string,
    start: number,
    end: number,
    contentType: string,
  ): Promise<string>;
  exists(uri: string): boolean;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  offline: boolean;
  errors: string[];
}

export interface SyncDeps {
  db: LocalDb;
  api: ApiClient;
  files: FileTransport;
  now?: () => Date;
  /** Called after each op so the UI can show progress. */
  onProgress?: () => void;
  /** Caches example images referenced by templates so guided shots work offline. */
  cacheReferenceImages?: (names: string[]) => Promise<void>;
}

const LAST_SYNC_KEY = 'lastSyncServerTime';
const TEMPLATES_KEY = 'templatesSyncedAt';

class StopRun extends Error {}

/**
 * Moves data between the device and the API. Everything it does is driven by rows in SQLite,
 * so it can be interrupted at any point (app killed, OS ends the background task) and simply
 * picks up where it left off on the next run.
 */
export class SyncEngine {
  private running: Promise<SyncResult> | null = null;
  private readonly now: () => Date;

  constructor(private readonly deps: SyncDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Startup recovery: ops that were in flight when the process died go back to pending. */
  recover(): number {
    return resetInFlight(this.deps.db);
  }

  /** Push queued work, then pull changes. Concurrent callers share one run. */
  run(opts: { pull?: boolean } = {}): Promise<SyncResult> {
    this.running ??= this.execute(opts.pull ?? true).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async execute(pull: boolean): Promise<SyncResult> {
    const result: SyncResult = { pushed: 0, pulled: 0, offline: false, errors: [] };
    try {
      result.pushed = await this.push(result);
      if (pull) result.pulled = await this.pull();
    } catch (err) {
      if (err instanceof NetworkError)
        result.offline = true; // pull failed offline
      else if (err instanceof ApiError) result.errors.push(err.message);
      else if (!(err instanceof StopRun)) throw err; // StopRun already recorded why
    }
    return result;
  }

  async pull(): Promise<number> {
    const { db, api } = this.deps;
    const since = getMeta(db, LAST_SYNC_KEY);
    let cursor: string | null = null;
    let serverTime: string | null = null;
    let count = 0;
    do {
      const page = await api.listInspections({ mine: true, since, cursor });
      serverTime ??= page.serverTime;
      upsertJobs(db, page.items, this.now());
      if (page.removedIds.length) removeJobs(db, page.removedIds);
      count += page.items.length;
      cursor = page.nextCursor;
    } while (cursor);

    // Templates are versioned and small; refresh them at most hourly.
    const lastTemplates = getMeta(db, TEMPLATES_KEY);
    if (!lastTemplates || this.now().getTime() - Date.parse(lastTemplates) > 3_600_000) {
      const { items } = await api.templates();
      upsertTemplates(db, items);
      const names = new Set(
        items.flatMap((t) =>
          t.schema.sections.flatMap((s) => s.items.flatMap((i) => i.shots.map((sh) => sh.reference))),
        ),
      );
      names.delete(undefined);
      await this.deps.cacheReferenceImages?.([...names] as string[]).catch(() => undefined);
      setMeta(db, TEMPLATES_KEY, this.now().toISOString());
    }
    if (serverTime) setMeta(db, LAST_SYNC_KEY, serverTime);
    this.deps.onProgress?.();
    return count;
  }

  async push(
    result: SyncResult = { pushed: 0, pulled: 0, offline: false, errors: [] },
  ): Promise<number> {
    let done = 0;
    // Keep going until nothing is ready; each pass may unlock the next op of an inspection.
    for (let pass = 0; pass < 1000; pass++) {
      const ready = nextReadyOps(this.deps.db, this.now());
      if (ready.length === 0) break;
      for (const op of ready) {
        const ok = await this.runOp(op, result);
        if (ok) done += 1;
        this.deps.onProgress?.();
      }
    }
    return done;
  }

  private async runOp(op: OutboxRow, result: SyncResult): Promise<boolean> {
    const { db } = this.deps;
    markInFlight(db, op.id);
    try {
      switch (op.kind) {
        case 'start':
          await this.deps.api.start(op.inspectionId, op.payload as StartBody);
          break;
        case 'submit':
          await this.runSubmit(op);
          break;
        case 'upload':
          await this.runUpload(op);
          break;
      }
      markDone(db, op.id);
      this.afterOpDone(op);
      return true;
    } catch (err) {
      this.handleError(op, err, result);
      return false;
    }
  }

  private async runSubmit(op: OutboxRow) {
    const { db, api } = this.deps;
    setLocalState(db, op.inspectionId, 'syncing');
    const res = await api.submit(op.inspectionId, op.payload as SubmissionBody, op.idempotencyKey);
    db.update(jobs)
      .set({
        data: res.inspection,
        status: res.inspection.status,
        version: res.inspection.version,
        updatedAt: res.inspection.updatedAt,
      })
      .where(eq(jobs.id, op.inspectionId))
      .run();
  }

  private async runUpload(op: OutboxRow) {
    const { db, api, files } = this.deps;
    const p = op.payload as UploadPayload;
    if (!files.exists(p.uri)) {
      throw new PermanentLocalError(`The ${p.kind} file is missing from this device`);
    }
    if (p.kind === 'photo') setPhotoUploadState(db, [p.fileId], 'uploading');

    const slot = await api.startUpload(op.inspectionId, {
      fileId: p.fileId,
      kind: p.kind,
      contentType: p.contentType,
      sizeBytes: p.sizeBytes,
    });
    if (!slot.alreadyUploaded && slot.uploadId) {
      // Merge what we remember with what S3 says it holds: either may know more after a crash.
      const known = op.progress?.uploadId === slot.uploadId ? op.progress.parts : [];
      const parts = new Map<number, string>();
      for (const part of [...known, ...slot.uploadedParts]) parts.set(part.partNumber, part.etag);
      const progress: UploadProgress = { uploadId: slot.uploadId, parts: [] };
      const sync = () => {
        progress.parts = [...parts].map(([partNumber, etag]) => ({ partNumber, etag }));
        saveUploadProgress(db, op.id, progress);
      };
      sync();
      for (const part of slot.parts) {
        if (parts.has(part.partNumber)) continue;
        const start = (part.partNumber - 1) * slot.partSize;
        const end = Math.min(p.sizeBytes, part.partNumber * slot.partSize);
        const etag = await files.putPart(part.url, p.uri, start, end, p.contentType);
        parts.set(part.partNumber, etag);
        sync();
      }
      const expected = partCount(p.sizeBytes, slot.partSize);
      if (parts.size < expected) throw new Error('Upload incomplete; will resume');
      await api.completeUpload(op.inspectionId, {
        fileId: p.fileId,
        uploadId: slot.uploadId,
        parts: progress.parts.sort((a, b) => a.partNumber - b.partNumber),
      });
    }
    if (p.kind === 'photo') setPhotoUploadState(db, [p.fileId], 'uploaded');
  }

  private afterOpDone(op: OutboxRow) {
    const { db } = this.deps;
    const open = listOutbox(db, op.inspectionId).filter((o) => o.status !== 'done');
    if (open.length === 0 && op.kind !== 'start') setLocalState(db, op.inspectionId, 'synced');
  }

  private handleError(op: OutboxRow, err: unknown, result: SyncResult) {
    const { db } = this.deps;
    if (op.kind === 'upload') {
      const p = op.payload as UploadPayload;
      if (p.kind === 'photo') setPhotoUploadState(db, [p.fileId], 'pending');
    }
    if (err instanceof NetworkError) {
      markRetry(db, op, err.message, this.now());
      result.offline = true;
      throw new StopRun(); // no point trying the rest while offline
    }
    if (err instanceof ApiError) {
      const conflict = err.conflict;
      if (conflict) {
        setConflict(db, op.inspectionId, conflict);
        markBlocked(db, op.id, err.message);
        result.errors.push(err.message);
        return;
      }
      if (err.status === 401) {
        markRetry(db, op, 'Signed out', this.now());
        result.errors.push('Signed out');
        throw new StopRun();
      }
      if (err.permanent) {
        markFailed(db, op.id, describe(err));
        result.errors.push(describe(err));
        if (op.kind === 'submit' && getJob(db, op.inspectionId)) {
          setLocalState(db, op.inspectionId, 'queued');
        }
        return;
      }
      markRetry(db, op, describe(err), this.now());
      result.errors.push(describe(err));
      return;
    }
    if (err instanceof PermanentLocalError) {
      markFailed(db, op.id, err.message);
      result.errors.push(err.message);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    markRetry(db, op, message, this.now());
    result.errors.push(message);
  }
}

export class PermanentLocalError extends Error {}

function describe(err: ApiError): string {
  const issues = (err.body.details as { issues?: { message: string }[] } | undefined)?.issues;
  return issues?.length
    ? `${err.message}: ${issues.map((i) => i.message).join('; ')}`
    : err.message;
}
