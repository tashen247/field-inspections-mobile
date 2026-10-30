import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';
import { migrate } from './migrate';
import { schema } from './schema';
import type { LocalDb } from './types';

let instance: LocalDb | null = null;

/** Opens (once) and migrates the on-device database. */
export function getDb(): LocalDb {
  if (instance) return instance;
  const sqlite = openDatabaseSync('field-inspections.db', { enableChangeListener: true });
  sqlite.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrate({
    exec: (sql) => sqlite.execSync(sql),
    userVersion: () =>
      sqlite.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0,
    setUserVersion: (v) => sqlite.execSync(`PRAGMA user_version = ${Math.floor(v)}`),
  });
  instance = drizzle(sqlite, { schema }) as unknown as LocalDb;
  return instance;
}
