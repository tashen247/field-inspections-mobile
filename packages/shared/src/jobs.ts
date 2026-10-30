import { z } from 'zod';

/** Messages the API puts on SQS for the worker. */
export const generateReportJobSchema = z.object({
  type: z.literal('generate_report'),
  inspectionId: z.uuid(),
  correlationId: z.string(),
});

export const pushJobSchema = z.object({
  type: z.literal('push'),
  userId: z.uuid(),
  title: z.string(),
  body: z.string(),
  data: z.record(z.string(), z.string()).default({}),
  correlationId: z.string(),
});

export const jobSchema = z.discriminatedUnion('type', [generateReportJobSchema, pushJobSchema]);
export type Job = z.input<typeof jobSchema>;
export type GenerateReportJob = z.infer<typeof generateReportJobSchema>;
export type PushJob = z.infer<typeof pushJobSchema>;

/** S3 key layout, shared so the worker and API agree. */
export const s3Keys = {
  photo: (inspectionId: string, photoId: string) =>
    `inspections/${inspectionId}/photos/${photoId}.jpg`,
  signature: (inspectionId: string, fileId: string) =>
    `inspections/${inspectionId}/signature/${fileId}.png`,
  report: (inspectionId: string, version: number) =>
    `inspections/${inspectionId}/reports/report-v${version}.pdf`,
};
