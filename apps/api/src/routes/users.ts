import { roleSchema, userListResponseSchema } from '@fim/shared';
import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { users } from '@fim/db';

export const userRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      onRequest: [app.authenticate, app.requireRole('manager')],
      schema: {
        tags: ['users'],
        security: [{ bearerAuth: [] }],
        querystring: z.object({ role: roleSchema.optional() }),
        response: { 200: userListResponseSchema },
      },
    },
    async (req) => {
      const rows = await app.deps.db
        .select({ id: users.id, email: users.email, name: users.name, role: users.role })
        .from(users)
        .where(req.query.role ? eq(users.role, req.query.role) : undefined)
        .orderBy(asc(users.name));
      return { items: rows };
    },
  );
};
