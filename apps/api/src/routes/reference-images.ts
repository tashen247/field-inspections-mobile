import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { REFERENCE_IMAGE_NAMES, referenceImageSvg } from '../services/reference-images.js';

export const referenceImageRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['templates'],
        description: 'Names of the reference images that guided shots can point at.',
        response: { 200: z.object({ items: z.array(z.string()) }) },
      },
    },
    async () => ({ items: REFERENCE_IMAGE_NAMES }),
  );

  app.get(
    '/:name',
    {
      schema: {
        tags: ['templates'],
        description: 'Example framing for a guided shot (SVG). Cached by the app for offline use.',
        params: z.object({ name: z.string().regex(/^[a-z0-9_]+\.svg$/) }),
      },
    },
    async (req, reply) => {
      const svg = referenceImageSvg(req.params.name.replace(/\.svg$/, ''));
      if (!svg) throw new AppError('NOT_FOUND', 'No such reference image');
      return reply
        .header('content-type', 'image/svg+xml')
        .header('cache-control', 'public, max-age=86400')
        .send(svg);
    },
  );
};
