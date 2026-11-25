import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import { authenticate } from '../middlewares/auth.js';

const KEY_RATE_LIMIT = { max: 10, timeWindow: '1 minute' };

export function userKeyRoutes(app: FastifyInstance, deps: Deps): void {
  const { env, userKeys } = deps;
  const auth = authenticate(env);

  app.get('/me/openrouter-key', { preHandler: auth }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return userKeys.getStatus(req.user.id);
  });

  app.put(
    '/me/openrouter-key',
    { preHandler: auth, bodyLimit: 4096, config: { rateLimit: KEY_RATE_LIMIT } },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      const { apiKey } = z.object({ apiKey: z.string().min(1).max(512) }).parse(req.body);
      const status = await userKeys.saveKey(req.user.id, apiKey);
      req.log.info({ user: req.user.id }, 'clé OpenRouter personnelle enregistrée');
      return status;
    },
  );

  app.post(
    '/me/openrouter-key/test',
    { preHandler: auth, config: { rateLimit: KEY_RATE_LIMIT } },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      return userKeys.testStoredKey(req.user.id);
    },
  );

  app.delete(
    '/me/openrouter-key',
    { preHandler: auth, config: { rateLimit: KEY_RATE_LIMIT } },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      const status = await userKeys.deleteKey(req.user.id);
      req.log.info({ user: req.user.id }, 'clé OpenRouter personnelle supprimée');
      return status;
    },
  );
}
