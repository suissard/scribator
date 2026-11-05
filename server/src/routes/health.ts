import type { FastifyInstance } from 'fastify';
import type { Deps } from '../deps.js';

export function healthRoutes(app: FastifyInstance, { pb }: Deps): void {
  app.get('/health', async (_req, reply) => {
    try {
      await pb.health.check();
      return { status: 'ok', pocketbase: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'degraded', pocketbase: 'unreachable' });
    }
  });
}
