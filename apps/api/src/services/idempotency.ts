import { and, eq, sql } from 'drizzle-orm';
import type { Db, Tx } from '@fim/db';
import { idempotencyKeys } from '@fim/db';
import { AppError } from '../lib/errors.js';
import { sha256, stableStringify } from '../lib/hash.js';

export interface IdempotentResult<T> {
  statusCode: number;
  body: T;
  replayed: boolean;
}

/**
 * Runs `fn` at most once per (user, key). The whole thing shares one transaction guarded by
 * an advisory lock, so two concurrent retries of the same request serialise: the second waits
 * and then replays the first one's stored response. Errors roll back and are not stored, so a
 * failed attempt can be retried with the same key.
 */
export async function withIdempotency<T>(
  db: Db,
  opts: { userId: string; key: string | undefined; route: string; body: unknown },
  fn: (tx: Tx) => Promise<{ statusCode: number; body: T }>,
): Promise<IdempotentResult<T>> {
  const key = opts.key?.trim();
  if (!key)
    throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'The Idempotency-Key header is required');
  if (key.length > 200) throw new AppError('BAD_REQUEST', 'Idempotency-Key is too long');
  const requestHash = sha256(`${opts.route}\n${stableStringify(opts.body)}`);

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${opts.userId}:${key}`}, 0))`,
    );
    const existing = await tx.query.idempotencyKeys.findFirst({
      where: and(eq(idempotencyKeys.userId, opts.userId), eq(idempotencyKeys.key, key)),
    });
    if (existing) {
      if (existing.requestHash !== requestHash || existing.route !== opts.route) {
        throw new AppError(
          'IDEMPOTENCY_KEY_REUSED',
          'This Idempotency-Key was already used for a different request',
        );
      }
      return { statusCode: existing.statusCode, body: existing.response as T, replayed: true };
    }
    const result = await fn(tx);
    await tx.insert(idempotencyKeys).values({
      userId: opts.userId,
      key,
      route: opts.route,
      requestHash,
      statusCode: result.statusCode,
      response: result.body as object,
    });
    return { ...result, replayed: false };
  });
}
