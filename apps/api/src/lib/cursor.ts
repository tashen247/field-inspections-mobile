/**
 * Opaque keyset cursor over (updated_at, id). The timestamp keeps Postgres microsecond
 * precision as text, and the first page's server time rides along so every page of one
 * delta sync reports the same `serverTime`.
 */
export interface Cursor {
  updatedAt: string;
  id: string;
  serverTime: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.updatedAt}|${c.id}|${c.serverTime}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): Cursor | null {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const parts = raw.split('|');
  if (parts.length !== 3) return null;
  const [updatedAt, id, serverTime] = parts as [string, string, string];
  if (Number.isNaN(Date.parse(updatedAt)) || Number.isNaN(Date.parse(serverTime))) return null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { updatedAt, id, serverTime };
}
