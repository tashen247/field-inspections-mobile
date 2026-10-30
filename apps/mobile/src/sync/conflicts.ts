import { and, eq } from 'drizzle-orm';
import { discardInspection, getDraft, getJob, setLocalState } from '../db/repo';
import { drafts, jobs, outbox } from '../db/schema';
import type { LocalDb } from '../db/types';
import { uuid } from '../lib/uuid';
import { buildSubmission } from './submission';

/**
 * "Keep my work": the manager changed the job (not its owner), so rebase the queued submission
 * onto the server's current version and send it again with a fresh idempotency key.
 */
export function resubmitOnLatest(db: LocalDb, inspectionId: string, now = new Date()): boolean {
  const job = getJob(db, inspectionId);
  const draft = getDraft(db, inspectionId);
  if (!job || !draft || job.conflict?.reason !== 'modified') return false;
  db.transaction((tx) => {
    const t = tx as unknown as LocalDb;
    t.update(drafts)
      .set({ baseVersion: job.version })
      .where(eq(drafts.inspectionId, inspectionId))
      .run();
    const body = buildSubmission(t, inspectionId, draft.completedAt ?? now.toISOString());
    t.update(outbox)
      .set({
        payload: body,
        idempotencyKey: uuid(),
        status: 'pending',
        nextAttemptAt: now.toISOString(),
        lastError: null,
      })
      .where(
        and(
          eq(outbox.inspectionId, inspectionId),
          eq(outbox.kind, 'submit'),
          eq(outbox.status, 'blocked'),
        ),
      )
      .run();
    t.update(jobs)
      .set({ localState: 'queued', conflict: null })
      .where(eq(jobs.id, inspectionId))
      .run();
  });
  return true;
}

/**
 * Drop everything captured on this device for the inspection. For a job that now belongs to
 * someone else the job itself disappears too. Returns file uris for the caller to delete.
 */
export function discardLocalWork(db: LocalDb, inspectionId: string): string[] {
  const job = getJob(db, inspectionId);
  const files = discardInspection(db, inspectionId);
  if (job?.conflict?.reason === 'reassigned') {
    db.delete(jobs).where(eq(jobs.id, inspectionId)).run();
  }
  return files;
}

/** After "sent back", reopen the device copy for edits against the new version. */
export function reopenAfterSendBack(db: LocalDb, inspectionId: string): boolean {
  const job = getJob(db, inspectionId);
  const draft = getDraft(db, inspectionId);
  if (!job || job.status !== 'sent_back' || !draft) return false;
  db.update(drafts)
    .set({ baseVersion: job.version, completedAt: null })
    .where(eq(drafts.inspectionId, inspectionId))
    .run();
  setLocalState(db, inspectionId, 'working');
  return true;
}
