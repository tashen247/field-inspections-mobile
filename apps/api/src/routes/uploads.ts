import {
  UPLOAD_PART_SIZE,
  apiErrorSchema,
  completeUploadBodySchema,
  completeUploadResponseSchema,
  partCount,
  startUploadBodySchema,
  startUploadResponseSchema,
  type UploadKind,
} from '@fim/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { DbOrTx } from '../db/client.js';
import { inspectionPhotos, inspections, signatures } from '../db/schema.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { lockInspection } from '../services/inspections.js';
import { addToOutbox } from '../services/outbox.js';
import { pendingUploadIds } from '../services/submission.js';

const idParams = z.object({ id: z.uuid() });

interface UploadTarget {
  kind: UploadKind;
  id: string;
  s3Key: string;
  sizeBytes: number;
  uploadId: string | null;
  uploadedAt: Date | null;
}

async function findTarget(db: DbOrTx, inspectionId: string, fileId: string): Promise<UploadTarget> {
  const photo = await db.query.inspectionPhotos.findFirst({
    where: and(eq(inspectionPhotos.id, fileId), eq(inspectionPhotos.inspectionId, inspectionId)),
  });
  if (photo) return { kind: 'photo', ...photo };
  const sig = await db.query.signatures.findFirst({
    where: and(eq(signatures.id, fileId), eq(signatures.inspectionId, inspectionId)),
  });
  if (sig) return { kind: 'signature', ...sig };
  throw notFound('Upload (submit the inspection before uploading its files)');
}

async function setUploadState(
  db: DbOrTx,
  target: UploadTarget,
  values: { uploadId?: string | null; uploadedAt?: Date },
) {
  if (target.kind === 'photo') {
    await db.update(inspectionPhotos).set(values).where(eq(inspectionPhotos.id, target.id));
  } else {
    await db.update(signatures).set(values).where(eq(signatures.id, target.id));
  }
}

/**
 * Resumable uploads. The device asks for an upload slot; the API opens (or reopens) an S3
 * multipart upload and returns pre-signed part URLs, skipping parts S3 already holds. If the
 * app is killed mid-upload, asking again resumes rather than starting over.
 */
export const uploadRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, storage, outbox } = app.deps;
  app.addHook('onRequest', app.authenticate);
  app.addHook('onRequest', app.requireRole('assessor'));

  async function loadOwned(id: string, userId: string) {
    const row = await db.query.inspections.findFirst({ where: eq(inspections.id, id) });
    if (!row) throw notFound('Inspection');
    if (row.assigneeId !== userId) throw forbidden('This inspection is not assigned to you');
    return row;
  }

  app.post(
    '/:id/photos/upload',
    {
      schema: {
        tags: ['uploads'],
        security: [{ bearerAuth: [] }],
        params: idParams,
        body: startUploadBodySchema,
        response: { 200: startUploadResponseSchema, 404: apiErrorSchema, 422: apiErrorSchema },
      },
    },
    async (req) => {
      await loadOwned(req.params.id, req.user.sub);
      const target = await findTarget(db, req.params.id, req.body.fileId);
      if (target.kind !== req.body.kind) {
        throw new AppError(
          'VALIDATION_FAILED',
          `File ${target.id} is a ${target.kind}, not a ${req.body.kind}`,
        );
      }
      const base = { fileId: target.id, partSize: UPLOAD_PART_SIZE };
      if (target.uploadedAt) {
        return { ...base, alreadyUploaded: true, uploadId: null, uploadedParts: [], parts: [] };
      }

      let uploadId = target.uploadId;
      let uploadedParts = uploadId ? await storage.listParts(target.s3Key, uploadId) : null;
      if (!uploadId || uploadedParts === null) {
        // First attempt, or the previous multipart upload expired: open a new one.
        if (await storage.exists(target.s3Key)) {
          await setUploadState(db, target, { uploadedAt: new Date() });
          return { ...base, alreadyUploaded: true, uploadId: null, uploadedParts: [], parts: [] };
        }
        uploadId = await storage.createMultipartUpload(target.s3Key, req.body.contentType);
        await setUploadState(db, target, { uploadId });
        uploadedParts = [];
      }

      const have = new Set(uploadedParts.map((p) => p.partNumber));
      const total = partCount(req.body.sizeBytes);
      const parts = await Promise.all(
        Array.from({ length: total }, (_, i) => i + 1)
          .filter((n) => !have.has(n))
          .map(async (partNumber) => ({
            partNumber,
            url: await storage.presignPart(target.s3Key, uploadId, partNumber),
          })),
      );
      return { ...base, alreadyUploaded: false, uploadId, uploadedParts, parts };
    },
  );

  app.post(
    '/:id/photos/complete',
    {
      schema: {
        tags: ['uploads'],
        security: [{ bearerAuth: [] }],
        params: idParams,
        body: completeUploadBodySchema,
        response: { 200: completeUploadResponseSchema, 404: apiErrorSchema, 409: apiErrorSchema },
      },
    },
    async (req) => {
      await loadOwned(req.params.id, req.user.sub);
      const target = await findTarget(db, req.params.id, req.body.fileId);

      if (!target.uploadedAt) {
        if (target.uploadId && target.uploadId !== req.body.uploadId) {
          throw new AppError('INVALID_STATE', 'Upload id is stale; request a new upload slot');
        }
        try {
          await storage.completeMultipartUpload(target.s3Key, req.body.uploadId, req.body.parts);
        } catch (err) {
          // A retried "complete" after S3 already finished: the object exists, so we are done.
          if (!(await storage.exists(target.s3Key))) throw err;
        }
      }

      const result = await db.transaction(async (tx) => {
        // Serialise completions per inspection so exactly one of them sees "0 remaining".
        const locked = await lockInspection(tx, req.params.id);
        const uploadedAt = target.uploadedAt ?? new Date();
        if (!target.uploadedAt) await setUploadState(tx, target, { uploadedAt });
        const remaining = (await pendingUploadIds(tx, req.params.id)).length;
        if (!target.uploadedAt && remaining === 0 && locked.status === 'submitted') {
          await addToOutbox(tx, [
            { type: 'generate_report', inspectionId: req.params.id, correlationId: req.id },
          ]);
        }
        return { fileId: target.id, uploadedAt: uploadedAt.toISOString(), remaining };
      });
      outbox.flush().catch((err: unknown) => req.log.warn({ err }, 'outbox flush deferred'));
      return result;
    },
  );
};
