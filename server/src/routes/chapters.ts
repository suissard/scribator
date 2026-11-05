import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { callContext, guardedAi, guardedJob, type Deps } from '../deps.js';
import { badRequest, conflict } from '../lib/errors.js';
import { authenticate, getOwned } from '../middlewares/auth.js';
import { settledChapterStatus } from '../services/jobs.service.js';
import {
  allApproved, chaptersToStale, chapterText, computeDiff, invalidateSynopsis, STYLE_DIFF_THRESHOLD_PERCENT,
} from '../services/memory.service.js';
import { reorderPending } from '../services/outline.service.js';
import type { ChapterRecord, ProjectRecord } from '../types.js';
import { aiRoute } from './shared.js';

const nowIso = () => new Date().toISOString().replace('T', ' ');

export function chapterRoutes(app: FastifyInstance, deps: Deps): void {
  const { pb, gen, jobs, env, locks } = deps;
  const auth = authenticate(env);
  type C = { Params: { id: string } };

  const assertWriting = (p: ProjectRecord) => {
    if (p.status !== 'STEP_5_WRITING') throw conflict("Valide d'abord l'échantillon.");
  };

  /** §4.2 : statut final du projet, recalculé après tout changement de la liste des chapitres. */
  async function syncCompletion(projectId: string): Promise<void> {
    const project = await gen.getProject(projectId);
    const chapters = await gen.listChapters(projectId);
    if (project.status === 'STEP_5_WRITING' && allApproved(chapters)) {
      await pb.collection('projects').update(projectId, { status: 'COMPLETED' });
    } else if (project.status === 'COMPLETED' && !allApproved(chapters)) {
      await pb.collection('projects').update(projectId, { status: 'STEP_5_WRITING' });
    }
  }

  async function renumber(ids: string[]): Promise<void> {
    for (const [i, id] of ids.entries()) await pb.collection('chapters').update(id, { chapter_number: i + 1 });
  }

  app.post<C>('/chapters/:id/plan-scenes', aiRoute(auth), async (req) => {
    const chapter = await getOwned<ChapterRecord>(req, 'chapters', req.params.id);
    assertWriting(await gen.getProject(chapter.project));
    if (['GENERATING', 'APPROVED', 'STALE'].includes(chapter.status)) {
      throw conflict('Ce chapitre ne peut pas être replanifié dans son état actuel.');
    }
    await guardedAi(deps, req, chapter.project, () => gen.planScenes(callContext(req, chapter.project), chapter));
    return { scenes: await gen.listScenes(chapter.id) };
  });

  app.post<C>('/chapters/:id/write', aiRoute(auth), async (req, reply) => {
    const chapter = await getOwned<ChapterRecord>(req, 'chapters', req.params.id);
    assertWriting(await gen.getProject(chapter.project));
    const chapters = await gen.listChapters(chapter.project);
    const previous = chapters.find((c) => c.chapter_number === chapter.chapter_number - 1);
    if (previous && previous.status !== 'APPROVED') {
      throw conflict(`Le chapitre ${previous.chapter_number} doit être validé avant celui-ci.`);
    }
    if (['GENERATING', 'APPROVED', 'STALE'].includes(chapter.status)) {
      throw conflict('Ce chapitre ne peut pas être généré dans son état actuel.');
    }
    const scenes = await gen.listScenes(chapter.id);
    if (chapter.status === 'REVIEW' && !scenes.some((s) => s.status === 'PENDING')) {
      throw conflict('Toutes les scènes sont déjà écrites. Régénère une scène ou valide le chapitre.');
    }
    await guardedJob(deps, req, chapter.project);
    try {
      await pb.collection('chapters').update(chapter.id, { status: 'GENERATING' });
    } catch (e) {
      locks.release(chapter.project);
      throw e;
    }
    const jobId = await jobs.launch({
      userId: req.user.id, projectId: chapter.project, kind: 'CHAPTER', targetId: chapter.id,
      requestId: req.id, logger: req.log,
      run: (job) => gen.writeChapter(job, chapter.id),
      onSettled: async (outcome) => {
        const list = await gen.listScenes(chapter.id);
        const map = { DONE: 'done', CANCELLED: 'cancelled', FAILED: 'failed' } as const;
        await pb.collection('chapters').update(chapter.id, { status: settledChapterStatus(list, map[outcome]) });
      },
    });
    return reply.code(202).send({ jobId });
  });

  app.post<C>('/chapters/:id/approve', aiRoute(auth), async (req) => {
    const owned = await getOwned<ChapterRecord>(req, 'chapters', req.params.id);
    return guardedAi(deps, req, owned.project, async () => {
      const chapter = await pb.collection('chapters').getOne<ChapterRecord>(owned.id);
      if (chapter.status !== 'REVIEW') throw conflict("Ce chapitre n'est pas en relecture.");
      const scenes = await gen.listScenes(chapter.id);
      if (scenes.length === 0 || scenes.some((s) => s.status !== 'REVIEW')) {
        throw conflict('Toutes les scènes doivent être écrites et en relecture.');
      }
      const project = await gen.getProject(chapter.project);
      const ctx = callContext(req, project.id);
      const original = scenes.map((s) => ({ ...s, content: s.ai_original_content }));
      const diff = computeDiff(chapterText(original), chapterText(scenes));

      // Les appels IA passent avant tout changement d'état : en cas d'échec, l'auteur peut réessayer
      // sans laisser un chapitre validé sans résumé. L'apprentissage du style, lui, est facultatif.
      const [memory, suggestion] = await Promise.all([
        gen.chapterMemory(ctx, project, chapter, scenes),
        diff.changedPercent > STYLE_DIFF_THRESHOLD_PERCENT && project.style_matrix
          ? gen.styleLearning(ctx, project.style_matrix, diff).catch((e: unknown) => {
              req.log.warn({ err: e }, "échec de l'apprentissage du style, validation maintenue");
              return null;
            })
          : Promise.resolve(null),
      ]);

      for (const s of scenes) await pb.collection('scenes').update(s.id, { status: 'APPROVED' });
      await pb.collection('chapters').update(chapter.id, {
        status: 'APPROVED',
        approved_at: nowIso(),
        post_writing_summary: memory.summary,
        stale_reason: '',
      });
      if (memory.patch.operations.length > 0) await gen.proposeChange(project.id, 'BIBLE_PATCH', memory.patch, chapter.id);
      if (suggestion) await gen.proposeChange(project.id, 'STYLE_SUGGESTION', suggestion, chapter.id);

      await gen.compressMemoryIfNeeded(ctx, await gen.getProject(project.id)).catch((e: unknown) => {
        req.log.warn({ err: e }, 'échec de la compression mémoire, réessai à la prochaine validation');
      });
      await syncCompletion(project.id);
      return { changedPercent: diff.changedPercent };
    });
  });

  app.post<C>('/chapters/:id/reopen', { preHandler: auth }, async (req) => {
    const owned = await getOwned<ChapterRecord>(req, 'chapters', req.params.id);
    return locks.withLock(owned.project, async () => {
      const chapter = await pb.collection('chapters').getOne<ChapterRecord>(owned.id);
      if (chapter.status !== 'APPROVED' && chapter.status !== 'STALE') {
        throw conflict("Seul un chapitre validé peut être rouvert.");
      }
      const scenes = await gen.listScenes(chapter.id);
      for (const s of scenes) await pb.collection('scenes').update(s.id, { status: 'REVIEW' });
      await pb.collection('chapters').update(chapter.id, { status: 'REVIEW', stale_reason: '' });
      const chapters = await gen.listChapters(chapter.project);
      const stale = chaptersToStale(chapters, chapter.chapter_number);
      for (const c of stale) {
        await pb.collection('chapters').update(c.id, {
          status: 'STALE',
          stale_reason: `Chapitre ${chapter.chapter_number} modifié après validation`,
        });
      }
      const project = await gen.getProject(chapter.project);
      const invalidated = invalidateSynopsis(project.synopsis_covers_up_to, chapter.chapter_number);
      if (invalidated) await pb.collection('projects').update(project.id, invalidated);
      await syncCompletion(project.id);
      return { stale: stale.map((c) => c.id) };
    });
  });

  app.post<C>('/chapters/:id/refresh-memory', aiRoute(auth), async (req) => {
    const owned = await getOwned<ChapterRecord>(req, 'chapters', req.params.id);
    return guardedAi(deps, req, owned.project, async () => {
      const chapter = await pb.collection('chapters').getOne<ChapterRecord>(owned.id);
      if (chapter.status !== 'STALE') throw conflict("Ce chapitre n'est pas à recalculer.");
      const project = await gen.getProject(chapter.project);
      const { summary, patch } = await gen.chapterMemory(
        callContext(req, project.id), project, chapter, await gen.listScenes(chapter.id),
      );
      await pb.collection('chapters').update(chapter.id, { status: 'APPROVED', post_writing_summary: summary, stale_reason: '' });
      if (patch.operations.length > 0) await gen.proposeChange(project.id, 'BIBLE_PATCH', patch, chapter.id);
      await syncCompletion(project.id);
      return { ok: true };
    });
  });

  app.post<C>('/chapters/:id/ignore-stale', { preHandler: auth }, async (req) => {
    const owned = await getOwned<ChapterRecord>(req, 'chapters', req.params.id);
    return locks.withLock(owned.project, async () => {
      const chapter = await pb.collection('chapters').getOne<ChapterRecord>(owned.id);
      if (chapter.status !== 'STALE') throw conflict("Ce chapitre n'est pas à recalculer.");
      await pb.collection('chapters').update(chapter.id, { status: 'APPROVED', stale_reason: '' });
      await syncCompletion(chapter.project);
      return { ok: true };
    });
  });

  app.post<{ Params: { id: string } }>('/projects/:id/chapters', { preHandler: auth }, async (req) => {
    const project = await getOwned<ProjectRecord>(req, 'projects', req.params.id);
    const body = z
      .object({ title: z.string().min(1).max(500), brief_summary: z.string().max(20_000).default('') })
      .parse(req.body);
    return locks.withLock(project.id, async () => {
      const chapters = await gen.listChapters(project.id);
      const created = await pb.collection('chapters').create({
        project: project.id,
        chapter_number: chapters.length + 1,
        ...body,
        key_events: [],
        target_words: project.target_words_per_chapter,
        user_edited_outline: true,
        status: 'PENDING',
      });
      await syncCompletion(project.id);
      return { chapter: created };
    });
  });

  app.delete<C>('/chapters/:id', { preHandler: auth }, async (req) => {
    const owned = await getOwned<ChapterRecord>(req, 'chapters', req.params.id);
    return locks.withLock(owned.project, async () => {
      const chapter = await pb.collection('chapters').getOne<ChapterRecord>(owned.id);
      if (chapter.status !== 'PENDING') throw conflict('Seul un chapitre encore en attente peut être supprimé.');
      await pb.collection('chapters').delete(chapter.id);
      await renumber((await gen.listChapters(chapter.project)).map((c) => c.id));
      await syncCompletion(chapter.project);
      return { ok: true };
    });
  });

  app.post('/chapters/reorder', { preHandler: auth }, async (req) => {
    const { projectId, orderedIds } = z
      .object({ projectId: z.string(), orderedIds: z.array(z.string()) })
      .parse(req.body);
    await getOwned<ProjectRecord>(req, 'projects', projectId);
    return locks.withLock(projectId, async () => {
      const next = reorderPending(await gen.listChapters(projectId), orderedIds);
      if (!next) throw badRequest('Seuls les chapitres en attente peuvent être réordonnés.');
      await renumber(next);
      return { ok: true };
    });
  });
}

