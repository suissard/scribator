import type { FastifyRequest } from 'fastify';

/** 30 requêtes/min par utilisateur sur les routes IA (§9). Le contrôle suit l'authentification. */
export const aiRoute = (auth: (req: FastifyRequest, reply: never) => Promise<void>) =>
  ({
    preHandler: auth as never,
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute',
        hook: 'preHandler' as const,
        keyGenerator: (req: FastifyRequest) => req.user?.id ?? req.ip,
      },
    },
  }) as const;
