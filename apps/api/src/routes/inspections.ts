import {
  apiErrorSchema,
  assignBodySchema,
  conflictErrorSchema,
  createInspectionBodySchema,
  inspectionDetailSchema,
  inspectionSchema,
  listInspectionsQuerySchema,
  listInspectionsResponseSchema,
  prioritySchema,
  reportResponseSchema,
  reviewBodySchema,
  startBodySchema,
  startResponseSchema,
  submissionBodySchema,
  submissionResponseSchema,
  type SubmissionResponse,
} from '@fim/shared';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { reports } from '@fim/db';
import { AppError } from '../lib/errors.js';
import { loadInspectionDetail } from '../services/detail.js';
import { withIdempotency } from '../services/idempotency.js';
import {
  assertCanView,
  assignInspection,
  createInspection,
  getInspectionDto,
  listInspections,
  reviewInspection,
  startInspection,
  updateInspection,
} from '../services/inspections.js';
import { applySubmission } from '../services/submission.js';

const idParams = z.object({ id: z.uuid() });
const secured = [{ bearerAuth: [] }];

export const inspectionRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, storage, outbox } = app.deps;
  app.addHook('onRequest', app.authenticate);

  /** Relay any jobs the request queued; failures stay in the outbox for the next sweep. */
  const relay = (log: { warn: (o: object, m: string) => void }) => {
    outbox.flush().catch((err: unknown) => log.warn({ err }, 'outbox flush deferred'));
  };

  app.get(
    '/',
    {
      schema: {
        tags: ['inspections'],
        security: secured,
        description:
          'Delta sync and listing. Pass `since` (the previous `serverTime`) to fetch only changes; ' +
          'follow `nextCursor` until it is null. Assessors only ever receive their own jobs.',
        querystring: listInspectionsQuerySchema,
        response: { 200: listInspectionsResponseSchema, 400: apiErrorSchema },
      },
    },
    async (req) => listInspections(db, req.user, req.query),
  );

  app.post(
    '/',
    {
      onRequest: [app.requireRole('manager')],
      schema: {
        tags: ['inspections'],
        security: secured,
        body: createInspectionBodySchema,
        response: { 201: inspectionSchema, 422: apiErrorSchema },
      },
    },
    async (req, reply) => {
      const id = await db.transaction((tx) => createInspection(tx, req.user, req.body));
      relay(req.log);
      return reply.status(201).send(await getInspectionDto(db, id));
    },
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['inspections'],
        security: secured,
        params: idParams,
        response: { 200: inspectionDetailSchema, 403: apiErrorSchema, 404: apiErrorSchema },
      },
    },
    async (req) => {
      const inspection = await getInspectionDto(db, req.params.id);
      assertCanView(inspection, req.user);
      return loadInspectionDetail(db, storage, req.params.id);
    },
  );

  app.patch(
    '/:id',
    {
      onRequest: [app.requireRole('manager')],
      schema: {
        tags: ['inspections'],
        security: secured,
        description:
          'Manager edits to a job. Bumps the version, so offline assessors see a conflict.',
        params: idParams,
        body: z.object({
          baseVersion: z.number().int().positive(),
          dueAt: z.iso.datetime().optional(),
          priority: prioritySchema.optional(),
          insuredPhone: z.string().max(20).nullable().optional(),
        }),
        response: { 200: inspectionSchema, 409: conflictErrorSchema.or(apiErrorSchema) },
      },
    },
    async (req) => {
      await db.transaction((tx) => updateInspection(tx, req.params.id, req.body));
      return getInspectionDto(db, req.params.id);
    },
  );

  app.patch(
    '/:id/assign',
    {
      onRequest: [app.requireRole('manager')],
      schema: {
        tags: ['inspections'],
        security: secured,
        params: idParams,
        body: assignBodySchema,
        response: { 200: inspectionSchema, 409: conflictErrorSchema.or(apiErrorSchema) },
      },
    },
    async (req) => {
      await db.transaction((tx) =>
        assignInspection(
          tx,
          req.user,
          req.params.id,
          req.body.assigneeId,
          req.body.baseVersion,
          req.id,
        ),
      );
      relay(req.log);
      return getInspectionDto(db, req.params.id);
    },
  );

  app.post(
    '/:id/start',
    {
      onRequest: [app.requireRole('assessor')],
      schema: {
        tags: ['inspections'],
        security: secured,
        description: 'Marks the job in progress. Safe to repeat; the first start time is kept.',
        params: idParams,
        body: startBodySchema,
        response: { 200: startResponseSchema, 409: conflictErrorSchema },
      },
    },
    async (req) => {
      const geo = await db.transaction((tx) =>
        startInspection(tx, req.user, req.params.id, req.body),
      );
      return { inspection: await getInspectionDto(db, req.params.id), ...geo };
    },
  );

  app.put(
    '/:id/submission',
    {
      onRequest: [app.requireRole('assessor')],
      schema: {
        tags: ['inspections'],
        security: secured,
        description:
          'Submits the completed checklist. Requires an `Idempotency-Key` header: repeating a request ' +
          'with the same key returns the original response. `baseVersion` is the version the device ' +
          'downloaded; a mismatch returns 409 with the current inspection.',
        params: idParams,
        headers: z.object({ 'idempotency-key': z.string().optional() }),
        body: submissionBodySchema,
        response: {
          200: submissionResponseSchema,
          400: apiErrorSchema,
          409: conflictErrorSchema,
          422: apiErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const result = await withIdempotency<SubmissionResponse>(
        db,
        {
          userId: req.user.sub,
          key: req.headers['idempotency-key'],
          route: `PUT /v1/inspections/${req.params.id}/submission`,
          body: req.body,
        },
        async (tx) => ({
          statusCode: 200,
          body: await applySubmission(tx, req.user, req.params.id, req.body, req.id),
        }),
      );
      if (result.replayed) reply.header('idempotent-replayed', 'true');
      else relay(req.log);
      return reply.status(result.statusCode as 200).send(result.body);
    },
  );

  app.patch(
    '/:id/review',
    {
      onRequest: [app.requireRole('manager')],
      schema: {
        tags: ['inspections'],
        security: secured,
        description:
          'Approve, or send back with a comment. Every review is written to the audit trail.',
        params: idParams,
        body: reviewBodySchema,
        response: { 200: inspectionSchema, 409: conflictErrorSchema.or(apiErrorSchema) },
      },
    },
    async (req) => {
      await db.transaction((tx) => reviewInspection(tx, req.user, req.params.id, req.body, req.id));
      relay(req.log);
      return getInspectionDto(db, req.params.id);
    },
  );

  app.get(
    '/:id/report',
    {
      schema: {
        tags: ['inspections'],
        security: secured,
        description: 'Short-lived download link for the generated PDF report.',
        params: idParams,
        response: { 200: reportResponseSchema, 409: apiErrorSchema },
      },
    },
    async (req) => {
      const inspection = await getInspectionDto(db, req.params.id);
      assertCanView(inspection, req.user);
      const report = await db.query.reports.findFirst({
        where: eq(reports.inspectionId, req.params.id),
      });
      if (!report) throw new AppError('REPORT_NOT_READY', 'The report has not been generated yet');
      const ttl = app.deps.config.PRESIGN_TTL_SECONDS;
      return {
        url: await storage.presignGet(report.s3Key, `${inspection.reference}.pdf`),
        generatedAt: report.generatedAt.toISOString(),
        expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      };
    },
  );
};
