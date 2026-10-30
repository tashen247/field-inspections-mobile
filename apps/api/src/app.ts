import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, {
  LogController,
  type FastifyBaseLogger,
  type FastifyError,
  type FastifyInstance,
} from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Logger } from 'pino';
import type { Config } from './config.js';
import type { Db } from '@fim/db';
import { AppError } from './lib/errors.js';
import { authPlugin } from './plugins/auth.js';
import { authRoutes } from './routes/auth.js';
import { deviceRoutes } from './routes/devices.js';
import { healthRoutes } from './routes/health.js';
import { inspectionRoutes } from './routes/inspections.js';
import { referenceImageRoutes } from './routes/reference-images.js';
import { templateRoutes } from './routes/templates.js';
import { uploadRoutes } from './routes/uploads.js';
import { userRoutes } from './routes/users.js';
import type { OutboxRelay } from './services/outbox.js';
import type { Storage } from './services/storage.js';

export interface AppDeps {
  config: Pick<
    Config,
    | 'JWT_SECRET'
    | 'ACCESS_TOKEN_TTL_SECONDS'
    | 'REFRESH_TOKEN_TTL_DAYS'
    | 'NODE_ENV'
    | 'PRESIGN_TTL_SECONDS'
  >;
  db: Db;
  storage: Storage;
  outbox: OutboxRelay;
  logger: Logger;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
  }
}

export const CORRELATION_HEADER = 'x-correlation-id';

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: deps.logger as FastifyBaseLogger,
    genReqId: (req) => {
      const incoming = req.headers[CORRELATION_HEADER];
      return typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming)
        ? incoming
        : randomUUID();
    },
    logController: new LogController({ requestIdLogLabel: 'correlationId' }),
    bodyLimit: 5 * 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('deps', deps);

  app.addHook('onSend', async (req, reply) => {
    reply.header(CORRELATION_HEADER, req.id);
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    const correlationId = req.id;
    if (err instanceof AppError) {
      return reply
        .status(err.statusCode)
        .send({ code: err.code, message: err.message, correlationId, details: err.details });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.status(422).send({
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        correlationId,
        details: err.validation.map((v) => ({ path: v.instancePath, message: v.message })),
      });
    }
    if (isResponseSerializationError(err)) {
      req.log.error({ err, issues: err.cause.issues }, 'response failed schema');
      return reply
        .status(500)
        .send({ code: 'INTERNAL', message: 'Unexpected error', correlationId });
    }
    if (err.statusCode === 429) {
      return reply
        .status(429)
        .send({ code: 'RATE_LIMITED', message: 'Too many requests, slow down', correlationId });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply
        .status(err.statusCode)
        .send({ code: 'BAD_REQUEST', message: err.message, correlationId });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ code: 'INTERNAL', message: 'Unexpected error', correlationId });
  });

  app.setNotFoundHandler((req, reply) =>
    reply.status(404).send({
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.url} not found`,
      correlationId: req.id,
    }),
  );

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: true, exposedHeaders: [CORRELATION_HEADER] });
  await app.register(rateLimit, { global: false });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Field Inspections API',
        version: '1.0.0',
        description: 'Offline-first inspection sync, review and reporting.',
      },
      components: {
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  await app.register(authPlugin, {
    secret: deps.config.JWT_SECRET,
    accessTtlSeconds: deps.config.ACCESS_TOKEN_TTL_SECONDS,
  });

  await app.register(healthRoutes);
  await app.register(
    async (v1) => {
      await v1.register(authRoutes, { prefix: '/auth' });
      await v1.register(templateRoutes, { prefix: '/templates' });
      await v1.register(referenceImageRoutes, { prefix: '/reference-images' });
      await v1.register(inspectionRoutes, { prefix: '/inspections' });
      await v1.register(uploadRoutes, { prefix: '/inspections' });
      await v1.register(userRoutes, { prefix: '/users' });
      await v1.register(deviceRoutes, { prefix: '/devices' });
    },
    { prefix: '/v1' },
  );

  return app;
}
