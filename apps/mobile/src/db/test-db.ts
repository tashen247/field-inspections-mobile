import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from './migrate';
import { schema } from './schema';
import type { LocalDb } from './types';

/** In-memory or file database for tests, running the same migrations as the app. */
export function createTestDb(filename = ':memory:'): { db: LocalDb; close: () => void } {
  const sqlite = new Database(filename);
  migrate({
    exec: (sql) => sqlite.exec(sql),
    userVersion: () => sqlite.pragma('user_version', { simple: true }) as number,
    setUserVersion: (v) => sqlite.pragma(`user_version = ${Math.floor(v)}`),
  });
  return { db: drizzle(sqlite, { schema }) as unknown as LocalDb, close: () => sqlite.close() };
}
