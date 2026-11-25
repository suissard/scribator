import type { FastifyRequest } from 'fastify';
import type PocketBase from 'pocketbase';
import type { Env } from './config/env.js';
import type { ProjectLocks } from './middlewares/projectLock.js';
import type { GenerationService } from './services/generation.service.js';
import type { JobsService } from './services/jobs.service.js';
import type { CallContext, LlmService } from './services/llm.service.js';
import type { StatsService } from './services/stats.service.js';
import type { UserKeyService } from './services/userKey.service.js';

export interface Deps {
  env: Env;
  pb: PocketBase;
  llm: LlmService;
  gen: GenerationService;
  jobs: JobsService;
  stats: StatsService;
  locks: ProjectLocks;
  userKeys: UserKeyService;
  assertBudget: (userId: string) => Promise<void>;
}

export const callContext = (req: FastifyRequest, projectId?: string): CallContext => ({
  userId: req.user.id,
  ...(projectId ? { projectId } : {}),
  requestId: req.id,
  log: req.log,
});

/** Vérifie qu'une clé OpenRouter est utilisable (personnelle ou repli serveur) et le budget le cas échéant. */
async function assertCanUseAi(deps: Deps, userId: string): Promise<void> {
  const { source } = await deps.userKeys.resolveApiKey(userId);
  if (source === 'server') await deps.assertBudget(userId);
}

/** Contrôles communs aux routes IA synchrones (§5) : clé + budget puis verrou, relâché dans un finally. */
export async function guardedAi<T>(deps: Deps, req: FastifyRequest, projectId: string, fn: () => Promise<T>): Promise<T> {
  await assertCanUseAi(deps, req.user.id);
  return deps.locks.withLock(projectId, fn);
}

/** Même contrôles pour un job : le verrou reste pris jusqu'à la fin du job. */
export async function guardedJob(deps: Deps, req: FastifyRequest, projectId: string): Promise<void> {
  await assertCanUseAi(deps, req.user.id);
  await deps.locks.acquire(projectId);
}
