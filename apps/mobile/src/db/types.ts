import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type { schema } from './schema';

/**
 * Both expo-sqlite (on device) and better-sqlite3 (in tests) give a synchronous Drizzle
 * database, so repositories use .all()/.get()/.run() and work unchanged on either.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LocalDb = BaseSQLiteDatabase<'sync', any, typeof schema>;

/** Minimal raw access the migrator needs. */
export interface RawSqlite {
  exec(sql: string): void;
  userVersion(): number;
  setUserVersion(v: number): void;
}
