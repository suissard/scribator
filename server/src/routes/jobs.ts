import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import { conflict } from '../lib/errors.js';
import { authenticate, getOwned } from '../middlewares/auth.js';
import { applyBiblePatch, applyStyleSuggestion } from '../services/bible.service.js';
import { archiveVersion } from '../services/versions.service.js';
import { StoryBibleSchema, StyleMatrixSchema, type JobRecord, type PendingChangeRecord, type SceneRecord, type VersionRecord, type ChapterRecord } from '../types.js';

export function jobRoutes(app: FastifyInstance, deps: Deps): void {
  const { pb, gen, jobs, env, locks } = deps;
  const auth = authenticate(env);
  type I = { Params: { id: string } };

  app.post<I>('/jobs/:id/cancel', { preHandler: auth }, async (req) => {
    const job = await getOwned<JobRecord>(req, 'generation_jobs', req.params.id);
    const { keepPartial } = z.object({ keepPartial: z.boolean().default(false) }).parse(req.body ?? {});
    if (job.status !== 'RUNNING') throw conflict("Cette génération est déjà terminée.");
    await jobs.cancel(job.id, keepPartial);
    return { ok: true };
  });

  app.post<I>('/pending-changes/:id/accept', { preHandler: auth }, async (req) => {
    const owned = await getOwned<PendingChangeRecord>(req, 'pending_changes', req.params.id);
    return locks.withLock(owned.project, async () => {
      const change = await pb.collection('pending_changes').getOne<PendingChangeRecord>(owned.id);
      if (change.status !== 'PENDING') throw conflict('Cette proposition a déjà été traitée.');
      const project = await gen.getProject(change.project);
      const field = change.kind === 'BIBLE_PATCH' ? 'story_bible' : 'style_matrix';
      if (!project[field]) throw conflict("La cible de cette proposition n'existe plus.");
      const next =
        change.kind === 'BIBLE_PATCH'
          ? applyBiblePatch(project.story_bible!, change.payload)
          : applyStyleSuggestion(project.style_matrix!, change.payload);
      await archiveVersion(pb, {
        project: project.id, target_collection: 'projects', target_id: project.id, field,
        content: project[field], reason: 'before_patch',
      });
      await pb.collection('projects').update(project.id, { [field]: next });
      await pb.collection('pending_changes').update(change.id, { status: 'ACCEPTED' });
      return { ok: true };
    });
  });

  app.post<I>('/pending-changes/:id/reject', { preHandler: auth }, async (req) => {
    const change = await getOwned<PendingChangeRecord>(req, 'pending_changes', req.params.id);
    if (change.status !== 'PENDING') throw conflict('Cette proposition a déjà été traitée.');
    await pb.collection('pending_changes').update(change.id, { status: 'REJECTED' });
    return { ok: true };
  });

  app.post<I>('/versions/:id/restore', { preHandler: auth }, async (req) => {
    const version = await getOwned<VersionRecord>(req, 'versions', req.params.id);
    return locks.withLock(version.project, async () => {
      const archive = (content: unknown) =>
        archiveVersion(pb, {
          project: version.project, target_collection: version.target_collection, target_id: version.target_id,
          field: version.field, content, reason: 'before_restore',
        });
      if (version.target_collection === 'scenes') {
        const scene = await pb.collection('scenes').getOne<SceneRecord>(version.target_id);
        const chapter = await pb.collection('chapters').getOne<ChapterRecord>(scene.chapter);
        if (scene.status !== 'REVIEW') throw conflict('Rouvre le chapitre avant de restaurer cette scène.');
        await archive(scene.content);
        await pb.collection('scenes').update(scene.id, { content: version.content });
        return { ok: true, chapter: chapter.id };
      }
      const project = await gen.getProject(version.target_id);
      let value: unknown = version.content;
      if (version.field === 'style_matrix') value = StyleMatrixSchema.parse(JSON.parse(version.content));
      if (version.field === 'story_bible') value = StoryBibleSchema.parse(JSON.parse(version.content));
      await archive(project[version.field as keyof typeof project]);
      await pb.collection('projects').update(project.id, { [version.field]: value });
      return { ok: true };
    });
  });
}
