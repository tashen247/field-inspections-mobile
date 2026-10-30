import { z } from 'zod';

/** S3 requires every part except the last to be at least 5 MiB. */
export const UPLOAD_PART_SIZE = 5 * 1024 * 1024;

export const uploadKindSchema = z.enum(['photo', 'signature']);
export type UploadKind = z.infer<typeof uploadKindSchema>;

export const startUploadBodySchema = z.object({
  fileId: z.uuid(),
  kind: uploadKindSchema,
  contentType: z.enum(['image/jpeg', 'image/png']),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(5 * 1024 * 1024),
});
export type StartUploadBody = z.infer<typeof startUploadBodySchema>;

export const startUploadResponseSchema = z.object({
  fileId: z.uuid(),
  /** True when the file is already stored; the client can skip straight to done. */
  alreadyUploaded: z.boolean(),
  uploadId: z.string().nullable(),
  partSize: z.number().int().positive(),
  /** Parts S3 already holds for this upload (for resume). */
  uploadedParts: z.array(z.object({ partNumber: z.number().int(), etag: z.string() })),
  /** Pre-signed PUT urls for the parts that still need sending. */
  parts: z.array(z.object({ partNumber: z.number().int().positive(), url: z.string() })),
});
export type StartUploadResponse = z.infer<typeof startUploadResponseSchema>;

export const completeUploadBodySchema = z.object({
  fileId: z.uuid(),
  uploadId: z.string().min(1),
  parts: z
    .array(z.object({ partNumber: z.number().int().positive(), etag: z.string().min(1) }))
    .min(1),
});
export type CompleteUploadBody = z.infer<typeof completeUploadBodySchema>;

export const completeUploadResponseSchema = z.object({
  fileId: z.uuid(),
  uploadedAt: z.iso.datetime(),
  /** How many uploads the server still expects for this inspection. */
  remaining: z.number().int().nonnegative(),
});
export type CompleteUploadResponse = z.infer<typeof completeUploadResponseSchema>;

export function partCount(sizeBytes: number, partSize = UPLOAD_PART_SIZE): number {
  return Math.max(1, Math.ceil(sizeBytes / partSize));
}
