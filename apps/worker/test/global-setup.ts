import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { runMigrations } from '@fim/db';
import pg from 'pg';
import { testEnv } from './env.js';

export default async function setup() {
  const env = testEnv();
  const admin = new pg.Client({ connectionString: env.ADMIN_DATABASE_URL });
  await admin.connect();
  const exists = await admin.query(`select 1 from pg_database where datname = 'fim_worker_test'`);
  if (exists.rowCount === 0) await admin.query('create database fim_worker_test');
  await admin.end();
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
}
