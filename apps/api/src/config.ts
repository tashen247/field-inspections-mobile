import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  AWS_REGION: z.string().default('af-south-1'),
  /** Set for LocalStack; leave empty on AWS. */
  AWS_ENDPOINT_URL: z
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /** Optional host override for pre-signed URLs, e.g. your LAN IP so a phone can reach LocalStack. */
  S3_PUBLIC_ENDPOINT_URL: z
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  S3_BUCKET: z.string().min(1),
  SQS_QUEUE_URL: z.url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  PRESIGN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60),
});

export type Config = z.infer<typeof configSchema>;

/**
 * On ECS the database credentials arrive as separate values from Secrets Manager, so build
 * DATABASE_URL from DB_* variables when it is not set directly.
 */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = env;
  if (!DB_HOST || !DB_USER || !DB_PASSWORD) return undefined;
  const ssl = env.DB_SSL === 'false' ? '' : '?sslmode=no-verify';
  return `postgres://${encodeURIComponent(DB_USER)}:${encodeURIComponent(DB_PASSWORD)}@${DB_HOST}:${DB_PORT ?? '5432'}/${DB_NAME ?? 'fim'}${ssl}`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse({ ...env, DATABASE_URL: resolveDatabaseUrl(env) });
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  return parsed.data;
}
