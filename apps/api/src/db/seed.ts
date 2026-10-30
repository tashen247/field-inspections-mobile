import { parseArgs } from 'node:util';
import { resolveDatabaseUrl } from '../config.js';
import { createDatabase } from '@fim/db';
import { runMigrations } from '@fim/db';
import { DEMO_PASSWORD, DEMO_USERS, resetDatabase, seedInspections } from './seed-data.js';

const { values } = parseArgs({
  options: {
    count: { type: 'string', default: '24' },
    reset: { type: 'boolean', default: false },
    mixed: { type: 'boolean', default: false },
  },
});

const url = resolveDatabaseUrl(process.env);
if (!url) throw new Error('DATABASE_URL is not set');
await runMigrations(url);
const database = createDatabase(url);
try {
  if (values.reset) await resetDatabase(database.db);
  const n = await seedInspections(database.db, {
    count: Number(values.count),
    mixedStatuses: values.mixed,
  });
  console.log(`seeded ${n} inspections`);
  console.log('demo logins (password for all: %s)', DEMO_PASSWORD);
  for (const u of DEMO_USERS) console.log(`  ${u.role.padEnd(8)} ${u.email}`);
} finally {
  await database.close();
}
