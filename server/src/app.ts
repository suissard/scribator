import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { LogController, type FastifyError, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { ZodError } from 'zod';
import OpenAI from 'openai';
import type { Env } from './config/env.js';
import type { Deps } from './deps.js';
import { AppError } from './lib/errors.js';
import { createSuperuserClient } from './lib/pb.js';
import { budgetGuard } from './middlewares/budget.js';
import { ProjectLocks } from './middlewares/projectLock.js';
import { genRequestId, registerRequestId } from './middlewares/requestId.js';
import { chapterRoutes } from './routes/chapters.js';
import { exportRoutes } from './routes/export.js';
import { healthRoutes } from './routes/health.js';
import { jobRoutes } from './routes/jobs.js';
import { projectRoutes } from './routes/projects.js';
import { sceneRoutes } from './routes/scenes.js';
import { usageRoutes } from './routes/usage.js';
import { GenerationService } from './services/generation.service.js';
import { humanMessage, JobsService } from './services/jobs.service.js';
import { LlmService } from './services/llm.service.js';
import { ModelCatalog } from './services/models.service.js';

function loggerOptions(env: Env): FastifyServerOptions['logger'] {
  const base = {
    level: env.LOG_LEVEL,
    redact: ['req.headers.authorization', 'headers.authorization', '*.password', '*.apiKey'],
  };
  if (env.NODE_ENV === 'production') {
    return {
      ...base,
      transport: {
        target: 'pino-roll',
        options: { file: `${env.LOG_DIR}/server.log`, frequency: 'daily', mkdir: true, limit: { count: 14 } },
      },
    };
  }
  if (env.NODE_ENV === 'test') return { ...base, level: 'silent' };
  return { ...base, transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } };
}

export async function buildApp(env: Env): Promise<{ app: FastifyInstance; deps: Deps }> {
  const app = Fastify({
    logger: loggerOptions(env),
    genReqId: genRequestId,
    logController: new LogController({ requestIdLogLabel: 'request_id' }),
    bodyLimit: 6 * 1024 * 1024,
    connectionTimeout: 0,
    keepAliveTimeout: 125_000, // au-delà des 120 s du proxy
  });

  const pb = await createSuperuserClient(env);
  const locks = new ProjectLocks(pb);
  const assertBudget = budgetGuard(pb, app.log);
  const catalog = new ModelCatalog();
  await catalog.load(env.OPENROUTER_BASE_URL, app.log);
  catalog.assertUsable([env.AI_MODEL_CREATIVE, env.AI_MODEL_FAST, env.AI_MODEL_REFUSAL_FALLBACK].filter(Boolean));
  const llm = new LlmService(env, catalog, (entry) => pb.collection('ai_calls').create(entry), assertBudget);
  const gen = new GenerationService(pb, env, llm);
  const jobs = new JobsService(pb, env, locks, app.log);
  const deps: Deps = { env, pb, llm, gen, jobs, locks, assertBudget };

  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    exposedHeaders: ['x-request-id', 'content-disposition'],
  });
  await app.register(rateLimit, { global: false });
  registerRequestId(app);

  app.setErrorHandler((error: FastifyError | Error, req, reply) => {
    const body = { request_id: req.id };
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'validation', message: 'Requête invalide.', ...body });
    }
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: error.code, message: error.message, ...body });
    }
    if (error instanceof OpenAI.APIError) {
      req.log.error({ err: error }, 'erreur du service IA');
      return reply.code(502).send({ error: 'ai_error', message: humanMessage(error), ...body });
    }
    const status = 'statusCode' in error && error.statusCode ? error.statusCode : 500;
    if (status < 500) return reply.code(status).send({ error: 'request', message: error.message, ...body });
    req.log.error({ err: error }, 'erreur serveur');
    return reply.code(500).send({ error: 'internal', message: 'Une erreur interne est survenue.', ...body });
  });

  await app.register(
    async (api) => {
      healthRoutes(api, deps);
      usageRoutes(api, deps);
      projectRoutes(api, deps);
      chapterRoutes(api, deps);
      sceneRoutes(api, deps);
      jobRoutes(api, deps);
      exportRoutes(api, deps);
    },
    { prefix: '/api' },
  );

  return { app, deps };
}
