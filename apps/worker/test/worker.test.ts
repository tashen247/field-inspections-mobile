import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { createDatabase, devices, inspections, reports, type Database } from '@fim/db';
import { eq } from 'drizzle-orm';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { QueueConsumer } from '../src/consumer.js';
import { handlePush } from '../src/handlers/push.js';
import { handleGenerateReport } from '../src/handlers/report.js';
import { safe, wrap } from '../src/pdf/report.js';
import { createS3BlobStore, type BlobStore } from '../src/storage.js';
import { testEnv } from './env.js';
import { reset, seedSubmitted } from './fixtures.js';

const log = pino({ level: 'silent' });
let database: Database;
let blobs: BlobStore;

beforeAll(() => {
  const env = testEnv();
  database = createDatabase(env.DATABASE_URL, 3);
  blobs = createS3BlobStore({
    region: env.AWS_REGION,
    bucket: env.S3_BUCKET,
    endpoint: env.AWS_ENDPOINT_URL,
  });
});
afterAll(() => database.close());
beforeEach(() => reset(database.db));

describe('PDF report', () => {
  it('generates a multi-page report with photos, signature and audit trail, then stores it', async () => {
    const { id } = await seedSubmitted(database.db, blobs);
    const outcome = await handleGenerateReport(
      { db: database.db, blobs, log, now: () => new Date('2026-10-30T09:00:00Z') },
      { type: 'generate_report', inspectionId: id, correlationId: 'c1' },
    );
    expect(outcome).toBe('generated');

    const report = await database.db.query.reports.findFirst({
      where: eq(reports.inspectionId, id),
    });
    expect(report).toMatchObject({
      inspectionVersion: 2,
      s3Key: `inspections/${id}/reports/report-v2.pdf`,
    });
    const bytes = await blobs.get(report!.s3Key);
    expect(bytes).not.toBeNull();
    const pdf = await PDFDocument.load(bytes!);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(3);
    expect(pdf.getTitle()).toMatch(/^Inspection report INS-TEST-/);
    expect(bytes!.length).toBeGreaterThan(100_000); // the six photos are embedded
  });

  it('skips work that is already done and waits for missing uploads', async () => {
    const { id } = await seedSubmitted(database.db, blobs);
    const deps = { db: database.db, blobs, log };
    const job = { type: 'generate_report' as const, inspectionId: id, correlationId: 'c' };
    expect(await handleGenerateReport(deps, job)).toBe('generated');
    expect(await handleGenerateReport(deps, job)).toBe('skipped_current');

    // Approval bumps the version, so the report is regenerated.
    await database.db
      .update(inspections)
      .set({ status: 'approved', version: 3 })
      .where(eq(inspections.id, id));
    expect(await handleGenerateReport(deps, job)).toBe('generated');

    expect(
      await handleGenerateReport(deps, {
        ...job,
        inspectionId: '00000000-0000-4000-8000-000000000000',
      }),
    ).toBe('skipped_missing');

    const pending = await seedSubmitted(database.db, blobs, { uploaded: false });
    expect(await handleGenerateReport(deps, { ...job, inspectionId: pending.id })).toBe(
      'waiting_for_uploads',
    );
  });

  it('keeps text drawable with the standard fonts', async () => {
    expect(safe('Floor area m² → 120 ± 2 °C · “ok”')).toBe('Floor area m² -> 120 ± 2 °C · “ok”');
    expect(safe('emoji 🚗 and ✓')).toBe('emoji ? and ?');
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const lines = wrap('one two three four five six seven eight nine ten', font, 10, 60);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.every((l) => font.widthOfTextAtSize(l, 10) <= 60 || !l.includes(' '))).toBe(true);
  });
});

