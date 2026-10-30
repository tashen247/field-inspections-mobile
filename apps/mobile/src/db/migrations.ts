/**
 * Local schema migrations, applied in order and tracked with PRAGMA user_version.
 * Version 1 was generated from schema.ts with drizzle-kit (sqlite dialect).
 * Append new versions; never edit a shipped one.
 */
export const MIGRATIONS: readonly (readonly string[])[] = [
  [
    `CREATE TABLE "answers" (
  "inspection_id" text NOT NULL,
  "item_key" text NOT NULL,
  "value" text,
  "note" text,
  "updated_at" text NOT NULL,
  PRIMARY KEY("inspection_id", "item_key")
);`,
    `CREATE TABLE "drafts" (
  "inspection_id" text PRIMARY KEY NOT NULL,
  "base_version" integer NOT NULL,
  "template_id" text NOT NULL,
  "template_version" integer NOT NULL,
  "started_at" text NOT NULL,
  "start_lat" real,
  "start_lng" real,
  "start_distance_m" real,
  "completed_at" text,
  "signature_file_id" text,
  "signature_uri" text,
  "signature_size" integer,
  "signed_name" text,
  "signed_at" text,
  "updated_at" text NOT NULL
);`,
    `CREATE TABLE "gps_trail" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "inspection_id" text NOT NULL,
  "lat" real NOT NULL,
  "lng" real NOT NULL,
  "accuracy" real,
  "recorded_at" text NOT NULL
);`,
    `CREATE INDEX "gps_inspection_idx" ON "gps_trail" ("inspection_id");`,
    `CREATE TABLE "jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "data" text NOT NULL,
  "status" text NOT NULL,
  "version" integer NOT NULL,
  "due_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "local_state" text DEFAULT 'idle' NOT NULL,
  "conflict" text,
  "downloaded_at" text NOT NULL
);`,
    `CREATE INDEX "jobs_due_idx" ON "jobs" ("due_at");`,
    `CREATE TABLE "meta" (
  "key" text PRIMARY KEY NOT NULL,
  "value" text NOT NULL
);`,
    `CREATE TABLE "outbox" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "inspection_id" text NOT NULL,
  "kind" text NOT NULL,
  "payload" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" text NOT NULL,
  "last_error" text,
  "progress" text,
  "created_at" text NOT NULL
);`,
    `CREATE INDEX "outbox_status_idx" ON "outbox" ("status","next_attempt_at");`,
    `CREATE TABLE "photos" (
  "id" text PRIMARY KEY NOT NULL,
  "inspection_id" text NOT NULL,
  "item_key" text NOT NULL,
  "shot_key" text,
  "file_uri" text NOT NULL,
  "taken_at" text NOT NULL,
  "lat" real,
  "lng" real,
  "width" integer NOT NULL,
  "height" integer NOT NULL,
  "size_bytes" integer NOT NULL,
  "upload_state" text DEFAULT 'local' NOT NULL
);`,
    `CREATE INDEX "photos_inspection_idx" ON "photos" ("inspection_id","item_key");`,
    `CREATE TABLE "pins" (
  "id" text PRIMARY KEY NOT NULL,
  "inspection_id" text NOT NULL,
  "diagram" text NOT NULL,
  "x" real NOT NULL,
  "y" real NOT NULL,
  "severity" text NOT NULL,
  "note" text
);`,
    `CREATE INDEX "pins_inspection_idx" ON "pins" ("inspection_id");`,
    `CREATE TABLE "templates" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "type" text NOT NULL,
  "version" integer NOT NULL,
  "schema" text NOT NULL
);`,
  ],
];
