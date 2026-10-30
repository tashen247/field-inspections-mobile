import { randomBytes, randomUUID } from 'node:crypto';
import type { User } from '@fim/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { refreshTokens, users } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { sha256 } from '../lib/hash.js';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

function toUser(row: typeof users.$inferSelect): User {
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export async function issueTokens(
  app: FastifyInstance,
  user: typeof users.$inferSelect,
  familyId: string = randomUUID(),
): Promise<IssuedTokens & { user: User }> {
  const { db, config } = app.deps;
  const refreshToken = randomBytes(32).toString('base64url');
  await db.insert(refreshTokens).values({
    userId: user.id,
    tokenHash: sha256(refreshToken),
    familyId,
    expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
  });
  const accessToken = app.jwt.sign({ sub: user.id, role: user.role, name: user.name });
  return {
    accessToken,
    refreshToken,
    expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
    user: toUser(user),
  };
}

/**
 * Rotates a refresh token. Presenting an already-used token revokes the whole family:
 * a stolen token can be used at most once before both parties are logged out.
 */
export async function rotateRefreshToken(app: FastifyInstance, presented: string) {
  const { db } = app.deps;
  const invalid = () => new AppError('UNAUTHORIZED', 'Refresh token is invalid or expired');
  const found = await db.query.refreshTokens.findFirst({
    where: eq(refreshTokens.tokenHash, sha256(presented)),
  });
  if (!found) throw invalid();
  if (found.revokedAt) {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, found.familyId), isNull(refreshTokens.revokedAt)));
    app.log.warn({ userId: found.userId }, 'refresh token reuse detected; family revoked');
    throw invalid();
  }
  if (found.expiresAt.getTime() < Date.now()) throw invalid();

  const revoked = await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.id, found.id), isNull(refreshTokens.revokedAt)))
    .returning({ id: refreshTokens.id });
  if (revoked.length === 0) throw invalid(); // lost a race with a concurrent refresh

  const user = await db.query.users.findFirst({ where: eq(users.id, found.userId) });
  if (!user) throw invalid();
  return issueTokens(app, user, found.familyId);
}
