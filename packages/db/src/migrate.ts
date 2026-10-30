import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './client.js';

export const MIGRATIONS_FOLDER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../drizzle',
);

export async function runMigrations(url: string): Promise<void> {
  const database = createDatabase(url, 1);
  try {
    await migrate(database.db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await database.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  await runMigrations(url);
  console.warn('migrations applied');
}