describe('push notifications', () => {
  it('sends to every device and forgets uninstalled ones', async () => {
    const { assessorId } = await seedSubmitted(database.db, blobs);
    await database.db.insert(devices).values([
      { userId: assessorId, expoPushToken: 'ExponentPushToken[live]', platform: 'android' },
      { userId: assessorId, expoPushToken: 'ExponentPushToken[gone]', platform: 'ios' },
    ]);
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: [{ status: 'ok' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }],
      }),
    );
    const res = await handlePush(
      { db: database.db, log, fetch: fetchMock as unknown as typeof fetch, accessToken: 'tok' },
      {
        type: 'push',
        userId: assessorId,
        title: 'New inspection assigned',
        body: 'INS-1',
        data: { inspectionId: 'x' },
        correlationId: 'c',
      },
    );
    expect(res).toEqual({ sent: 1, removed: 1 });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toHaveLength(2);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    const left = await database.db.select().from(devices).where(eq(devices.userId, assessorId));
    expect(left.map((d) => d.expoPushToken)).toEqual(['ExponentPushToken[live]']);
  });

  it('handles no devices, dry runs and service errors', async () => {
    const { assessorId } = await seedSubmitted(database.db, blobs);
    const job = {
      type: 'push' as const,
      userId: assessorId,
      title: 't',
      body: 'b',
      data: {},
      correlationId: 'c',
    };
    expect(await handlePush({ db: database.db, log }, job)).toEqual({ sent: 0, removed: 0 });
    await database.db
      .insert(devices)
      .values({ userId: assessorId, expoPushToken: 'ExponentPushToken[a]', platform: 'ios' });
    expect(await handlePush({ db: database.db, log, dryRun: true }, job)).toEqual({
      sent: 1,
      removed: 0,
    });
    const failing = vi.fn(async () => new Response('nope', { status: 503 }));
    await expect(
      handlePush({ db: database.db, log, fetch: failing as unknown as typeof fetch }, job),
    ).rejects.toThrow(/503/);
  });
});

describe('queue consumer', () => {
  it('deletes a message only after its handler succeeds', async () => {
    const env = testEnv();
    const sqs = new SQSClient({ region: env.AWS_REGION, endpoint: env.AWS_ENDPOINT_URL });
    const { QueueUrl } = await sqs.send(
      new CreateQueueCommand({
        QueueName: `fim-worker-${Date.now()}`,
        Attributes: { VisibilityTimeout: '1' },
      }),
    );
    try {
      const seen: string[] = [];
      let fail = true;
      const consumer = new QueueConsumer({
        region: env.AWS_REGION,
        queueUrl: QueueUrl!,
        endpoint: env.AWS_ENDPOINT_URL,
        log,
        waitSeconds: 1,
        handler: async (job) => {
          seen.push(job.type);
          if (fail) throw new Error('boom');
        },
      });
      await sqs.send(
        new SendMessageCommand({
          QueueUrl,
          MessageBody: JSON.stringify({
            type: 'generate_report',
            inspectionId: '00000000-0000-4000-8000-000000000001',
            correlationId: 'corr-1',
          }),
          MessageAttributes: { correlationId: { DataType: 'String', StringValue: 'corr-1' } },
        }),
      );
      await sqs.send(new SendMessageCommand({ QueueUrl, MessageBody: 'not json' }));

      expect(await consumer.pollOnce()).toBe(2);
      expect(seen).toEqual(['generate_report']);

      // Failed job comes back after the visibility timeout and succeeds this time.
      fail = false;
      await new Promise((r) => setTimeout(r, 1500));
      let processed = 0;
      for (let i = 0; i < 5 && seen.length < 2; i++) processed += await consumer.pollOnce();
      expect(seen).toEqual(['generate_report', 'generate_report']);
      expect(processed).toBeGreaterThan(0);

      await new Promise((r) => setTimeout(r, 1500));
      const attrs = await sqs.send(
        new GetQueueAttributesCommand({
          QueueUrl,
          AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
        }),
      );
      // Only the poison message is left (it would go to the DLQ in production).
      const left =
        Number(attrs.Attributes?.ApproximateNumberOfMessages ?? 0) +
        Number(attrs.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0);
      expect(left).toBe(1);

      const stopper = new QueueConsumer({
        region: env.AWS_REGION,
        queueUrl: QueueUrl!,
        endpoint: env.AWS_ENDPOINT_URL,
        log,
        waitSeconds: 1,
        handler: async () => undefined,
      });
      setTimeout(() => stopper.stop(), 200);
      await stopper.run();
    } finally {
      await sqs.send(new DeleteQueueCommand({ QueueUrl }));
    }
  });
});

describe('config', () => {
  it('reads DB_* secrets and booleans', () => {
    const cfg = loadConfig({
      DB_HOST: 'db',
      DB_USER: 'u',
      DB_PASSWORD: 'p',
      S3_BUCKET: 'b',
      SQS_QUEUE_URL: 'http://localhost:4566/000000000000/q',
      PUSH_DRY_RUN: 'true',
    });
    expect(cfg.DATABASE_URL).toBe('postgres://u:p@db:5432/fim?sslmode=no-verify');
    expect(cfg.PUSH_DRY_RUN).toBe(true);
    expect(() => loadConfig({})).toThrow(/Invalid worker configuration/);
  });
});
