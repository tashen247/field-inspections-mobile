import { createDatabase } from '@fim/db';
import pino from 'pino';
import { loadConfig } from './config.js';
import { QueueConsumer } from './consumer.js';
import { handlePush } from './handlers/push.js';
import { handleGenerateReport } from './handlers/report.js';
import { createS3BlobStore } from './storage.js';

const config = loadConfig();
const log = pino({
  level: config.LOG_LEVEL,
  base: { service: 'worker' },
  ...(config.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
    : {}),
});
const database = createDatabase(config.DATABASE_URL, 5);
const blobs = createS3BlobStore({
  region: config.AWS_REGION,
  bucket: config.S3_BUCKET,
  endpoint: config.AWS_ENDPOINT_URL,
});

const consumer = new QueueConsumer({
  region: config.AWS_REGION,
  queueUrl: config.SQS_QUEUE_URL,
  endpoint: config.AWS_ENDPOINT_URL,
  log,
  handler: async (job, jobLog) => {
    if (job.type === 'generate_report') {
      return handleGenerateReport({ db: database.db, blobs, log: jobLog }, job);
    }
    return handlePush(
      {
        db: database.db,
        log: jobLog,
        accessToken: config.EXPO_ACCESS_TOKEN,
        dryRun: config.PUSH_DRY_RUN,
      },
      { ...job, data: job.data ?? {} },
    );
  },
});

const shutdown = (signal: string) => {
  log.info({ signal }, 'stopping after current poll');
  consumer.stop();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

await consumer.run();
await database.close();
