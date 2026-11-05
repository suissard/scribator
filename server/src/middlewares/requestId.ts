import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

export const genRequestId = () => randomUUID().slice(0, 13);

export function registerRequestId(app: FastifyInstance): void {
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });
}
