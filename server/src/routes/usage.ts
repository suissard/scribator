import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { callContext, type Deps } from '../deps.js';
import { forbidden } from '../lib/errors.js';
import { authenticate } from '../middlewares/auth.js';
import { monthlySpend } from '../middlewares/budget.js';

export function usageRoutes(app: FastifyInstance, deps: Deps): void {
  const { pb, env, llm } = deps;
  const auth = authenticate(env);

  app.get('/me/usage', { preHandler: auth }, async (req) => ({
    spent_usd: await monthlySpend(pb, req.user.id),
    budget_usd: req.user.monthly_budget_usd,
  }));

  app.post('/me/accept-terms', { preHandler: auth }, async (req) => {
    const accepted_terms_at = new Date().toISOString().replace('T', ' ');
    await pb.collection('users').update(req.user.id, { accepted_terms_at });
    return { accepted_terms_at };
  });

  /* Pas d'authentification : une erreur peut survenir avant la connexion. */
  app.post(
    '/client-errors',
    { bodyLimit: 32 * 1024, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req) => {
      const body = z
        .object({
          level: z.enum(['warn', 'error']).default('error'),
          message: z.string().max(2000),
          stack: z.string().max(10_000).optional(),
          route: z.string().max(500).optional(),
          request_id: z.string().max(100).optional(),
          context: z.record(z.string(), z.unknown()).optional(),
        })
        .parse(req.body);
      req.log[body.level]({ client_error: body }, 'journal frontend');
      return { ok: true };
    },
  );

  /* Vérifie la chaîne complète (clé API, journal ai_calls) sans passer par un projet. */
  app.post('/admin/ai-test', { preHandler: auth }, async (req) => {
    if (req.user.role !== 'admin') throw forbidden('Réservé aux administrateurs.');
    const { text } = await llm.stream({
      ctx: callContext(req),
      purpose: 'test',
      promptVersion: 'test',
      model: env.AI_MODEL_FAST,
      user: 'Réponds simplement « ok ».',
      maxTokens: 1000,
      onText: () => {},
    });
    return { text };
  });
}
