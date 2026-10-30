import { z } from 'zod';
import { inspectionSchema } from './inspection.js';

export const errorCodeSchema = z.enum([
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VERSION_CONFLICT',
  'INVALID_STATE',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_KEY_REUSED',
  'REPORT_NOT_READY',
  'RATE_LIMITED',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const apiErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
  correlationId: z.string().optional(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const conflictReasonSchema = z.enum([
  /** The job now belongs to someone else. */
  'reassigned',
  /** A manager changed the job (e.g. due date, address) after the assessor downloaded it. */
  'modified',
  /** The job was already submitted, approved or otherwise closed. */
  'closed',
]);
export type ConflictReason = z.infer<typeof conflictReasonSchema>;

export const conflictDetailsSchema = z.object({
  reason: conflictReasonSchema,
  baseVersion: z.number().int(),
  current: inspectionSchema,
});
export type ConflictDetails = z.infer<typeof conflictDetailsSchema>;

export const conflictErrorSchema = apiErrorSchema.extend({
  code: z.literal('VERSION_CONFLICT'),
  details: conflictDetailsSchema,
});
export type ConflictError = z.infer<typeof conflictErrorSchema>;
