import { registerDeviceBodySchema } from '@fim/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { devices } from '../db/schema.js';

export const deviceRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['devices'],
        security: [{ bearerAuth: [] }],
        description: 'Register (or move) an Expo push token to the signed-in user.',
        body: registerDeviceBodySchema,
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      await app.deps.db
        .insert(devices)
        .values({
          userId: req.user.sub,
          expoPushToken: req.body.expoPushToken,
          platform: req.body.platform,
        })
        .onConflictDoUpdate({
          target: devices.expoPushToken,
          set: { userId: req.user.sub, platform: req.body.platform, updatedAt: new Date() },
        });
      return reply.status(204).send(null);
    },
  );
};
