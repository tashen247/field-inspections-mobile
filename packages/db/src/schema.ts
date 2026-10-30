import type {
  Address,
  AnswerValue,
  AuditEventKind,
  Diagram,
  InspectionStatus,
  Priority,
  Role,
  Severity,
  Subject,
  TemplateBody,
  TemplateType,
} from '@fim/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** PostGIS geography point. Written through a generated column, read via ST_X/ST_Y. */
const geographyPoint = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'geography(Point,4326)';
  },
});

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').$type<Role>().notNull(),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    /** All tokens issued from one login share a family, so reuse revokes the whole chain. */
    familyId: uuid('family_id').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    revokedAt: tstz('revoked_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [index('refresh_tokens_family_idx').on(t.familyId)],
);

export const templates = pgTable(
  'templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    type: text('type').$type<TemplateType>().notNull(),
    version: integer('version').notNull(),
    schema: jsonb('schema').$type<TemplateBody>().notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('templates_type_version_uq').on(t.type, t.version)],
);

export const inspections = pgTable(
  'inspections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reference: text('reference').notNull().unique(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id),
    templateVersion: integer('template_version').notNull(),
    assigneeId: uuid('assignee_id').references(() => users.id),
    claimNumber: text('claim_number'),
    insuredName: text('insured_name').notNull(),
    insuredPhone: text('insured_phone'),
    sumInsuredCents: bigint('sum_insured_cents', { mode: 'number' }),
    subject: jsonb('subject').$type<Subject>().notNull(),
    address: jsonb('address').$type<Address>().notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    location: geographyPoint('location')
      .notNull()
      .generatedAlwaysAs(sql`(ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography)`),
    dueAt: tstz('due_at').notNull(),
    priority: text('priority').$type<Priority>().notNull().default('normal'),
    status: text('status').$type<InspectionStatus>().notNull().default('assigned'),
    version: integer('version').notNull().default(1),
    startedAt: tstz('started_at'),
    startLat: doublePrecision('start_lat'),
    startLng: doublePrecision('start_lng'),
    startDistanceM: doublePrecision('start_distance_m'),
    completedAt: tstz('completed_at'),
    submittedAt: tstz('submitted_at'),
    reviewComment: text('review_comment'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('inspections_assignee_updated_idx').on(t.assigneeId, t.updatedAt, t.id),
    index('inspections_updated_idx').on(t.updatedAt, t.id),
    index('inspections_status_idx').on(t.status, t.updatedAt),
    index('inspections_location_gix').using('gist', t.location),
  ],
);

export const inspectionAnswers = pgTable(
  'inspection_answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    inspectionId: uuid('inspection_id')
      .notNull()
      .references(() => inspections.id, { onDelete: 'cascade' }),
    itemKey: text('item_key').notNull(),
    value: jsonb('value').$type<AnswerValue>(),
    note: text('note'),
  },
  (t) => [uniqueIndex('inspection_answers_item_uq').on(t.inspectionId, t.itemKey)],
);

export const inspectionPhotos = pgTable(
  'inspection_photos',
  {
    /** Generated on the device so retries never create duplicates. */
    id: uuid('id').primaryKey(),
    inspectionId: uuid('inspection_id')
      .notNull()
      .references(() => inspections.id, { onDelete: 'cascade' }),
    itemKey: text('item_key').notNull(),
    shotKey: text('shot_key'),
    s3Key: text('s3_key').notNull(),
    takenAt: tstz('taken_at').notNull(),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    sizeBytes: integer('size_bytes').notNull(),
    uploadId: text('upload_id'),
    uploadedAt: tstz('uploaded_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [index('inspection_photos_inspection_idx').on(t.inspectionId)],
);

export const signatures = pgTable('signatures', {
  /** Client-generated file id of the signature image. */
  id: uuid('id').primaryKey(),
  inspectionId: uuid('inspection_id')
    .notNull()
    .unique()
    .references(() => inspections.id, { onDelete: 'cascade' }),
  s3Key: text('s3_key').notNull(),
  signedName: text('signed_name').notNull(),
  signedAt: tstz('signed_at').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  uploadId: text('upload_id'),
  uploadedAt: tstz('uploaded_at'),
});

export const damagePins = pgTable(
  'damage_pins',
  {
    id: uuid('id').primaryKey(),
    inspectionId: uuid('inspection_id')
      .notNull()
      .references(() => inspections.id, { onDelete: 'cascade' }),
    diagram: text('diagram').$type<Diagram>().notNull(),
    x: doublePrecision('x').notNull(),
    y: doublePrecision('y').notNull(),
    severity: text('severity').$type<Severity>().notNull(),
    note: text('note'),
  },
  (t) => [index('damage_pins_inspection_idx').on(t.inspectionId)],
);

export const gpsPoints = pgTable(
  'gps_points',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    inspectionId: uuid('inspection_id')
      .notNull()
      .references(() => inspections.id, { onDelete: 'cascade' }),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    accuracy: doublePrecision('accuracy'),
    recordedAt: tstz('recorded_at').notNull(),
  },
  (t) => [index('gps_points_inspection_idx').on(t.inspectionId, t.recordedAt)],
);

/** Audit trail of every state change (the PRD's ReviewEvent, widened to cover assignment). */
export const reviewEvents = pgTable(
  'review_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    inspectionId: uuid('inspection_id')
      .notNull()
      .references(() => inspections.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<AuditEventKind>().notNull(),
    fromStatus: text('from_status').$type<InspectionStatus>(),
    toStatus: text('to_status').$type<InspectionStatus>(),
    fromAssigneeId: uuid('from_assignee_id').references(() => users.id),
    toAssigneeId: uuid('to_assignee_id').references(() => users.id),
    comment: text('comment'),
    actorId: uuid('actor_id').references(() => users.id),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('review_events_inspection_idx').on(t.inspectionId, t.createdAt),
    index('review_events_from_assignee_idx').on(t.fromAssigneeId, t.createdAt),
  ],
);

export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  inspectionId: uuid('inspection_id')
    .notNull()
    .unique()
    .references(() => inspections.id, { onDelete: 'cascade' }),
  s3Key: text('s3_key').notNull(),
  inspectionVersion: integer('inspection_version').notNull(),
  generatedAt: tstz('generated_at').notNull().defaultNow(),
});

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    route: text('route').notNull(),
    requestHash: text('request_hash').notNull(),
    statusCode: integer('status_code').notNull(),
    response: jsonb('response').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expoPushToken: text('expo_push_token').notNull().unique(),
    platform: text('platform').$type<'ios' | 'android'>().notNull(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('devices_user_idx').on(t.userId)],
);

/**
 * Transactional outbox: jobs are written in the same transaction as the state change and
 * relayed to SQS afterwards, so a queue outage can never lose a report or notification.
 */
export const jobOutbox = pgTable('job_outbox', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  payload: jsonb('payload').notNull(),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  createdAt: tstz('created_at').notNull().defaultNow(),
});
