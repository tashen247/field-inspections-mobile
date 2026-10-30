import { randomBytes } from 'node:crypto';
import {
  ASSESSOR_EDITABLE_STATUSES,
  GEOFENCE_RADIUS_METERS,
  REASSIGNABLE_STATUSES,
  type AuditEventKind,
  type ConflictReason,
  type CreateInspectionBody,
  type Inspection,
  type InspectionStatus,
  type ListInspectionsQuery,
  type ListInspectionsResponse,
  type ReviewBody,
  type StartBody,
  createInspectionBodySchema,
} from '@fim/shared';
import { and, asc, eq, gt, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { DbOrTx } from '@fim/db';
import { inspections, reviewEvents, templates, users } from '@fim/db';
import { decodeCursor, encodeCursor } from '../lib/cursor.js';
import { AppError, conflict, forbidden, notFound } from '../lib/errors.js';
import type { AccessTokenClaims } from '../plugins/auth.js';
import { addToOutbox } from './outbox.js';

const assignee = alias(users, 'assignee');

/** Microsecond-precision UTC text of updated_at, for keyset cursors. */
const updatedAtText = sql<string>`to_char(${inspections.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const inspectionColumns = {
  row: inspections,
  assigneeName: assignee.name,
  cursorTs: updatedAtText,
};

type InspectionRow = typeof inspections.$inferSelect;

export function toInspectionDto(row: InspectionRow, assigneeName: string | null): Inspection {
  return {
    id: row.id,
    reference: row.reference,
    templateId: row.templateId,
    templateVersion: row.templateVersion,
    assigneeId: row.assigneeId,
    assigneeName,
    claimNumber: row.claimNumber,
    insuredName: row.insuredName,
    insuredPhone: row.insuredPhone,
    sumInsuredCents: row.sumInsuredCents,
    subject: row.subject,
    address: row.address,
    location: { lat: row.lat, lng: row.lng },
    dueAt: row.dueAt.toISOString(),
    priority: row.priority,
    status: row.status,
    version: row.version,
    startedAt: row.startedAt?.toISOString() ?? null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    reviewComment: row.reviewComment,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function selectInspections(db: DbOrTx) {
  return db
    .select(inspectionColumns)
    .from(inspections)
    .leftJoin(assignee, eq(assignee.id, inspections.assigneeId));
}

export async function getInspectionDto(db: DbOrTx, id: string): Promise<Inspection> {
  const [found] = await selectInspections(db).where(eq(inspections.id, id)).limit(1);
  if (!found) throw notFound('Inspection');
  return toInspectionDto(found.row, found.assigneeName);
}

/** Loads and row-locks an inspection for the rest of the transaction. */
export async function lockInspection(tx: DbOrTx, id: string): Promise<InspectionRow> {
  const [row] = await tx.select().from(inspections).where(eq(inspections.id, id)).for('update');
  if (!row) throw notFound('Inspection');
  return row;
}

export function assertCanView(row: Pick<InspectionRow, 'assigneeId'>, user: AccessTokenClaims) {
  if (user.role === 'manager') return;
  if (row.assigneeId !== user.sub) throw forbidden('This inspection is not assigned to you');
}

export async function recordEvent(
  tx: DbOrTx,
  e: {
    inspectionId: string;
    kind: AuditEventKind;
    actorId: string | null;
    fromStatus?: InspectionStatus | null;
    toStatus?: InspectionStatus | null;
    fromAssigneeId?: string | null;
    toAssigneeId?: string | null;
    comment?: string | null;
  },
) {
  await tx.insert(reviewEvents).values({
    inspectionId: e.inspectionId,
    kind: e.kind,
    actorId: e.actorId,
    fromStatus: e.fromStatus ?? null,
    toStatus: e.toStatus ?? null,
    fromAssigneeId: e.fromAssigneeId ?? null,
    toAssigneeId: e.toAssigneeId ?? null,
    comment: e.comment ?? null,
  });
}

/**
 * Overlap applied to `serverTime` so rows written by transactions that were still in flight
 * when we read are picked up next time. Clients upsert, so re-delivery is harmless.
 */
const DELTA_OVERLAP_MS = 30_000;

export async function listInspections(
  db: DbOrTx,
  user: AccessTokenClaims,
  q: ListInspectionsQuery,
): Promise<ListInspectionsResponse> {
  // Assessors only ever see their own jobs, whatever they ask for.
  const onlyMine = q.assignedTo === 'me' || user.role === 'assessor';
  const cursor = q.cursor ? decodeCursor(q.cursor) : null;
  if (q.cursor && !cursor) throw new AppError('BAD_REQUEST', 'Invalid cursor');

  const serverTime = cursor?.serverTime ?? new Date(Date.now() - DELTA_OVERLAP_MS).toISOString();

  const filters: SQL[] = [];
  if (onlyMine) filters.push(eq(inspections.assigneeId, user.sub));
  if (q.status) filters.push(eq(inspections.status, q.status));
  if (q.since) filters.push(gt(inspections.updatedAt, new Date(q.since)));
  if (cursor) {
    filters.push(
      sql`(${inspections.updatedAt}, ${inspections.id}) > (${cursor.updatedAt}::timestamptz, ${cursor.id}::uuid)`,
    );
  }

  const rows = await selectInspections(db)
    .where(and(...filters))
    .orderBy(asc(inspections.updatedAt), asc(inspections.id))
    .limit(q.limit + 1);

  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  const nextCursor =
    rows.length > q.limit && last
      ? encodeCursor({ updatedAt: last.cursorTs, id: last.row.id, serverTime })
      : null;

  let removedIds: string[] = [];
  if (onlyMine && q.since && !cursor) {
    const removed = await db
      .selectDistinct({ id: reviewEvents.inspectionId })
      .from(reviewEvents)
      .innerJoin(inspections, eq(inspections.id, reviewEvents.inspectionId))
      .where(
        and(
          eq(reviewEvents.kind, 'assigned'),
          eq(reviewEvents.fromAssigneeId, user.sub),
          gt(reviewEvents.createdAt, new Date(q.since)),
          or(ne(inspections.assigneeId, user.sub), sql`${inspections.assigneeId} is null`),
        ),
      );
    removedIds = removed.map((r) => r.id);
  }

  return {
    items: page.map((r) => toInspectionDto(r.row, r.assigneeName)),
    removedIds,
    serverTime,
    nextCursor,
  };
}

function newReference(now = new Date()): string {
  const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = randomBytes(6);
  const suffix = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  return `INS-${ym}-${suffix}`;
}

export async function createInspection(
  tx: DbOrTx,
  actor: AccessTokenClaims,
  input: CreateInspectionBody,
): Promise<string> {
  const body = createInspectionBodySchema.parse(input);
  const template = await tx.query.templates.findFirst({ where: eq(templates.id, body.templateId) });
  if (!template) throw new AppError('VALIDATION_FAILED', 'Unknown template');
  if (template.type !== body.subject.kind) {
    throw new AppError(
      'VALIDATION_FAILED',
      `A ${template.type} template needs a ${template.type} subject`,
    );
  }
  if (body.assigneeId) await assertAssessor(tx, body.assigneeId);

  const [row] = await tx
    .insert(inspections)
    .values({
      reference: newReference(),
      templateId: template.id,
      templateVersion: template.version,
      assigneeId: body.assigneeId,
      claimNumber: body.claimNumber,
      insuredName: body.insuredName,
      insuredPhone: body.insuredPhone,
      sumInsuredCents: body.sumInsuredCents,
      subject: body.subject,
      address: body.address,
      lat: body.location.lat,
      lng: body.location.lng,
      dueAt: new Date(body.dueAt),
      priority: body.priority,
      status: 'assigned',
    })
    .returning({ id: inspections.id, reference: inspections.reference });
  if (!row) throw new Error('insert returned nothing');

  await recordEvent(tx, {
    inspectionId: row.id,
    kind: 'created',
    actorId: actor.sub,
    toStatus: 'assigned',
    toAssigneeId: body.assigneeId,
  });
  if (body.assigneeId) {
    await addToOutbox(tx, [
      {
        type: 'push',
        userId: body.assigneeId,
        title: 'New inspection assigned',
        body: `${row.reference} · ${body.address.line1}, ${body.address.city}`,
        data: { inspectionId: row.id, kind: 'assigned' },
        correlationId: row.id,
      },
    ]);
  }
  return row.id;
}

async function assertAssessor(tx: DbOrTx, userId: string) {
  const user = await tx.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user || user.role !== 'assessor') {
    throw new AppError('VALIDATION_FAILED', 'Inspections can only be assigned to assessors');
  }
}

export async function assignInspection(
  tx: DbOrTx,
  actor: AccessTokenClaims,
  id: string,
  assigneeId: string,
  baseVersion: number | undefined,
  correlationId: string,
): Promise<void> {
  const row = await lockInspection(tx, id);
  if (baseVersion !== undefined && baseVersion !== row.version) {
    throw conflict(
      { reason: 'modified', baseVersion, current: await getInspectionDto(tx, id) },
      'The inspection changed since you loaded it',
    );
  }
  if (!REASSIGNABLE_STATUSES.includes(row.status)) {
    throw new AppError('INVALID_STATE', `A ${row.status} inspection cannot be reassigned`);
  }
  if (row.assigneeId === assigneeId) return;
  await assertAssessor(tx, assigneeId);

  // A reassigned job starts fresh for the new assessor.
  const toStatus: InspectionStatus = row.status === 'in_progress' ? 'assigned' : row.status;
  await tx
    .update(inspections)
    .set({
      assigneeId,
      status: toStatus,
      version: sql`${inspections.version} + 1`,
      updatedAt: sql`now()`,
      ...(toStatus === 'assigned'
        ? { startedAt: null, startLat: null, startLng: null, startDistanceM: null }
        : {}),
    })
    .where(eq(inspections.id, id));
  await recordEvent(tx, {
    inspectionId: id,
    kind: 'assigned',
    actorId: actor.sub,
    fromStatus: row.status,
    toStatus,
    fromAssigneeId: row.assigneeId,
    toAssigneeId: assigneeId,
  });
  await addToOutbox(tx, [
    {
      type: 'push',
      userId: assigneeId,
      title: 'New inspection assigned',
      body: `${row.reference} · ${row.address.line1}, ${row.address.city}`,
      data: { inspectionId: id, kind: 'assigned' },
      correlationId,
    },
  ]);
}

export interface UpdateInspectionInput {
  baseVersion: number;
  dueAt?: string | undefined;
  priority?: Inspection['priority'] | undefined;
  insuredPhone?: string | null | undefined;
}

export async function updateInspection(
  tx: DbOrTx,
  id: string,
  input: UpdateInspectionInput,
): Promise<void> {
  const row = await lockInspection(tx, id);
  if (input.baseVersion !== row.version) {
    throw conflict(
      {
        reason: 'modified',
        baseVersion: input.baseVersion,
        current: await getInspectionDto(tx, id),
      },
      'The inspection changed since you loaded it',
    );
  }
  if (row.status === 'approved')
    throw new AppError('INVALID_STATE', 'Approved inspections are locked');
  await tx
    .update(inspections)
    .set({
      ...(input.dueAt ? { dueAt: new Date(input.dueAt) } : {}),
      ...(input.priority ? { priority: input.priority } : {}),
      ...(input.insuredPhone !== undefined ? { insuredPhone: input.insuredPhone } : {}),
      version: sql`${inspections.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(inspections.id, id));
}

