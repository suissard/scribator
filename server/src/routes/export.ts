import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import { badRequest } from '../lib/errors.js';
import { authenticate, getOwned } from '../middlewares/auth.js';
import { assembleBook, safeFilename, toDocx, toEpub, toMarkdown } from '../services/export.service.js';
import type { ProjectRecord, SceneRecord } from '../types.js';

const CONTENT_TYPES = {
  md: 'text/markdown; charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  epub: 'application/epub+zip',
} as const;

export function exportRoutes(app: FastifyInstance, deps: Deps): void {
  const { pb, gen, env } = deps;

  app.get<{ Params: { id: string } }>('/projects/:id/export', { preHandler: authenticate(env) }, async (req, reply) => {
    const project = await getOwned<ProjectRecord>(req, 'projects', req.params.id);
    const { format, aiNotice } = z
      .object({ format: z.enum(['md', 'docx', 'epub']), aiNotice: z.enum(['true', 'false']).default('false') })
      .parse(req.query);
    const chapters = await gen.listChapters(project.id);
    const scenes = await pb.collection('scenes').getFullList<SceneRecord>({
      filter: pb.filter('chapter.project = {:p}', { p: project.id }),
    });
    const byChapter = new Map<string, SceneRecord[]>();
    for (const s of scenes) byChapter.set(s.chapter, [...(byChapter.get(s.chapter) ?? []), s]);
    const book = assembleBook(project.title, project.language, chapters, byChapter, aiNotice === 'true');
    if (book.chapters.length === 0) throw badRequest("Aucun texte à exporter pour l'instant.");
    const payload = format === 'md' ? toMarkdown(book) : format === 'docx' ? await toDocx(book) : await toEpub(book);
    return reply
      .header('content-type', CONTENT_TYPES[format])
      .header('content-disposition', `attachment; filename="${safeFilename(project.title)}.${format}"`)
      .send(payload);
  });
}
