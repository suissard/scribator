import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { callContext, guardedAi, guardedJob, type Deps } from '../deps.js';
import { authenticate, getOwned } from '../middlewares/auth.js';
import { badRequest, conflict, forbidden } from '../lib/errors.js';
import { PartialStyleSchema } from '../services/bible.service.js';
import { computeDiff, STYLE_DIFF_THRESHOLD_PERCENT } from '../services/memory.service.js';
import { countWords } from '../services/parser.service.js';
import { archiveVersion } from '../services/versions.service.js';
import { STATUS_ORDER, StoryBibleSchema, type ProjectRecord, type ProjectStatus, type StyleMatrix } from '../types.js';
import { aiRoute } from './shared.js';

const atLeast = (s: ProjectStatus, min: ProjectStatus) => STATUS_ORDER.indexOf(s) >= STATUS_ORDER.indexOf(min);

export function projectRoutes(app: FastifyInstance, deps: Deps): void {
  const { pb, gen, jobs, env } = deps;
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

  app.post<P>('/projects/:id/outline', aiRoute(auth), async (req) => {
    const project = await getOwned<ProjectRecord>(req, 'projects', req.params.id);
    const { userFeedback } = z.object({ userFeedback: z.string().max(5000).optional() }).parse(req.body ?? {});
    if (!atLeast(project.status, 'STEP_2_CONCEPT_REVIEW')) throw conflict("Lance d'abord l'analyse.");
    await guardedAi(deps, req, project.id, () => gen.generateOutline(callContext(req, project.id), project.id, userFeedback));
    return { ok: true };
  });

  app.post<P>('/projects/:id/sample', aiRoute(auth), async (req, reply) => {
    const project = await getOwned<ProjectRecord>(req, 'projects', req.params.id);
    if (!atLeast(project.status, 'STEP_3_OUTLINE_REVIEW')) throw conflict("Valide d'abord le concept et la trame.");
    await guardedJob(deps, req, project.id);
    const jobId = await jobs.launch({
      userId: req.user.id, projectId: project.id, kind: 'SAMPLE', targetId: project.id,
      requestId: req.id, logger: req.log,
      run: (job) => gen.writeSample(job, project.id),
    });
    return reply.code(202).send({ jobId });
  });

  app.post<P>('/projects/:id/sample/approve', aiRoute(auth), async (req) => {
    const owned = await getOwned<ProjectRecord>(req, 'projects', req.params.id);
    if (owned.status !== 'STEP_4_SAMPLE_REVIEW') throw conflict("L'échantillon n'est pas en attente de validation.");
    return guardedAi(deps, req, owned.id, async () => {
      const project = await gen.getProject(owned.id); // relu sous verrou : dernière frappe de l'auteur
      if (project.status !== 'STEP_4_SAMPLE_REVIEW') throw conflict("L'échantillon est déjà validé.");
      if (!project.sample_text.trim()) throw badRequest("L'échantillon est vide.");
      const first = (await gen.listChapters(project.id))[0];
      if (!first) throw badRequest('La trame est vide.');

      const diff = computeDiff(project.sample_ai_original, project.sample_text);
      if (diff.changedPercent > STYLE_DIFF_THRESHOLD_PERCENT && project.style_matrix) {
        const suggestion = await gen.styleLearning(callContext(req, project.id), project.style_matrix, diff);
        if (suggestion) await gen.proposeChange(project.id, 'STYLE_SUGGESTION', suggestion);
      }
      // L'original de la scène est le texte validé : les corrections déjà apprises ici
      // ne doivent pas être comptées une seconde fois à la validation du chapitre.
      await pb.collection('scenes').create({
        chapter: first.id,
        scene_number: 1,
        beat: first.brief_summary,
        target_words: countWords(project.sample_text),
        content: project.sample_text,
        ai_original_content: project.sample_text,
        status: 'REVIEW',
      });
      await pb.collection('chapters').update(first.id, { status: 'PLANNED' });
      await pb.collection('projects').update(project.id, { status: 'STEP_5_WRITING' });
      return { changedPercent: diff.changedPercent };
    });
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
