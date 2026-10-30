import { randomUUID } from 'node:crypto';
import {
  PROPERTY_TEMPLATE,
  VEHICLE_TEMPLATE,
  flattenItems,
  type CreateInspectionBody,
  type Inspection,
  type Job,
  type SubmissionBody,
  type TemplateBody,
} from '@fim/shared';
import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import { buildApp } from '../src/app.js';
import { createDatabase, type Database } from '@fim/db';
import {
  DEMO_PASSWORD,
  DEMO_USERS,
  resetDatabase,
  seedUsersAndTemplates,
} from '../src/db/seed-data.js';
import { createOutboxRelay } from '../src/services/outbox.js';
import type { JobQueue } from '../src/services/queue.js';
import { createS3Storage } from '../src/services/storage.js';
import { testEnv } from './env.js';

export const ASSESSOR_JHB = DEMO_USERS[0]!.email;
export const ASSESSOR_PE = DEMO_USERS[1]!.email;
export const MANAGER = DEMO_USERS[2]!.email;

export class MemoryQueue implements JobQueue {
  jobs: Job[] = [];
  failNext = 0;
  async enqueue(job: Job) {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error('queue unavailable');
    }
    this.jobs.push(job);
  }
  ofType<T extends Job['type']>(type: T) {
    return this.jobs.filter((j): j is Extract<Job, { type: T }> => j.type === type);
  }
}

export interface TestContext {
  app: FastifyInstance;
  database: Database;
  queue: MemoryQueue;
  templateIds: { vehicle: string; property: string };
  userIds: Record<string, string>;
  close(): Promise<void>;
}

export async function setupTestApp(): Promise<TestContext> {
  const env = testEnv();
  const database = createDatabase(env.DATABASE_URL, 5);
  await resetDatabase(database.db);
  const { users, templates } = await seedUsersAndTemplates(database.db);
  const queue = new MemoryQueue();
  const logger = pino({ level: process.env.TEST_LOG_LEVEL ?? 'silent' });
  const storage = createS3Storage({
    region: env.AWS_REGION,
    bucket: env.S3_BUCKET,
    endpoint: env.AWS_ENDPOINT_URL,
    presignTtlSeconds: 600,
  });
  const outbox = createOutboxRelay(database.db, queue, logger);
  const app = await buildApp({
    config: {
      JWT_SECRET: 'test-secret-test-secret-test-secret-123',
      ACCESS_TOKEN_TTL_SECONDS: 900,
      REFRESH_TOKEN_TTL_DAYS: 30,
      NODE_ENV: 'test',
      PRESIGN_TTL_SECONDS: 600,
    },
    db: database.db,
    storage,
    outbox,
    logger,
  });
  await app.ready();
  return {
    app,
    database,
    queue,
    templateIds: {
      vehicle: templates.find((t) => t.type === 'vehicle')!.id,
      property: templates.find((t) => t.type === 'property')!.id,
    },
    userIds: Object.fromEntries(users.map((u) => [u.email, u.id])),
    async close() {
      await app.close();
      await database.close();
    },
  };
}

export async function login(app: FastifyInstance, email: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { email, password: DEMO_PASSWORD },
  });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`);
  return res.json<{ accessToken: string; refreshToken: string; user: { id: string } }>();
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export function jobBody(
  ctx: TestContext,
  overrides: Partial<CreateInspectionBody> = {},
): CreateInspectionBody {
  return {
    templateId: ctx.templateIds.vehicle,
    assigneeId: ctx.userIds[ASSESSOR_JHB]!,
    insuredName: 'Sipho Dlamini',
    insuredPhone: '0821234567',
    claimNumber: 'CLM-123456',
    sumInsuredCents: 35_000_000,
    subject: {
      kind: 'vehicle',
      make: 'Toyota',
      model: 'Hilux 2.4 GD-6',
      registration: 'CA 123-456',
      year: 2021,
    },
    address: {
      line1: '100 Rivonia Road',
      suburb: 'Sandton',
      city: 'Johannesburg',
      postalCode: '2196',
    },
    location: { lat: -26.1066, lng: 28.0567 },
    dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    priority: 'high',
    ...overrides,
  };
}

export async function createJob(
  ctx: TestContext,
  managerToken: string,
  overrides: Partial<CreateInspectionBody> = {},
): Promise<Inspection> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/v1/inspections',
    headers: bearer(managerToken),
    payload: jobBody(ctx, overrides),
  });
  if (res.statusCode !== 201) throw new Error(`create failed: ${res.statusCode} ${res.body}`);
  return res.json<Inspection>();
}

/** A submission that satisfies every rule of the given template. */
export function completeSubmission(
  inspection: Inspection,
  template: TemplateBody = inspection.subject.kind === 'vehicle'
    ? VEHICLE_TEMPLATE
    : PROPERTY_TEMPLATE,
): SubmissionBody & {
  photos: { id: string; itemKey: string; shotKey: string | null }[];
  signature: { fileId: string };
} {
  const answers = flattenItems(template).map(({ item }) => {
    switch (item.kind) {
      case 'passFail':
        return { itemKey: item.key, value: 'pass' as const };
      case 'number':
        return { itemKey: item.key, value: Math.max(item.min ?? 0, 5) };
      case 'select':
        return { itemKey: item.key, value: item.options[0]!.value };
      case 'text':
        return { itemKey: item.key, value: 'All in order.' };
    }
  });
  const now = new Date();
  const photos = flattenItems(template).flatMap(({ item }) =>
    item.shots
      .filter((s) => s.required)
      .map((s) => ({
        id: randomUUID(),
        itemKey: item.key,
        shotKey: s.key,
        takenAt: now.toISOString(),
        lat: inspection.location.lat,
        lng: inspection.location.lng,
        sizeBytes: 1024,
      })),
  );
  return {
    baseVersion: inspection.version,
    templateVersion: inspection.templateVersion,
    startedAt: new Date(now.getTime() - 3_600_000).toISOString(),
    completedAt: now.toISOString(),
    answers,
    damagePins: [
      {
        id: randomUUID(),
        diagram: 'vehicle-top',
        x: 0.2,
        y: 0.3,
        severity: 'moderate',
        note: 'Dent on left door',
      },
    ],
    photos,
    signature: {
      fileId: randomUUID(),
      signedName: inspection.insuredName,
      signedAt: now.toISOString(),
      sizeBytes: 2048,
    },
    gpsTrail: [
      {
        lat: inspection.location.lat,
        lng: inspection.location.lng,
        accuracy: 8,
        recordedAt: now.toISOString(),
      },
    ],
  };
}

export async function submit(
  ctx: TestContext,
  token: string,
  inspectionId: string,
  body: SubmissionBody,
  key: string = randomUUID(),
) {
  return ctx.app.inject({
    method: 'PUT',
    url: `/v1/inspections/${inspectionId}/submission`,
    headers: { ...bearer(token), 'idempotency-key': key },
    payload: body,
  });
}
