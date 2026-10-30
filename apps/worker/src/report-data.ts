import {
  damagePins,
  gpsPoints,
  inspectionAnswers,
  inspectionPhotos,
  inspections,
  reviewEvents,
  signatures,
  templates,
  users,
  type DbOrTx,
} from '@fim/db';
import type {
  Address,
  AnswerValue,
  AuditEventKind,
  Diagram,
  InspectionStatus,
  Priority,
  Severity,
  Subject,
  TemplateBody,
} from '@fim/shared';
import { asc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

export interface ReportData {
  id: string;
  reference: string;
  version: number;
  status: InspectionStatus;
  priority: Priority;
  claimNumber: string | null;
  insuredName: string;
  insuredPhone: string | null;
  sumInsuredCents: number | null;
  subject: Subject;
  address: Address;
  location: { lat: number; lng: number };
  assessorName: string | null;
  dueAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  submittedAt: Date | null;
  startDistanceM: number | null;
  templateName: string;
  templateVersion: number;
  template: TemplateBody;
  answers: Map<string, { value: AnswerValue | null; note: string | null }>;
  photos: { id: string; itemKey: string; shotKey: string | null; s3Key: string; takenAt: Date; lat: number | null; lng: number | null; uploaded: boolean }[];
  pins: { diagram: Diagram; x: number; y: number; severity: Severity; note: string | null }[];
  signature: { s3Key: string; signedName: string; signedAt: Date; uploaded: boolean } | null;
  gps: { lat: number; lng: number; recordedAt: Date }[];
  events: { kind: AuditEventKind; comment: string | null; actorName: string | null; createdAt: Date }[];
}

export async function loadReportData(db: DbOrTx, id: string): Promise<ReportData | null> {
  const assessor = alias(users, 'assessor');
  const [row] = await db
    .select({ i: inspections, assessorName: assessor.name, t: templates })
    .from(inspections)
    .innerJoin(templates, eq(templates.id, inspections.templateId))
    .leftJoin(assessor, eq(assessor.id, inspections.assigneeId))
    .where(eq(inspections.id, id));
  if (!row) return null;
  const { i, t } = row;
  const [answers, photos, pins, sig, gps, events] = await Promise.all([
    db.select().from(inspectionAnswers).where(eq(inspectionAnswers.inspectionId, id)),
    db
      .select()
      .from(inspectionPhotos)
      .where(eq(inspectionPhotos.inspectionId, id))
      .orderBy(asc(inspectionPhotos.takenAt)),
    db.select().from(damagePins).where(eq(damagePins.inspectionId, id)),
    db.select().from(signatures).where(eq(signatures.inspectionId, id)),
    db.select().from(gpsPoints).where(eq(gpsPoints.inspectionId, id)).orderBy(asc(gpsPoints.recordedAt)),
    db
      .select({ e: reviewEvents, actorName: users.name })
      .from(reviewEvents)
      .leftJoin(users, eq(users.id, reviewEvents.actorId))
      .where(eq(reviewEvents.inspectionId, id))
      .orderBy(asc(reviewEvents.createdAt)),
  ]);
  return {
    id: i.id,
    reference: i.reference,
    version: i.version,
    status: i.status,
    priority: i.priority,
    claimNumber: i.claimNumber,
    insuredName: i.insuredName,
    insuredPhone: i.insuredPhone,
    sumInsuredCents: i.sumInsuredCents,
    subject: i.subject,
    address: i.address,
    location: { lat: i.lat, lng: i.lng },
    assessorName: row.assessorName,
    dueAt: i.dueAt,
    startedAt: i.startedAt,
    completedAt: i.completedAt,
    submittedAt: i.submittedAt,
    startDistanceM: i.startDistanceM,
    templateName: t.name,
    templateVersion: t.version,
    template: t.schema,
    answers: new Map(answers.map((a) => [a.itemKey, { value: a.value ?? null, note: a.note }])),
    photos: photos.map((p) => ({
      id: p.id,
      itemKey: p.itemKey,
      shotKey: p.shotKey,
      s3Key: p.s3Key,
      takenAt: p.takenAt,
      lat: p.lat,
      lng: p.lng,
      uploaded: p.uploadedAt !== null,
    })),
    pins: pins.map((p) => ({ diagram: p.diagram, x: p.x, y: p.y, severity: p.severity, note: p.note })),
    signature: sig[0]
      ? {
          s3Key: sig[0].s3Key,
          signedName: sig[0].signedName,
          signedAt: sig[0].signedAt,
          uploaded: sig[0].uploadedAt !== null,
        }
      : null,
    gps: gps.map((g) => ({ lat: g.lat, lng: g.lng, recordedAt: g.recordedAt })),
    events: events.map(({ e, actorName }) => ({
      kind: e.kind,
      comment: e.comment,
      actorName,
      createdAt: e.createdAt,
    })),
  };
}
