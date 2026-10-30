import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        response: {
          200: z.object({ status: z.literal('ok'), db: z.literal('ok'), time: z.iso.datetime() }),
        },
      },
      logLevel: 'warn',
    },
    async () => {
      await app.deps.db.execute(sql`select 1`);
      return { status: 'ok' as const, db: 'ok' as const, time: new Date().toISOString() };
    },
  );
};
