import {
  apiErrorSchema,
  loginBodySchema,
  loginResponseSchema,
  refreshBodySchema,
  tokenPairSchema,
} from '@fim/shared';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { users } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { issueTokens, rotateRefreshToken } from '../services/tokens.js';

// Compared against when the email is unknown, so response time does not reveal which emails exist.
const DUMMY_HASH = await hashPassword('timing-equaliser-password');

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['auth'],
        body: loginBodySchema,
        response: { 200: loginResponseSchema, 401: apiErrorSchema },
      },
    },
    async (req) => {
      const user = await app.deps.db.query.users.findFirst({
        where: eq(users.email, req.body.email),
      });
      const ok = await verifyPassword(req.body.password, user?.passwordHash ?? DUMMY_HASH);
      if (!user || !ok) throw new AppError('UNAUTHORIZED', 'Email or password is incorrect');
      req.log.info({ userId: user.id }, 'login');
      return issueTokens(app, user);
    },
  );

  app.post(
    '/refresh',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['auth'],
        body: refreshBodySchema,
        response: { 200: tokenPairSchema, 401: apiErrorSchema },
      },
    },
    async (req) => {
      const { accessToken, refreshToken, expiresIn } = await rotateRefreshToken(
        app,
        req.body.refreshToken,
      );
      return { accessToken, refreshToken, expiresIn };
    },
  );
};
