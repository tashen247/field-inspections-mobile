import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from '@fim/db';
import { runMigrations } from '@fim/db';
import { createLogger } from './logger.js';
import { createOutboxRelay } from './services/outbox.js';
import { createSqsQueue } from './services/queue.js';
import { createS3Storage } from './services/storage.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL, 'api', config.NODE_ENV === 'development');

if (process.env.MIGRATE_ON_START !== 'false') {
  await runMigrations(config.DATABASE_URL);
}

const database = createDatabase(config.DATABASE_URL);

// First run of `pnpm dev`: load the demo users, templates and jobs so the app has something to show.
if (config.NODE_ENV === 'development' && process.env.SEED_IF_EMPTY !== 'false') {
  const { seedIfEmpty } = await import('./db/seed-data.js');
  if (await seedIfEmpty(database.db)) logger.info('seeded demo data (see README for logins)');
}
const storage = createS3Storage({
  region: config.AWS_REGION,
  bucket: config.S3_BUCKET,
  endpoint: config.AWS_ENDPOINT_URL,
  publicEndpoint: config.S3_PUBLIC_ENDPOINT_URL,
  presignTtlSeconds: config.PRESIGN_TTL_SECONDS,
});
const queue = createSqsQueue({
  region: config.AWS_REGION,
  queueUrl: config.SQS_QUEUE_URL,
  endpoint: config.AWS_ENDPOINT_URL,
});
const outbox = createOutboxRelay(database.db, queue, logger.child({ component: 'outbox' }));

const app = await buildApp({ config, db: database.db, storage, outbox, logger });
outbox.start();

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'shutting down');
  outbox.stop();
  await app.close();
  await database.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.PORT, host: config.HOST });
