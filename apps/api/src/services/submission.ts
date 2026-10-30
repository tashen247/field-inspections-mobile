import {
  s3Keys,
  submissionBodySchema,
  validateChecklist,
  type SubmissionBody,
  type SubmissionResponse,
} from '@fim/shared';
import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.js';
import {
  damagePins,
  gpsPoints,
  inspectionAnswers,
  inspectionPhotos,
  inspections,
  signatures,
  templates,
} from '../db/schema.js';
import { AppError, conflict } from '../lib/errors.js';
import type { AccessTokenClaims } from '../plugins/auth.js';
import {
  assessorConflictReason,
  getInspectionDto,
  lockInspection,
  recordEvent,
} from './inspections.js';
import { addToOutbox } from './outbox.js';

/** Ids of uploads the server is still waiting for. */
export async function pendingUploadIds(tx: DbOrTx, inspectionId: string): Promise<string[]> {
  const photos = await tx
    .select({ id: inspectionPhotos.id })
    .from(inspectionPhotos)
    .where(
      and(eq(inspectionPhotos.inspectionId, inspectionId), isNull(inspectionPhotos.uploadedAt)),
    );
  const sig = await tx
    .select({ id: signatures.id })
    .from(signatures)
    .where(and(eq(signatures.inspectionId, inspectionId), isNull(signatures.uploadedAt)));
  return [...photos, ...sig].map((r) => r.id);
}

/**
 * Applies a submission. Must run inside a transaction that already holds the idempotency lock.
 * The checklist is validated with the same shared rules the app uses before allowing submit.
 */
export async function applySubmission(
  tx: DbOrTx,
  user: AccessTokenClaims,
  inspectionId: string,
  input: SubmissionBody,
  correlationId: string,
): Promise<SubmissionResponse> {
  const body = submissionBodySchema.parse(input);
  const row = await lockInspection(tx, inspectionId);

  const reason = assessorConflictReason(row, user.sub, body.baseVersion);
  if (reason) {
    throw conflict(
      { reason, baseVersion: body.baseVersion, current: await getInspectionDto(tx, inspectionId) },
      reason === 'reassigned'
        ? 'This inspection was reassigned while you were offline'
        : reason === 'closed'
          ? 'This inspection is already closed'
          : 'This inspection was changed by a manager while you were offline',
    );
  }
  if (body.templateVersion !== row.templateVersion) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Checklist template version does not match the inspection',
    );
  }

  const template = await tx.query.templates.findFirst({ where: eq(templates.id, row.templateId) });
  if (!template) throw new Error(`template ${row.templateId} missing`);

  const issues = validateChecklist(template.schema, {
    answers: body.answers,
    photos: body.photos,
    hasSignature: body.signature !== null,
  });
  if (issues.length > 0) {
    throw new AppError('VALIDATION_FAILED', 'The checklist is incomplete', { issues });
  }

  // Photo ids are generated on the device; refuse ids that belong to another inspection.
  const photoIds = body.photos.map((p) => p.id);
  if (new Set(photoIds).size !== photoIds.length) {
    throw new AppError('VALIDATION_FAILED', 'Duplicate photo ids in submission');
  }
  if (photoIds.length) {
    const foreign = await tx
      .select({ id: inspectionPhotos.id })
      .from(inspectionPhotos)
      .where(
        and(
          inArray(inspectionPhotos.id, photoIds),
          sql`${inspectionPhotos.inspectionId} <> ${inspectionId}`,
        ),
      );
    if (foreign.length) throw new AppError('VALIDATION_FAILED', 'Photo id already used elsewhere');
  }

  // Replace the answer set (a resubmission after "sent back" supersedes the old one).
  await tx.delete(inspectionAnswers).where(eq(inspectionAnswers.inspectionId, inspectionId));
  if (body.answers.length) {
    await tx.insert(inspectionAnswers).values(
      body.answers.map((a) => ({
        inspectionId,
        itemKey: a.itemKey,
        value: a.value,
        note: a.note,
      })),
    );
  }

  await tx.delete(damagePins).where(eq(damagePins.inspectionId, inspectionId));
  if (body.damagePins.length) {
    await tx.insert(damagePins).values(body.damagePins.map((p) => ({ ...p, inspectionId })));
  }

  await tx.delete(gpsPoints).where(eq(gpsPoints.inspectionId, inspectionId));
  if (body.gpsTrail.length) {
    await tx.insert(gpsPoints).values(
      body.gpsTrail.map((g) => ({
        inspectionId,
        lat: g.lat,
        lng: g.lng,
        accuracy: g.accuracy,
        recordedAt: new Date(g.recordedAt),
      })),
    );
  }

  // Photos: keep rows (and upload progress) for ids still present, drop the rest.
  await tx
    .delete(inspectionPhotos)
    .where(
      photoIds.length
        ? and(
            eq(inspectionPhotos.inspectionId, inspectionId),
            notInArray(inspectionPhotos.id, photoIds),
          )
        : eq(inspectionPhotos.inspectionId, inspectionId),
    );
  if (body.photos.length) {
    await tx
      .insert(inspectionPhotos)
      .values(
        body.photos.map((p) => ({
          id: p.id,
          inspectionId,
          itemKey: p.itemKey,
          shotKey: p.shotKey,
          s3Key: s3Keys.photo(inspectionId, p.id),
          takenAt: new Date(p.takenAt),
          lat: p.lat,
          lng: p.lng,
          sizeBytes: p.sizeBytes,
        })),
      )
      .onConflictDoUpdate({
        target: inspectionPhotos.id,
        set: {
          itemKey: sql`excluded.item_key`,
          shotKey: sql`excluded.shot_key`,
          takenAt: sql`excluded.taken_at`,
          lat: sql`excluded.lat`,
          lng: sql`excluded.lng`,
        },
      });
  }

  const existingSig = await tx.query.signatures.findFirst({
    where: eq(signatures.inspectionId, inspectionId),
  });
  if (!body.signature) {
    if (existingSig) await tx.delete(signatures).where(eq(signatures.id, existingSig.id));
  } else if (existingSig?.id === body.signature.fileId) {
    await tx
      .update(signatures)
      .set({ signedName: body.signature.signedName, signedAt: new Date(body.signature.signedAt) })
      .where(eq(signatures.id, existingSig.id));
  } else {
    if (existingSig) await tx.delete(signatures).where(eq(signatures.id, existingSig.id));
    await tx.insert(signatures).values({
      id: body.signature.fileId,
      inspectionId,
      s3Key: s3Keys.signature(inspectionId, body.signature.fileId),
      signedName: body.signature.signedName,
      signedAt: new Date(body.signature.signedAt),
      sizeBytes: body.signature.sizeBytes,
    });
  }

  await tx
    .update(inspections)
    .set({
      status: 'submitted',
      version: sql`${inspections.version} + 1`,
      startedAt: row.startedAt ?? new Date(body.startedAt),
      completedAt: new Date(body.completedAt),
      submittedAt: sql`now()`,
      reviewComment: null,
      updatedAt: sql`now()`,
    })
    .where(eq(inspections.id, inspectionId));

  await recordEvent(tx, {
    inspectionId,
    kind: 'submitted',
    actorId: user.sub,
    fromStatus: row.status,
    toStatus: 'submitted',
  });

  const pending = await pendingUploadIds(tx, inspectionId);
  if (pending.length === 0) {
    await addToOutbox(tx, [{ type: 'generate_report', inspectionId, correlationId }]);
  }
  return { inspection: await getInspectionDto(tx, inspectionId), pendingUploadIds: pending };
}
