import { MIGRATIONS } from './migrations';
import type { RawSqlite } from './types';

export function migrate(raw: RawSqlite): number {
  const current = raw.userVersion();
  for (let v = current; v < MIGRATIONS.length; v++) {
    raw.exec('BEGIN');
    try {
      for (const stmt of MIGRATIONS[v]!) raw.exec(stmt);
      raw.setUserVersion(v + 1);
      raw.exec('COMMIT');
    } catch (err) {
      raw.exec('ROLLBACK');
      throw err;
    }
  }
  return MIGRATIONS.length;
}
