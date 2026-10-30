import { z } from 'zod';
import {
  auditEventKindSchema,
  diagramSchema,
  inspectionStatusSchema,
  prioritySchema,
  severitySchema,
} from './enums.js';

export const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof latLngSchema>;

export const addressSchema = z.object({
  line1: z.string().min(1).max(200),
  suburb: z.string().max(100).optional(),
  city: z.string().min(1).max(100),
  province: z.string().max(100).optional(),
  postalCode: z.string().max(10).optional(),
});
export type Address = z.infer<typeof addressSchema>;

export function formatAddress(a: Address): string {
  return [a.line1, a.suburb, a.city, a.postalCode].filter(Boolean).join(', ');
}

export const vehicleSubjectSchema = z.object({
  kind: z.literal('vehicle'),
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.number().int().min(1950).max(2100).optional(),
  registration: z.string().min(1).max(20),
  vin: z.string().max(17).optional(),
  colour: z.string().optional(),
});

export const propertySubjectSchema = z.object({
  kind: z.literal('property'),
  propertyType: z.enum(['house', 'townhouse', 'apartment', 'commercial', 'industrial']),
  erfNumber: z.string().optional(),
  description: z.string().optional(),
});

export const subjectSchema = z.discriminatedUnion('kind', [
  vehicleSubjectSchema,
  propertySubjectSchema,
]);
export type Subject = z.infer<typeof subjectSchema>;

export const inspectionSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  templateId: z.uuid(),
  templateVersion: z.number().int().positive(),
  assigneeId: z.uuid().nullable(),
  assigneeName: z.string().nullable(),
  claimNumber: z.string().nullable(),
  insuredName: z.string(),
  insuredPhone: z.string().nullable(),
  /** Insured or claimed value in South African cents. */
  sumInsuredCents: z.number().int().nonnegative().nullable(),
  subject: subjectSchema,
  address: addressSchema,
  location: latLngSchema,
  dueAt: z.iso.datetime(),
  priority: prioritySchema,
  status: inspectionStatusSchema,
  version: z.number().int().positive(),
  startedAt: z.iso.datetime().nullable(),
  submittedAt: z.iso.datetime().nullable(),
  /** Latest manager comment when the inspection was sent back. */
  reviewComment: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Inspection = z.infer<typeof inspectionSchema>;

export const listInspectionsQuerySchema = z.object({
  assignedTo: z.enum(['me']).optional(),
  status: inspectionStatusSchema.optional(),
  /** Delta sync: only rows changed strictly after this instant. */
  since: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  cursor: z.string().optional(),
});
export type ListInspectionsQuery = z.infer<typeof listInspectionsQuerySchema>;

export const listInspectionsResponseSchema = z.object({
  items: z.array(inspectionSchema),
  /** Inspections the caller previously held that were reassigned away since `since`. */
  removedIds: z.array(z.uuid()),
  /** Pass as `since` on the next delta sync once all pages are consumed. */
  serverTime: z.iso.datetime(),
  nextCursor: z.string().nullable(),
});
export type ListInspectionsResponse = z.infer<typeof listInspectionsResponseSchema>;

export const createInspectionBodySchema = z.object({
  templateId: z.uuid(),
  assigneeId: z.uuid().nullable().default(null),
  claimNumber: z.string().max(40).nullable().default(null),
  insuredName: z.string().min(1).max(120),
  insuredPhone: z.string().max(20).nullable().default(null),
  sumInsuredCents: z.number().int().nonnegative().nullable().default(null),
  subject: subjectSchema,
  address: addressSchema,
  location: latLngSchema,
  dueAt: z.iso.datetime(),
  priority: prioritySchema.default('normal'),
});
export type CreateInspectionBody = z.input<typeof createInspectionBodySchema>;

export const assignBodySchema = z.object({
  assigneeId: z.uuid(),
  baseVersion: z.number().int().positive().optional(),
});
export type AssignBody = z.infer<typeof assignBodySchema>;

export const startBodySchema = z.object({
  startedAt: z.iso.datetime(),
  location: latLngSchema.extend({ accuracy: z.number().nonnegative().optional() }),
});
export type StartBody = z.infer<typeof startBodySchema>;

export const GEOFENCE_RADIUS_METERS = 200;

export const startResponseSchema = z.object({
  inspection: inspectionSchema,
  distanceMeters: z.number(),
  withinGeofence: z.boolean(),
});
export type StartResponse = z.infer<typeof startResponseSchema>;

