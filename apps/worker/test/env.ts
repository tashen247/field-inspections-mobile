/** The worker gets its own database so its tests can run alongside the API's. */
export function testEnv() {
  process.env.AWS_ACCESS_KEY_ID ??= 'test';
  process.env.AWS_SECRET_ACCESS_KEY ??= 'test';
  const adminUrl = process.env.TEST_DATABASE_URL ?? 'postgres://fim:fim@localhost:5432/fim_test';
  const endpoint = process.env.AWS_ENDPOINT_URL || 'http://localhost:4566';
  return {
    ADMIN_DATABASE_URL: adminUrl,
    DATABASE_URL: adminUrl.replace(/\/[^/?]+(\?|$)/, '/fim_worker_test$1'),
    AWS_REGION: 'af-south-1',
    AWS_ENDPOINT_URL: endpoint,
    S3_BUCKET: 'fim-media-worker-test',
  };
}
