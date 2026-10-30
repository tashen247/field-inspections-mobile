import {
  DeleteQueueCommand,
  CreateQueueCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, resolveDatabaseUrl } from '../src/config.js';
import { createDatabase, type Database } from '../src/db/client.js';
import { jobOutbox } from '../src/db/schema.js';
import { sha256, stableStringify } from '../src/lib/hash.js';
import { hashPassword, verifyPassword } from '../src/lib/password.js';
import { addToOutbox, createOutboxRelay } from '../src/services/outbox.js';
import { createSqsQueue } from '../src/services/queue.js';
import { testEnv } from './env.js';
import { MemoryQueue } from './helpers.js';

describe('password hashing', () => {
  it('verifies the right password only', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
    expect(await verifyPassword('x', 'md5$abc')).toBe(false);
  });
});

describe('stable hashing', () => {
  it('ignores key order and undefined', () => {
    expect(stableStringify({ b: 1, a: [1, { d: undefined, c: 'x' }] })).toBe(
      '{"a":[1,{"c":"x"}],"b":1}',
    );
    expect(sha256('a')).toHaveLength(64);
  });
});

describe('config', () => {
  const base = {
    JWT_SECRET: 'x'.repeat(32),
    S3_BUCKET: 'b',
    SQS_QUEUE_URL: 'http://localhost:4566/000000000000/q',
  };
  it('builds DATABASE_URL from DB_* parts (ECS secrets)', () => {
    const url = resolveDatabaseUrl({
      DB_HOST: 'db',
      DB_USER: 'u',
      DB_PASSWORD: 'p@ss',
      DB_NAME: 'fim',
    });
    expect(url).toBe('postgres://u:p%40ss@db:5432/fim?sslmode=no-verify');
    const cfg = loadConfig({ ...base, DATABASE_URL: 'postgres://a:b@c/d', AWS_ENDPOINT_URL: '' });
    expect(cfg.AWS_ENDPOINT_URL).toBeUndefined();
    expect(cfg.PORT).toBe(3000);
  });
  it('explains what is missing', () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });
});

describe('outbox relay', () => {
  let database: Database;
  beforeAll(() => {
    database = createDatabase(testEnv().DATABASE_URL, 2);
  });
  afterAll(() => database.close());

  it('keeps jobs when the queue is down and delivers them later', async () => {
    await database.db.delete(jobOutbox);
    const queue = new MemoryQueue();
    const relay = createOutboxRelay(database.db, queue, pino({ level: 'silent' }));
    await addToOutbox(database.db, [
      {
        type: 'generate_report',
        inspectionId: '00000000-0000-4000-8000-000000000001',
        correlationId: 'c1',
      },
    ]);
    queue.failNext = 1;
    expect(await relay.flush()).toBe(0);
    const [row] = await database.db.select().from(jobOutbox);
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toMatch(/queue unavailable/);

    expect(await relay.flush()).toBe(1);
    expect(queue.jobs).toHaveLength(1);
    expect(await database.db.select().from(jobOutbox)).toHaveLength(0);
    relay.start(10);
    relay.stop();
  });

  it('delivers to real SQS with the correlation id attribute', async () => {
    const env = testEnv();
    const sqs = new SQSClient({ region: env.AWS_REGION, endpoint: env.AWS_ENDPOINT_URL });
    const name = `fim-outbox-${Date.now()}`;
    const { QueueUrl } = await sqs.send(new CreateQueueCommand({ QueueName: name }));
    try {
      const queue = createSqsQueue({
        region: env.AWS_REGION,
        queueUrl: QueueUrl!,
        endpoint: env.AWS_ENDPOINT_URL,
      });
      const relay = createOutboxRelay(database.db, queue, pino({ level: 'silent' }));
      await addToOutbox(database.db, [
        {
          type: 'push',
          userId: '00000000-0000-4000-8000-000000000002',
          title: 'Hi',
          body: 'There',
          correlationId: 'corr-123',
        },
      ]);
      expect(await relay.flush()).toBe(1);
      const got = await sqs.send(
        new ReceiveMessageCommand({ QueueUrl, MessageAttributeNames: ['All'], WaitTimeSeconds: 1 }),
      );
      const msg = got.Messages?.[0];
      expect(JSON.parse(msg!.Body!)).toMatchObject({ type: 'push', title: 'Hi', data: {} });
      expect(msg!.MessageAttributes?.correlationId?.StringValue).toBe('corr-123');
    } finally {
      await sqs.send(new DeleteQueueCommand({ QueueUrl }));
    }
  });
});