/** The reason an assessor can no longer write to this inspection, if any. */
export function assessorConflictReason(
  row: Pick<InspectionRow, 'assigneeId' | 'status' | 'version'>,
  userId: string,
  baseVersion?: number,
): ConflictReason | null {
  if (row.assigneeId !== userId) return 'reassigned';
  if (!ASSESSOR_EDITABLE_STATUSES.includes(row.status)) return 'closed';
  if (baseVersion !== undefined && baseVersion !== row.version) return 'modified';
  return null;
}

export async function startInspection(
  tx: DbOrTx,
  user: AccessTokenClaims,
  id: string,
  body: StartBody,
): Promise<{ distanceMeters: number; withinGeofence: boolean }> {
  const row = await lockInspection(tx, id);
  const reason = assessorConflictReason(row, user.sub);
  if (reason) {
    throw conflict(
      { reason, baseVersion: row.version, current: await getInspectionDto(tx, id) },
      'This inspection can no longer be started',
    );
  }
  const [dist] = await tx
    .execute<{ meters: number }>(
      sql`select ST_Distance(${inspections.location}, ST_SetSRID(ST_MakePoint(${body.location.lng}, ${body.location.lat}), 4326)::geography) as meters from ${inspections} where ${inspections.id} = ${id}`,
    )
    .then((r) => r.rows);
  const distanceMeters = Number(dist?.meters ?? 0);
  const withinGeofence = distanceMeters <= GEOFENCE_RADIUS_METERS;

  // Starting twice (e.g. an offline retry) keeps the first start.
  if (row.status !== 'in_progress') {
    await tx
      .update(inspections)
      .set({
        status: 'in_progress',
        startedAt: row.startedAt ?? new Date(body.startedAt),
        startLat: body.location.lat,
        startLng: body.location.lng,
        startDistanceM: distanceMeters,
        updatedAt: sql`now()`,
      })
      .where(eq(inspections.id, id));
    await recordEvent(tx, {
      inspectionId: id,
      kind: 'started',
      actorId: user.sub,
      fromStatus: row.status,
      toStatus: 'in_progress',
      comment: withinGeofence ? null : `Started ${Math.round(distanceMeters)} m from the address`,
    });
  }
  return { distanceMeters, withinGeofence };
}

