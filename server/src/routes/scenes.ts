import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { guardedJob, type Deps } from '../deps.js';
import { conflict } from '../lib/errors.js';
import { authenticate, getOwned } from '../middlewares/auth.js';
import type { ChapterRecord, SceneRecord } from '../types.js';
import { aiRoute } from './shared.js';

export function sceneRoutes(app: FastifyInstance, deps: Deps): void {
  const { pb, gen, jobs, env } = deps;
  const auth = authenticate(env);

  app.post<{ Params: { id: string } }>('/scenes/:id/regenerate', aiRoute(auth), async (req, reply) => {
    const scene = await getOwned<SceneRecord>(req, 'scenes', req.params.id);
    const { instructions } = z.object({ instructions: z.string().max(5000).optional() }).parse(req.body ?? {});
    const chapter = await pb.collection('chapters').getOne<ChapterRecord>(scene.chapter);
    if (scene.status !== 'REVIEW' || !['REVIEW', 'PLANNED', 'ERROR'].includes(chapter.status)) {
      throw conflict('Seule une scène en relecture peut être régénérée. Rouvre le chapitre si besoin.');
    }
    await guardedJob(deps, req, chapter.project);
    const jobId = await jobs.launch({
      userId: req.user.id, projectId: chapter.project, kind: 'SCENE', targetId: scene.id,
      requestId: req.id, logger: req.log,
      run: (job) => gen.regenerateScene(job, scene.id, instructions),
    });
    return reply.code(202).send({ jobId });
  });
}
