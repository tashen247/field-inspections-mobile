import { templateListResponseSchema } from '@fim/shared';
import { asc } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { templates } from '../db/schema.js';

export const templateRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['templates'],
        security: [{ bearerAuth: [] }],
        description:
          'All checklist template versions. Inspections pin the version they were created with.',
        response: { 200: templateListResponseSchema },
      },
    },
    async () => {
      const rows = await app.deps.db
        .select()
        .from(templates)
        .orderBy(asc(templates.type), asc(templates.version));
      return {
        items: rows.map((t) => ({
          id: t.id,
          name: t.name,
          type: t.type,
          version: t.version,
          schema: t.schema,
          createdAt: t.createdAt.toISOString(),
        })),
      };
    },
  );
};
