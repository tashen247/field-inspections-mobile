import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url(),
  AWS_REGION: z.string().default('af-south-1'),
  AWS_ENDPOINT_URL: z
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  S3_BUCKET: z.string().min(1),
  SQS_QUEUE_URL: z.url(),
  /** Optional Expo access token for push (needed only if enhanced push security is on). */
  EXPO_ACCESS_TOKEN: z.string().optional(),
  /** Log pushes instead of sending them (local development). */
  PUSH_DRY_RUN: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type WorkerConfig = z.infer<typeof schema>;

function databaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = env;
  if (!DB_HOST || !DB_USER || !DB_PASSWORD) return undefined;
  const ssl = env.DB_SSL === 'false' ? '' : '?sslmode=no-verify';
  return `postgres://${encodeURIComponent(DB_USER)}:${encodeURIComponent(DB_PASSWORD)}@${DB_HOST}:${DB_PORT ?? '5432'}/${DB_NAME ?? 'fim'}${ssl}`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = schema.safeParse({ ...env, DATABASE_URL: databaseUrl(env) });
  if (!parsed.success) {
    throw new Error(
      `Invalid worker configuration:\n${parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`,
    );
  }
  return parsed.data;
}