export async function reviewInspection(
  tx: DbOrTx,
  actor: AccessTokenClaims,
  id: string,
  body: ReviewBody,
  correlationId: string,
): Promise<void> {
  const row = await lockInspection(tx, id);
  if (row.version !== body.baseVersion) {
    throw conflict(
      {
        reason: 'modified',
        baseVersion: body.baseVersion,
        current: await getInspectionDto(tx, id),
      },
      'The inspection changed since you loaded it',
    );
  }
  if (row.status !== 'submitted') {
    throw new AppError(
      'INVALID_STATE',
      `Only submitted inspections can be reviewed (this one is ${row.status})`,
    );
  }
  const toStatus: InspectionStatus = body.action === 'approve' ? 'approved' : 'sent_back';
  const comment = body.comment?.trim() || null;
  await tx
    .update(inspections)
    .set({
      status: toStatus,
      reviewComment: body.action === 'send_back' ? comment : null,
      version: sql`${inspections.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(inspections.id, id));
  await recordEvent(tx, {
    inspectionId: id,
    kind: toStatus,
    actorId: actor.sub,
    fromStatus: row.status,
    toStatus,
    comment,
  });
  if (body.action === 'approve') {
    await addToOutbox(tx, [{ type: 'generate_report', inspectionId: id, correlationId }]);
  } else if (row.assigneeId) {
    await addToOutbox(tx, [
      {
        type: 'push',
        userId: row.assigneeId,
        title: 'Inspection sent back',
        body: `${row.reference}: ${comment ?? 'see comments'}`,
        data: { inspectionId: id, kind: 'sent_back' },
        correlationId,
      },
    ]);
  }
}
