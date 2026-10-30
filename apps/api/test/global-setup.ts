import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { CreateQueueCommand, SQSClient } from '@aws-sdk/client-sqs';
import { runMigrations } from '@fim/db';
import { testEnv } from './env.js';

/** Prepares Postgres/PostGIS and LocalStack (also works on bare CI service containers). */
export default async function setup() {
  const env = testEnv();
  await runMigrations(env.DATABASE_URL);
  const s3 = new S3Client({
    region: env.AWS_REGION,
    endpoint: env.AWS_ENDPOINT_URL,
    forcePathStyle: true,
  });
  try {
    await s3.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw err;
  }
  const sqs = new SQSClient({ region: env.AWS_REGION, endpoint: env.AWS_ENDPOINT_URL });
  await sqs.send(new CreateQueueCommand({ QueueName: env.SQS_QUEUE_NAME }));
}
