import type { FastifyRequest } from 'fastify';
import type PocketBase from 'pocketbase';
import type { Env } from './config/env.js';
import type { ProjectLocks } from './middlewares/projectLock.js';
import type { GenerationService } from './services/generation.service.js';
import type { JobsService } from './services/jobs.service.js';
import type { CallContext, LlmService } from './services/llm.service.js';

export interface Deps {
  env: Env;
  pb: PocketBase;
  llm: LlmService;
  gen: GenerationService;
  jobs: JobsService;
  locks: ProjectLocks;
  assertBudget: (userId: string) => Promise<void>;
}

export const callContext = (req: FastifyRequest, projectId?: string): CallContext => ({
  userId: req.user.id,
  ...(projectId ? { projectId } : {}),
  requestId: req.id,
  log: req.log,
});

/** Contrôles communs aux routes IA synchrones (§5) : budget puis verrou, relâché dans un finally. */
export async function guardedAi<T>(deps: Deps, req: FastifyRequest, projectId: string, fn: () => Promise<T>): Promise<T> {
  await deps.assertBudget(req.user.id);
  return deps.locks.withLock(projectId, fn);
}

/** Même contrôles pour un job : le verrou reste pris jusqu'à la fin du job. */
export async function guardedJob(deps: Deps, req: FastifyRequest, projectId: string): Promise<void> {
  await deps.assertBudget(req.user.id);
  await deps.locks.acquire(projectId);
}
