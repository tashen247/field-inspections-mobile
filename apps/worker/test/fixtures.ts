import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  type Db,
} from '@fim/db';
import { VEHICLE_TEMPLATE, flattenItems, s3Keys } from '@fim/shared';
import { sql } from 'drizzle-orm';
import type { BlobStore } from '../src/storage.js';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../scripts/fixtures');
export const fixture = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));

export async function reset(db: Db) {
  await db.execute(sql`truncate table job_outbox, idempotency_keys, devices, reports, review_events,
    gps_points, damage_pins, signatures, inspection_photos, inspection_answers, inspections,
    templates, refresh_tokens, users restart identity cascade`);
}

/** A submitted vehicle inspection with every file stored, ready for a report. */
export async function seedSubmitted(db: Db, blobs: BlobStore, opts: { uploaded?: boolean } = {}) {
  const uploaded = opts.uploaded ?? true;
  const [assessor] = await db
    .insert(users)
    .values({ email: `a-${randomUUID()}@x.co.za`, name: 'Thandi Nkosi', role: 'assessor', passwordHash: 'x' })
    .returning();
  const [manager] = await db
    .insert(users)
    .values({ email: `m-${randomUUID()}@x.co.za`, name: 'Ayesha Moodley', role: 'manager', passwordHash: 'x' })
    .returning();
  const [template] = await db
    .insert(templates)
    .values({ name: 'Motor vehicle claim', type: 'vehicle', version: 1, schema: VEHICLE_TEMPLATE })
    .onConflictDoNothing()
    .returning();
  const t = template ?? (await db.query.templates.findFirst())!;
  const [insp] = await db
    .insert(inspections)
    .values({
      reference: `INS-TEST-${randomUUID().slice(0, 6)}`,
      templateId: t.id,
      templateVersion: 1,
      assigneeId: assessor!.id,
      claimNumber: 'CLM-445566',
      insuredName: 'Sipho Dlamini',
      insuredPhone: '0821234567',
      sumInsuredCents: 38_500_000,
      subject: { kind: 'vehicle', make: 'Toyota', model: 'Hilux 2.4 GD-6', year: 2021, registration: 'JHB 123 GP' },
      address: { line1: '100 Rivonia Road', suburb: 'Sandton', city: 'Johannesburg', postalCode: '2196' },
      lat: -26.1066,
      lng: 28.0567,
      dueAt: new Date('2026-10-30T12:00:00Z'),
      priority: 'high',
      status: 'submitted',
      version: 2,
      startedAt: new Date('2026-10-30T08:05:00Z'),
      startDistanceM: 34,
      completedAt: new Date('2026-10-30T08:50:00Z'),
      submittedAt: new Date('2026-10-30T08:51:00Z'),
    })
    .returning();
  const id = insp!.id;

  await db.insert(inspectionAnswers).values(
    flattenItems(VEHICLE_TEMPLATE).map(({ item }) => ({
      inspectionId: id,
      itemKey: item.key,
      value:
        item.key === 'exterior_overview'
          ? 'fail'
          : item.kind === 'passFail'
            ? 'pass'
            : item.kind === 'number'
              ? item.key === 'odometer'
                ? 123456
                : item.key === 'estimate_zar'
                  ? 18500
                  : 4.5
              : item.kind === 'select'
                ? item.options[0]!.value
                : 'Dent on the left rear door; otherwise in good condition.',
      note: item.key === 'exterior_overview' ? 'Dent and scratches on the left rear door, consistent with the claim.' : null,
    })),
  );

  const shots = ['front_left', 'front_right', 'rear_left', 'rear_right', 'vin_plate', 'odometer'];
  const items: Record<string, string> = {
    front_left: 'exterior_overview',
    front_right: 'exterior_overview',
    rear_left: 'exterior_overview',
    rear_right: 'exterior_overview',
    vin_plate: 'vin_matches',
    odometer: 'odometer',
  };
  for (const shot of shots) {
    const photoId = randomUUID();
    const key = s3Keys.photo(id, photoId);
    if (uploaded) await blobs.put(key, fixture(`${shot}.jpg`), 'image/jpeg');
    await db.insert(inspectionPhotos).values({
      id: photoId,
      inspectionId: id,
      itemKey: items[shot]!,
      shotKey: shot,
      s3Key: key,
      takenAt: new Date('2026-10-30T08:20:00Z'),
      lat: -26.10652,
      lng: 28.05681,
      sizeBytes: 26000,
      uploadedAt: uploaded ? new Date() : null,
    });
  }
  const sigId = randomUUID();
  const sigKey = s3Keys.signature(id, sigId);
  if (uploaded) await blobs.put(sigKey, fixture('signature.png'), 'image/png');
  await db.insert(signatures).values({
    id: sigId,
    inspectionId: id,
    s3Key: sigKey,
    signedName: 'Sipho Dlamini',
    signedAt: new Date('2026-10-30T08:48:00Z'),
    sizeBytes: 4000,
    uploadedAt: uploaded ? new Date() : null,
  });
  await db.insert(damagePins).values([
    { id: randomUUID(), inspectionId: id, diagram: 'vehicle-top', x: 0.12, y: 0.68, severity: 'moderate', note: 'Dent, left rear door' },
    { id: randomUUID(), inspectionId: id, diagram: 'vehicle-top', x: 0.5, y: 0.05, severity: 'minor', note: 'Stone chip on bonnet' },
  ]);
  await db.insert(gpsPoints).values([
    { inspectionId: id, lat: -26.1063, lng: 28.0565, accuracy: 8, recordedAt: new Date('2026-10-30T08:05:00Z') },
    { inspectionId: id, lat: -26.1066, lng: 28.0568, accuracy: 6, recordedAt: new Date('2026-10-30T08:30:00Z') },
  ]);
  await db.insert(reviewEvents).values([
    { inspectionId: id, kind: 'created', actorId: manager!.id, toStatus: 'assigned' },
    { inspectionId: id, kind: 'started', actorId: assessor!.id, fromStatus: 'assigned', toStatus: 'in_progress' },
    { inspectionId: id, kind: 'submitted', actorId: assessor!.id, fromStatus: 'in_progress', toStatus: 'submitted' },
  ]);
  return { id, assessorId: assessor!.id };
}
