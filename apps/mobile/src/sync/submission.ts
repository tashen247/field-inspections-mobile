import {
  validateChecklist,
  type ChecklistIssue,
  type StartBody,
  type SubmissionBody,
  type TemplateBody,
} from '@fim/shared';
import {
  enqueue,
  getDraft,
  getJob,
  getTemplate,
  listAnswers,
  listGps,
  listPhotos,
  listPins,
  setLocalState,
  setPhotoUploadState,
} from '../db/repo';
import { drafts } from '../db/schema';
import type { LocalDb } from '../db/types';
import { uuid } from '../lib/uuid';
import { eq } from 'drizzle-orm';

export interface UploadPayload {
  fileId: string;
  kind: 'photo' | 'signature';
  uri: string;
  contentType: 'image/jpeg' | 'image/png';
  sizeBytes: number;
}

export function loadTemplateBody(db: LocalDb, inspectionId: string): TemplateBody | null {
  const job = getJob(db, inspectionId);
  if (!job) return null;
  return getTemplate(db, job.data.templateId)?.schema ?? null;
}

/** Validation issues for the current draft, using the same rules as the server. */
export function draftIssues(db: LocalDb, inspectionId: string): ChecklistIssue[] {
  const body = loadTemplateBody(db, inspectionId);
  const draft = getDraft(db, inspectionId);
  if (!body || !draft) return [];
  return validateChecklist(body, {
    answers: listAnswers(db, inspectionId).map((a) => ({
      itemKey: a.itemKey,
      value: a.value ?? null,
      note: a.note,
    })),
    photos: listPhotos(db, inspectionId),
    hasSignature: Boolean(draft.signatureFileId),
  });
}

export function buildSubmission(
  db: LocalDb,
  inspectionId: string,
  completedAt: string,
): SubmissionBody {
  const draft = getDraft(db, inspectionId);
  if (!draft) throw new Error('No draft for this inspection');
  return {
    baseVersion: draft.baseVersion,
    templateVersion: draft.templateVersion,
    startedAt: draft.startedAt,
    completedAt,
    // Untouched values (e.g. only a note) are sent as null so the server sees the full set.
    answers: listAnswers(db, inspectionId).map((a) => ({
      itemKey: a.itemKey,
      value: a.value ?? null,
      note: a.note,
    })),
    damagePins: listPins(db, inspectionId).map((p) => ({
      id: p.id,
      diagram: p.diagram,
      x: p.x,
      y: p.y,
      severity: p.severity,
      note: p.note,
    })),
    photos: listPhotos(db, inspectionId).map((p) => ({
      id: p.id,
      itemKey: p.itemKey,
      shotKey: p.shotKey,
      takenAt: p.takenAt,
      lat: p.lat,
      lng: p.lng,
      sizeBytes: p.sizeBytes,
    })),
    signature:
      draft.signatureFileId && draft.signedName && draft.signedAt && draft.signatureSize
        ? {
            fileId: draft.signatureFileId,
            signedName: draft.signedName,
            signedAt: draft.signedAt,
            sizeBytes: draft.signatureSize,
          }
        : null,
    gpsTrail: listGps(db, inspectionId).map((g) => ({
      lat: g.lat,
      lng: g.lng,
      accuracy: g.accuracy,
      recordedAt: g.recordedAt,
    })),
  };
}

export function queueStart(db: LocalDb, inspectionId: string, body: StartBody) {
  enqueue(db, { inspectionId, kind: 'start', payload: body, idempotencyKey: uuid() });
}

/**
 * Locks in the inspection on the device: writes the submission and one upload op per file to
 * the outbox in a single transaction. From here on, nothing is lost if the app is killed.
 */
export function queueSubmission(
  db: LocalDb,
  inspectionId: string,
  now = new Date(),
): { ok: true } | { ok: false; issues: ChecklistIssue[] } {
  const issues = draftIssues(db, inspectionId);
  if (issues.length > 0) return { ok: false, issues };

  db.transaction((tx) => {
    const t = tx as unknown as LocalDb;
    const completedAt = now.toISOString();
    t.update(drafts).set({ completedAt }).where(eq(drafts.inspectionId, inspectionId)).run();
    const body = buildSubmission(t, inspectionId, completedAt);
    enqueue(t, { inspectionId, kind: 'submit', payload: body, idempotencyKey: uuid() }, now);
    const photoRows = listPhotos(t, inspectionId);
    for (const p of photoRows) {
      const payload: UploadPayload = {
        fileId: p.id,
        kind: 'photo',
        uri: p.fileUri,
        contentType: 'image/jpeg',
        sizeBytes: p.sizeBytes,
      };
      enqueue(t, { inspectionId, kind: 'upload', payload, idempotencyKey: p.id }, now);
    }
    setPhotoUploadState(
      t,
      photoRows.map((p) => p.id),
      'pending',
    );
    const draft = getDraft(t, inspectionId)!;
    if (draft.signatureFileId && draft.signatureUri && draft.signatureSize) {
      const payload: UploadPayload = {
        fileId: draft.signatureFileId,
        kind: 'signature',
        uri: draft.signatureUri,
        contentType: 'image/png',
        sizeBytes: draft.signatureSize,
      };
      enqueue(
        t,
        { inspectionId, kind: 'upload', payload, idempotencyKey: draft.signatureFileId },
        now,
      );
    }
    setLocalState(t, inspectionId, 'queued');
  });
  return { ok: true };
}
