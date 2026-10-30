import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export interface Database {
  db: Db;
  pool: pg.Pool;
  close(): Promise<void>;
}

export function createDatabase(url: string, max = 10): Database {
  const pool = new pg.Pool({ connectionString: url, max });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}
