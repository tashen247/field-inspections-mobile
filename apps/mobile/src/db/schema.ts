import type {
  AnswerValue,
  ConflictDetails,
  Diagram,
  Inspection,
  InspectionStatus,
  Severity,
  TemplateBody,
  TemplateType,
} from '@fim/shared';
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Local workflow state, separate from the server status:
 * - idle: downloaded, not touched
 * - working: assessor has started capturing
 * - queued: submitted on device, waiting for sync
 * - syncing: outbox is sending it
 * - synced: server accepted data and every upload
 * - conflict: server refused because the job changed; needs a decision
 */
export type LocalState = 'idle' | 'working' | 'queued' | 'syncing' | 'synced' | 'conflict';

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    data: text('data', { mode: 'json' }).$type<Inspection>().notNull(),
    status: text('status').$type<InspectionStatus>().notNull(),
    version: integer('version').notNull(),
    dueAt: text('due_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    localState: text('local_state').$type<LocalState>().notNull().default('idle'),
    conflict: text('conflict', { mode: 'json' }).$type<ConflictDetails>(),
    downloadedAt: text('downloaded_at').notNull(),
  },
  (t) => [index('jobs_due_idx').on(t.dueAt)],
);

export const templates = sqliteTable('templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').$type<TemplateType>().notNull(),
  version: integer('version').notNull(),
  schema: text('schema', { mode: 'json' }).$type<TemplateBody>().notNull(),
});

/** One in-progress inspection on this device. Written before anything touches the network. */
export const drafts = sqliteTable('drafts', {
  inspectionId: text('inspection_id').primaryKey(),
  baseVersion: integer('base_version').notNull(),
  templateId: text('template_id').notNull(),
  templateVersion: integer('template_version').notNull(),
  startedAt: text('started_at').notNull(),
  startLat: real('start_lat'),
  startLng: real('start_lng'),
  startDistanceM: real('start_distance_m'),
  completedAt: text('completed_at'),
  signatureFileId: text('signature_file_id'),
  signatureUri: text('signature_uri'),
  signatureSize: integer('signature_size'),
  signedName: text('signed_name'),
  signedAt: text('signed_at'),
  updatedAt: text('updated_at').notNull(),
});

export const answers = sqliteTable(
  'answers',
  {
    inspectionId: text('inspection_id').notNull(),
    itemKey: text('item_key').notNull(),
    value: text('value', { mode: 'json' }).$type<AnswerValue>(),
    note: text('note'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.inspectionId, t.itemKey] })],
);

export type UploadState = 'local' | 'pending' | 'uploading' | 'uploaded';

export const photos = sqliteTable(
  'photos',
  {
    id: text('id').primaryKey(),
    inspectionId: text('inspection_id').notNull(),
    itemKey: text('item_key').notNull(),
    shotKey: text('shot_key'),
    fileUri: text('file_uri').notNull(),
    takenAt: text('taken_at').notNull(),
    lat: real('lat'),
    lng: real('lng'),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    uploadState: text('upload_state').$type<UploadState>().notNull().default('local'),
  },
  (t) => [index('photos_inspection_idx').on(t.inspectionId, t.itemKey)],
);

export const pins = sqliteTable(
  'pins',
  {
    id: text('id').primaryKey(),
    inspectionId: text('inspection_id').notNull(),
    diagram: text('diagram').$type<Diagram>().notNull(),
    x: real('x').notNull(),
    y: real('y').notNull(),
    severity: text('severity').$type<Severity>().notNull(),
    note: text('note'),
  },
  (t) => [index('pins_inspection_idx').on(t.inspectionId)],
);

export const gpsTrail = sqliteTable(
  'gps_trail',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    inspectionId: text('inspection_id').notNull(),
    lat: real('lat').notNull(),
    lng: real('lng').notNull(),
    accuracy: real('accuracy'),
    recordedAt: text('recorded_at').notNull(),
  },
  (t) => [index('gps_inspection_idx').on(t.inspectionId)],
);

export type OutboxKind = 'start' | 'submit' | 'upload';
export type OutboxStatus = 'pending' | 'in_flight' | 'done' | 'blocked' | 'failed';

/**
 * Durable queue of things to tell the server, processed strictly in id order per inspection.
 * Upload ops keep their multipart progress so a killed app resumes instead of restarting.
 */
export const outbox = sqliteTable(
  'outbox',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    inspectionId: text('inspection_id').notNull(),
    kind: text('kind').$type<OutboxKind>().notNull(),
    /** start: StartBody; submit: SubmissionBody; upload: { fileId, kind, uri, contentType, sizeBytes } */
    payload: text('payload', { mode: 'json' }).$type<unknown>().notNull(),
    /** Generated once when queued, reused on every retry. */
    idempotencyKey: text('idempotency_key').notNull(),
    status: text('status').$type<OutboxStatus>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: text('next_attempt_at').notNull(),
    lastError: text('last_error'),
    /** upload only: { uploadId, parts: [{ partNumber, etag }] } */
    progress: text('progress', { mode: 'json' }).$type<UploadProgress | null>(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('outbox_status_idx').on(t.status, t.nextAttemptAt)],
);

export interface UploadProgress {
  uploadId: string;
  parts: { partNumber: number; etag: string }[];
}

export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const schema = { jobs, templates, drafts, answers, photos, pins, gpsTrail, outbox, meta };
