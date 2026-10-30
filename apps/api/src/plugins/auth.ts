import fastifyJwt from '@fastify/jwt';
import type { Role } from '@fim/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../lib/errors.js';

export interface AccessTokenClaims {
  sub: string;
  role: Role;
  name: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessTokenClaims;
    user: AccessTokenClaims;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (...roles: Role[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const authPlugin = fp<{ secret: string; accessTtlSeconds: number }>(
  async (app, opts) => {
    await app.register(fastifyJwt, {
      secret: opts.secret,
      sign: { expiresIn: opts.accessTtlSeconds, algorithm: 'HS256' },
      verify: { algorithms: ['HS256'] },
    });

    app.decorate('authenticate', async (req: FastifyRequest) => {
      try {
        await req.jwtVerify();
      } catch {
        throw new AppError('UNAUTHORIZED', 'Missing or expired access token');
      }
    });

    app.decorate('requireRole', (...roles: Role[]) => async (req: FastifyRequest) => {
      if (!roles.includes(req.user.role)) {
        throw new AppError('FORBIDDEN', `Requires role: ${roles.join(' or ')}`);
      }
    });
  },
  { name: 'auth' },
);
