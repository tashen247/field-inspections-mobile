/**
 * Measures delta-sync latency against 5,000 seeded inspections.
 * Uses TEST_DATABASE_URL (it resets that database). Run: pnpm --filter @fim/api bench:sync
 */
import { performance } from 'node:perf_hooks';
import pino from 'pino';
import { buildApp } from '../src/app.js';
import { createDatabase } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { DEMO_PASSWORD, DEMO_USERS, resetDatabase, seedInspections } from '../src/db/seed-data.js';
import { createOutboxRelay } from '../src/services/outbox.js';
import { createS3Storage } from '../src/services/storage.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://fim:fim@localhost:5432/fim_test';
const COUNT = Number(process.env.BENCH_COUNT ?? 5000);
const REQUESTS = Number(process.env.BENCH_REQUESTS ?? 300);

await runMigrations(url);
const database = createDatabase(url, 10);
await resetDatabase(database.db);
await seedInspections(database.db, { count: COUNT, mixedStatuses: true });
await database.pool.query('analyze');

const logger = pino({ level: 'silent' });
const app = await buildApp({
  config: {
    JWT_SECRET: 'bench-secret-bench-secret-bench-secret',
    ACCESS_TOKEN_TTL_SECONDS: 900,
    REFRESH_TOKEN_TTL_DAYS: 1,
    NODE_ENV: 'test',
    PRESIGN_TTL_SECONDS: 600,
  },
  db: database.db,
  storage: createS3Storage({ region: 'af-south-1', bucket: 'unused', presignTtlSeconds: 60 }),
  outbox: createOutboxRelay(database.db, { enqueue: async () => {} }, logger),
  logger,
});
const address = await app.listen({ port: 0, host: '127.0.0.1' });

const login = await fetch(`${address}/v1/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: DEMO_USERS[0]!.email, password: DEMO_PASSWORD }),
}).then((r) => r.json() as Promise<{ accessToken: string }>);
const headers = { authorization: `Bearer ${login.accessToken}` };

const since = new Date(Date.now() - 10 * 60_000).toISOString();
const scenarios = [
  { name: 'full sync, first page (200 rows)', path: '/v1/inspections?assignedTo=me&limit=200' },
  { name: 'delta since 10 min ago', path: `/v1/inspections?assignedTo=me&since=${since}` },
];

let worst = 0;
for (const s of scenarios) {
  for (let i = 0; i < 20; i++)
    await fetch(`${address}${s.path}`, { headers }).then((r) => r.arrayBuffer());
  const times: number[] = [];
  let rows = 0;
  for (let i = 0; i < REQUESTS; i++) {
    const t0 = performance.now();
    const res = await fetch(`${address}${s.path}`, { headers });
    const body = (await res.json()) as { items: unknown[] };
    times.push(performance.now() - t0);
    rows = body.items.length;
  }
  times.sort((a, b) => a - b);
  const q = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))]!;
  worst = Math.max(worst, q(0.95));
  console.log(
    `${s.name.padEnd(36)} rows=${String(rows).padStart(3)}  p50=${q(0.5).toFixed(1)}ms  p95=${q(0.95).toFixed(1)}ms  p99=${q(0.99).toFixed(1)}ms`,
  );
}

await app.close();
await database.close();
console.log(
  worst < 200 ? `PASS: p95 ${worst.toFixed(1)}ms < 200ms` : `FAIL: p95 ${worst.toFixed(1)}ms`,
);
process.exit(worst < 200 ? 0 : 1);