export const answerValueSchema = z.union([
  z.enum(['pass', 'fail', 'na']),
  z.number(),
  z.string(),
  z.null(),
]);
export type AnswerValue = z.infer<typeof answerValueSchema>;

export const answerSchema = z.object({
  itemKey: z.string().min(1),
  value: answerValueSchema,
  note: z.string().max(2000).nullable().default(null),
});
export type Answer = z.input<typeof answerSchema>;

export const damagePinSchema = z.object({
  id: z.uuid(),
  diagram: diagramSchema,
  /** Normalised 0..1 coordinates on the diagram, so pins survive any screen size. */
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  severity: severitySchema,
  note: z.string().max(500).nullable().default(null),
});
export type DamagePin = z.input<typeof damagePinSchema>;

export const photoManifestEntrySchema = z.object({
  id: z.uuid(),
  itemKey: z.string().min(1),
  /** Guided shot key, if this photo fulfils one. */
  shotKey: z.string().nullable().default(null),
  takenAt: z.iso.datetime(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(5 * 1024 * 1024),
});
export type PhotoManifestEntry = z.input<typeof photoManifestEntrySchema>;

export const gpsPointSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number().nonnegative().nullable(),
  recordedAt: z.iso.datetime(),
});
export type GpsPoint = z.infer<typeof gpsPointSchema>;

export const signatureInputSchema = z.object({
  /** Client-generated id of the signature image upload. */
  fileId: z.uuid(),
  signedName: z.string().min(1).max(120),
  signedAt: z.iso.datetime(),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(2 * 1024 * 1024),
});
export type SignatureInput = z.infer<typeof signatureInputSchema>;

export const submissionBodySchema = z.object({
  baseVersion: z.number().int().positive(),
  templateVersion: z.number().int().positive(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  answers: z.array(answerSchema).max(1000),
  damagePins: z.array(damagePinSchema).max(500),
  photos: z.array(photoManifestEntrySchema).max(500),
  signature: signatureInputSchema.nullable(),
  gpsTrail: z.array(gpsPointSchema).max(10000),
});
export type SubmissionBody = z.input<typeof submissionBodySchema>;

export const submissionResponseSchema = z.object({
  inspection: inspectionSchema,
  /** Uploads the server is still waiting for (photo ids + signature file id). */
  pendingUploadIds: z.array(z.uuid()),
});
export type SubmissionResponse = z.infer<typeof submissionResponseSchema>;

export const reviewBodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
    baseVersion: z.number().int().positive(),
    comment: z.string().max(2000).optional(),
  }),
  z.object({
    action: z.literal('send_back'),
    baseVersion: z.number().int().positive(),
    comment: z.string().trim().min(3, 'a comment is required when sending back').max(2000),
  }),
]);
export type ReviewBody = z.infer<typeof reviewBodySchema>;

export const auditEventSchema = z.object({
  id: z.uuid(),
  kind: auditEventKindSchema,
  fromStatus: inspectionStatusSchema.nullable(),
  toStatus: inspectionStatusSchema.nullable(),
  comment: z.string().nullable(),
  actorId: z.uuid().nullable(),
  actorName: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

export const inspectionPhotoSchema = z.object({
  id: z.uuid(),
  itemKey: z.string(),
  shotKey: z.string().nullable(),
  takenAt: z.iso.datetime(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  uploadedAt: z.iso.datetime().nullable(),
  /** Short-lived pre-signed GET url when uploaded. */
  url: z.string().nullable(),
});
export type InspectionPhoto = z.infer<typeof inspectionPhotoSchema>;

export const inspectionDetailSchema = z.object({
  inspection: inspectionSchema,
  answers: z.array(answerSchema.extend({ note: z.string().nullable() })),
  photos: z.array(inspectionPhotoSchema),
  damagePins: z.array(damagePinSchema.extend({ note: z.string().nullable() })),
  signature: z
    .object({
      signedName: z.string(),
      signedAt: z.iso.datetime(),
      uploadedAt: z.iso.datetime().nullable(),
      url: z.string().nullable(),
    })
    .nullable(),
  gpsTrail: z.array(gpsPointSchema),
  events: z.array(auditEventSchema),
  report: z.object({ generatedAt: z.iso.datetime() }).nullable(),
});
export type InspectionDetail = z.infer<typeof inspectionDetailSchema>;

export const reportResponseSchema = z.object({
  url: z.string(),
  generatedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type ReportResponse = z.infer<typeof reportResponseSchema>;
