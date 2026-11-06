import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { callContext, guardedAi, guardedJob, type Deps } from '../deps.js';
import { badRequest, conflict } from '../lib/errors.js';
import { authenticate, getOwned } from '../middlewares/auth.js';
import { settledChapterStatus, type JobHandle } from '../services/jobs.service.js';
import { chaptersToStale, invalidateSynopsis } from '../services/memory.service.js';
import { reorderPending } from '../services/outline.service.js';
import type { ChapterRecord, ProjectRecord } from '../types.js';
import { aiRoute } from './shared.js';

export function chapterRoutes(app: FastifyInstance, deps: Deps): void {
  const { pb, gen, jobs, env, locks } = deps;
  const auth = authenticate(env);
  type C = { Params: { id: string } };

  const assertWriting = (p: ProjectRecord) => {
    if (p.status !== 'STEP_5_WRITING') throw conflict("Valide d'abord l'échantillon.");
  };

  async function renumber(ids: string[]): Promise<void> {
    for (const [i, id] of ids.entries()) await pb.collection('chapters').update(id, { chapter_number: i + 1 });
  }

  async function assertPreviousApproved(chapter: ChapterRecord): Promise<void> {
    const chapters = await gen.listChapters(chapter.project);
    const previous = chapters.find((c) => c.chapter_number === chapter.chapter_number - 1);
    if (previous && previous.status !== 'APPROVED') {
      throw conflict(`Le chapitre ${previous.chapter_number} doit être validé avant celui-ci.`);
    }
  }

  async function launchChapterJob(req: FastifyRequest, chapter: ChapterRecord, run: (job: JobHandle) => Promise<void>): Promise<string> {
    await guardedJob(deps, req, chapter.project);
    try {
      await pb.collection('chapters').update(chapter.id, { status: 'GENERATING' });
    } catch (e) {
      locks.release(chapter.project);
      throw e;
    }
    return jobs.launch({
      userId: req.user.id, projectId: chapter.project, kind: 'CHAPTER', targetId: chapter.id,
      requestId: req.id, logger: req.log,
      run,
      onSettled: async (outcome) => {
        const list = await gen.listScenes(chapter.id);
        const map = { DONE: 'done', CANCELLED: 'cancelled', FAILED: 'failed' } as const;
        await pb.collection('chapters').update(chapter.id, { status: settledChapterStatus(list, map[outcome]) });
      },
    });
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
    await assertPreviousApproved(chapter);
    if (['GENERATING', 'APPROVED', 'STALE'].includes(chapter.status)) {
      throw conflict('Ce chapitre ne peut pas être généré dans son état actuel.');
    }
    const scenes = await gen.listScenes(chapter.id);
    if (chapter.status === 'REVIEW' && !scenes.some((s) => s.status === 'PENDING')) {
      throw conflict('Toutes les scènes sont déjà écrites. Régénère une scène ou valide le chapitre.');
    }
    const jobId = await launchChapterJob(req, chapter, (job) => gen.writeChapter(job, chapter.id));
    return reply.code(202).send({ jobId });
  });

  app.post<C>('/chapters/:id/rewrite', aiRoute(auth), async (req, reply) => {
    const chapter = await getOwned<ChapterRecord>(req, 'chapters', req.params.id);
    assertWriting(await gen.getProject(chapter.project));
    await assertPreviousApproved(chapter);
    if (chapter.status !== 'REVIEW') throw conflict('Rouvre ce chapitre avant de le réécrire.');
    const jobId = await launchChapterJob(req, chapter, (job) => gen.rewriteChapter(job, chapter.id));
    return reply.code(202).send({ jobId });
  });

  app.post<C>('/chapters/:id/approve', aiRoute(auth), async (req) => {
    const owned = await getOwned<ChapterRecord>(req, 'chapters', req.params.id);
    return guardedAi(deps, req, owned.project, () => gen.approveChapter(callContext(req, owned.project), owned.id));
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
      await gen.syncCompletion(project.id);
      return { stale: stale.map((c) => c.id) };
    });
  });

  app.post<C>('/chapters/:id/refresh-memory', aiRoute(auth), async (req) => {
    const owned = await getOwned<ChapterRecord>(req, 'chapters', req.params.id);
    await guardedAi(deps, req, owned.project, () => gen.refreshChapterMemory(callContext(req, owned.project), owned.id));
    return { ok: true };
  });

  app.post<C>('/chapters/:id/ignore-stale', { preHandler: auth }, async (req) => {
    const owned = await getOwned<ChapterRecord>(req, 'chapters', req.params.id);
    return locks.withLock(owned.project, async () => {
      const chapter = await pb.collection('chapters').getOne<ChapterRecord>(owned.id);
      if (chapter.status !== 'STALE') throw conflict("Ce chapitre n'est pas à recalculer.");
      await pb.collection('chapters').update(chapter.id, { status: 'APPROVED', stale_reason: '' });
      await gen.syncCompletion(chapter.project);
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
      await gen.syncCompletion(project.id);
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
      await gen.syncCompletion(chapter.project);
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

