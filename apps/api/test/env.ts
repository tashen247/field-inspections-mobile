/** Test configuration; defaults match docker-compose.yml so `pnpm test` just works locally. */
export function testEnv() {
  process.env.AWS_ACCESS_KEY_ID ??= 'test';
  process.env.AWS_SECRET_ACCESS_KEY ??= 'test';
  const endpoint = process.env.AWS_ENDPOINT_URL || 'http://localhost:4566';
  const queueName = 'fim-jobs-test';
  return {
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://fim:fim@localhost:5432/fim_test',
    AWS_REGION: 'af-south-1',
    AWS_ENDPOINT_URL: endpoint,
    S3_BUCKET: 'fim-media-test',
    SQS_QUEUE_NAME: queueName,
    SQS_QUEUE_URL: `${endpoint}/000000000000/${queueName}`,
  };
}
