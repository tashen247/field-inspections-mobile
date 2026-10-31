import { z } from 'zod';

export const roleSchema = z.enum(['assessor', 'manager']);
export type Role = z.infer<typeof roleSchema>;

export const inspectionStatusSchema = z.enum([
  'assigned',
  'in_progress',
  'submitted',
  'approved',
  'sent_back',
]);
export type InspectionStatus = z.infer<typeof inspectionStatusSchema>;

export const INSPECTION_STATUS_LABELS: Record<InspectionStatus, string> = {
  assigned: 'Assigned',
  in_progress: 'In progress',
  submitted: 'Submitted',
  approved: 'Approved',
  sent_back: 'Sent back',
};

export const prioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
export type Priority = z.infer<typeof prioritySchema>;

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

export const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export const templateTypeSchema = z.enum(['vehicle', 'property']);
export type TemplateType = z.infer<typeof templateTypeSchema>;

export const severitySchema = z.enum(['minor', 'moderate', 'severe']);
export type Severity = z.infer<typeof severitySchema>;

export const diagramSchema = z.enum(['vehicle-top', 'floor-plan']);
export type Diagram = z.infer<typeof diagramSchema>;

export const auditEventKindSchema = z.enum([
  'created',
  'assigned',
  'started',
  'submitted',
  'approved',
  'sent_back',
  'report_generated',
]);
export type AuditEventKind = z.infer<typeof auditEventKindSchema>;

/** Statuses in which an assessor may still change (and submit) an inspection. */
export const ASSESSOR_EDITABLE_STATUSES: readonly InspectionStatus[] = [
  'assigned',
  'in_progress',
  'sent_back',
];

/** Statuses in which a manager may reassign the job. */
export const REASSIGNABLE_STATUSES: readonly InspectionStatus[] = [
  'assigned',
  'in_progress',
  'sent_back',
];
