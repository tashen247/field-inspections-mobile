import type { InspectionDetail } from '@fim/shared';
import { asc, eq } from 'drizzle-orm';
import type { DbOrTx } from '@fim/db';
import {
  damagePins,
  gpsPoints,
  inspectionAnswers,
  inspectionPhotos,
  reports,
  reviewEvents,
  signatures,
  users,
} from '@fim/db';
import type { Storage } from './storage.js';
import { getInspectionDto } from './inspections.js';

/** Everything a reviewer needs on one screen, with short-lived image links. */
export async function loadInspectionDetail(
  db: DbOrTx,
  storage: Storage,
  id: string,
): Promise<InspectionDetail> {
  const inspection = await getInspectionDto(db, id);
  const [answers, photos, pins, sig, trail, events, report] = await Promise.all([
    db.select().from(inspectionAnswers).where(eq(inspectionAnswers.inspectionId, id)),
    db
      .select()
      .from(inspectionPhotos)
      .where(eq(inspectionPhotos.inspectionId, id))
      .orderBy(asc(inspectionPhotos.takenAt)),
    db.select().from(damagePins).where(eq(damagePins.inspectionId, id)),
    db.query.signatures.findFirst({ where: eq(signatures.inspectionId, id) }),
    db
      .select()
      .from(gpsPoints)
      .where(eq(gpsPoints.inspectionId, id))
      .orderBy(asc(gpsPoints.recordedAt)),
    db
      .select({ e: reviewEvents, actorName: users.name })
      .from(reviewEvents)
      .leftJoin(users, eq(users.id, reviewEvents.actorId))
      .where(eq(reviewEvents.inspectionId, id))
      .orderBy(asc(reviewEvents.createdAt)),
    db.query.reports.findFirst({ where: eq(reports.inspectionId, id) }),
  ]);

  return {
    inspection,
    answers: answers.map((a) => ({ itemKey: a.itemKey, value: a.value ?? null, note: a.note })),
    photos: await Promise.all(
      photos.map(async (p) => ({
        id: p.id,
        itemKey: p.itemKey,
        shotKey: p.shotKey,
        takenAt: p.takenAt.toISOString(),
        lat: p.lat,
        lng: p.lng,
        uploadedAt: p.uploadedAt?.toISOString() ?? null,
        url: p.uploadedAt ? await storage.presignGet(p.s3Key) : null,
      })),
    ),
    damagePins: pins.map((p) => ({
      id: p.id,
      diagram: p.diagram,
      x: p.x,
      y: p.y,
      severity: p.severity,
      note: p.note,
    })),
    signature: sig
      ? {
          signedName: sig.signedName,
          signedAt: sig.signedAt.toISOString(),
          uploadedAt: sig.uploadedAt?.toISOString() ?? null,
          url: sig.uploadedAt ? await storage.presignGet(sig.s3Key) : null,
        }
      : null,
    gpsTrail: trail.map((g) => ({
      lat: g.lat,
      lng: g.lng,
      accuracy: g.accuracy,
      recordedAt: g.recordedAt.toISOString(),
    })),
    events: events.map(({ e, actorName }) => ({
      id: e.id,
      kind: e.kind,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      comment: e.comment,
      actorId: e.actorId,
      actorName,
      createdAt: e.createdAt.toISOString(),
    })),
    report: report ? { generatedAt: report.generatedAt.toISOString() } : null,
  };
}
