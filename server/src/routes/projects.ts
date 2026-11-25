import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { guardedJob, type Deps } from '../deps.js';
import { authenticate, getOwned } from '../middlewares/auth.js';
import { badRequest, conflict, forbidden } from '../lib/errors.js';
import { monthlySpend } from '../middlewares/budget.js';
import { PartialStyleSchema } from '../services/bible.service.js';
import { allApproved } from '../services/memory.service.js';
import { estimateBookDuration } from '../services/stats.service.js';
import { archiveVersion } from '../services/versions.service.js';
import { STATUS_ORDER, StoryBibleSchema, type ProjectRecord, type ProjectStatus, type StyleMatrix } from '../types.js';
import { aiRoute } from './shared.js';

const atLeast = (s: ProjectStatus, min: ProjectStatus) => STATUS_ORDER.indexOf(s) >= STATUS_ORDER.indexOf(min);

export function projectRoutes(app: FastifyInstance, deps: Deps): void {
  const { pb, gen, jobs, env, stats } = deps;
  const auth = authenticate(env);
  type P = { Params: { id: string } };
  const lockThen = <T>(id: string, fn: () => Promise<T>) => deps.locks.withLock(id, fn);

  app.post<P>('/projects/:id/analyze', aiRoute(auth), async (req, reply) => {
    const project = await getOwned<ProjectRecord>(req, 'projects', req.params.id);
    const { feedback } = z.object({ feedback: z.string().max(5000).optional() }).parse(req.body ?? {});
    if (atLeast(project.status, 'STEP_3_OUTLINE_REVIEW')) {
      throw conflict('La trame existe déjà : modifie le concept, le style et la Bible directement.');
    }
    if (project.reference_file && !req.user.accepted_terms_at) {
      throw forbidden("Tu dois accepter les conditions d'utilisation avant d'analyser un fichier.");
    }
    if (!project.raw_ideas.trim() && !project.reference_file) {
      throw badRequest("Décris tes idées ou dépose un ouvrage de référence avant de lancer l'analyse.");
    }
    await guardedJob(deps, req, project.id);
    const jobId = await jobs.launch({
      userId: req.user.id, projectId: project.id, kind: 'ANALYZE', targetId: project.id,
      requestId: req.id, logger: req.log,
      run: (job) => gen.analyze(job, project.id, feedback),
    });
    return reply.code(202).send({ jobId });
  });

  app.post<P>('/projects/:id/outline', aiRoute(auth), async (req, reply) => {
    const project = await getOwned<ProjectRecord>(req, 'projects', req.params.id);
    const { userFeedback } = z.object({ userFeedback: z.string().max(5000).optional() }).parse(req.body ?? {});
    if (!atLeast(project.status, 'STEP_2_CONCEPT_REVIEW')) throw conflict("Lance d'abord l'analyse.");
    await guardedJob(deps, req, project.id);
    const jobId = await jobs.launch({
      userId: req.user.id, projectId: project.id, kind: 'OUTLINE', targetId: project.id,
      requestId: req.id, logger: req.log,
      run: (job) => gen.outlineJob(job, project.id, userFeedback),
    });
    return reply.code(202).send({ jobId });
  });

  app.post<P>('/projects/:id/write-all', aiRoute(auth), async (req, reply) => {
    const project = await getOwned<ProjectRecord>(req, 'projects', req.params.id);
    if (project.status !== 'STEP_5_WRITING') throw conflict("Commence d'abord par le premier chapitre.");
    if (allApproved(await gen.listChapters(project.id))) throw conflict('Tous les chapitres sont déjà validés.');
    await guardedJob(deps, req, project.id);
    const jobId = await jobs.launch({
      userId: req.user.id, projectId: project.id, kind: 'BOOK', targetId: project.id,
      requestId: req.id, logger: req.log,
      run: (job) => gen.writeBook(job, project.id),
      onSettled: (outcome) => gen.settleChapters(project.id, outcome),
    });
    return reply.code(202).send({ jobId });
  });

  app.get<P>('/projects/:id/estimate', { preHandler: auth }, async (req) => {
    const project = await getOwned<ProjectRecord>(req, 'projects', req.params.id);
    const [work, chapters, stages, spent, usingOwnKey] = await Promise.all([
      gen.bookWork(project.id),
      gen.listChapters(project.id),
      stats.stageEstimates(project.id),
      monthlySpend(pb, req.user.id),
      deps.userKeys.hasPersonalKey(req.user.id),
    ]);
    return {
      ...estimateBookDuration({ chapters: work.todo.length, plans: work.toPlan.length + work.toRewrite.length, scenes: work.sceneCount }, stages),
      rewrites: work.toRewrite.length,
      ...gen.estimateBookCost(project, chapters, work.perChapter),
      budget_left_usd: usingOwnKey ? null : Math.max(0, req.user.monthly_budget_usd - spent),
    };
  });

  app.get<P>('/projects/:id/report', { preHandler: auth }, async (req) => {
    const project = await getOwned<ProjectRecord>(req, 'projects', req.params.id);
    return stats.report(project.id);
  });

  app.get('/models', { preHandler: auth }, async () => ({
    default_model: env.AI_MODEL_CREATIVE,
    models: deps.llm.catalog.selectable(),
  }));

  app.patch<P>('/projects/:id/model', { preHandler: auth }, async (req) => {
    const owned = await getOwned<ProjectRecord>(req, 'projects', req.params.id);
    const { model } = z.object({ model: z.string().max(200) }).parse(req.body);
    if (model) {
      try {
        deps.llm.catalog.assertUsable([model]);
      } catch (e) {
        throw badRequest((e as Error).message);
      }
    }
    return lockThen(owned.id, async () => {
      await pb.collection('projects').update(owned.id, { model_creative: model });
      return { model_creative: model };
    });
  });

  app.patch<P>('/projects/:id/style', { preHandler: auth }, async (req) => {
    const owned = await getOwned<ProjectRecord>(req, 'projects', req.params.id);
    const changes = PartialStyleSchema.parse(req.body);
    return lockThen(owned.id, async () => {
      const project = await gen.getProject(owned.id);
      if (!project.style_matrix) throw conflict("Le style n'existe pas encore.");
      await archiveVersion(pb, {
        project: project.id, target_collection: 'projects', target_id: project.id, field: 'style_matrix',
        content: project.style_matrix, reason: 'before_patch',
      });
      const style_matrix: StyleMatrix = { ...project.style_matrix, ...changes };
      await pb.collection('projects').update(project.id, { style_matrix });
      return { style_matrix };
    });
  });

  app.patch<P>('/projects/:id/bible', { preHandler: auth }, async (req) => {
    const owned = await getOwned<ProjectRecord>(req, 'projects', req.params.id);
    const story_bible = StoryBibleSchema.parse(req.body);
    return lockThen(owned.id, async () => {
      const project = await gen.getProject(owned.id);
      await archiveVersion(pb, {
        project: project.id, target_collection: 'projects', target_id: project.id, field: 'story_bible',
        content: project.story_bible, reason: 'before_patch',
      });
      await pb.collection('projects').update(project.id, { story_bible });
      return { story_bible };
    });
  });
}
