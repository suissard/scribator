import type PocketBase from 'pocketbase';
import type { Env } from '../config/env.js';
import { AppError, badRequest, conflict } from '../lib/errors.js';
import { DraftWriter } from '../lib/draftWriter.js';
import { loadPrompt, renderTemplate } from '../lib/prompts.js';
import {
  AiChapterMemorySchema, AiConceptSchema, AiOutlineSchema, AiScenePlanSchema, AiStyleLearningSchema, AiSynopsisSchema,
  StyleMatrixSchema,
  type BiblePatch, type ChapterRecord, type ProjectRecord, type SceneRecord, type StoryBible, type StyleMatrix, type StyleSuggestion,
} from '../types.js';
import { bibleWithIds, toBiblePatch, toStyleSuggestion } from './bible.service.js';
import { buildSampleContext, buildSceneContext, formatBibleWithIds, formatStyleMatrix, type ProjectContext } from './context.service.js';
import type { JobHandle } from './jobs.service.js';
import { isAbortError, type CallContext, type LlmService } from './llm.service.js';
import { chapterText, compressionTarget, chooseMemoryMode, sortChapters, sortScenes, type DiffResult, type PreviousChapter } from './memory.service.js';
import { defaultSceneCount, isLocked, mergeOutline, normalizeScenePlan } from './outline.service.js';
import { countWords, parseReference } from './parser.service.js';
import { archiveVersion } from './versions.service.js';

const SCENE_MAX_TOKENS = 16_000;
const STRUCTURED_MAX_TOKENS = 16_000;
const MIN_REMAINING_WORDS = 200;

const bullets = (items: string[]) => items.map((i) => `- ${i}`).join('\n');
const section = (title: string, body?: string) => (body?.trim() ? `\n\n## ${title}\n\n${body.trim()}` : '');
const clip = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n)}…` : s);

export class GenerationService {
  constructor(
    private readonly pb: PocketBase,
    private readonly env: Env,
    private readonly llm: LlmService,
  ) {}

  /** Le modèle choisi pour ce livre, sinon celui du serveur. */
  private creativeModel(project: ProjectRecord): string {
    const model = project.model_creative || this.env.AI_MODEL_CREATIVE;
    if (!this.llm.catalog.isAvailable(model)) {
      throw conflict(`Le modèle ${model} n'est plus disponible. Choisis-en un autre dans les paramètres du livre.`);
    }
    return model;
  }

  private memoryLimit = (project: ProjectRecord) =>
    this.llm.catalog.memoryLimit(this.creativeModel(project), this.env.MEMORY_FULLTEXT_TOKEN_LIMIT);

  private projects = () => this.pb.collection('projects');
  private chapters = () => this.pb.collection('chapters');
  private scenes = () => this.pb.collection('scenes');

  getProject = (id: string) => this.projects().getOne<ProjectRecord>(id);

  listChapters = async (projectId: string) =>
    sortChapters(
      await this.chapters().getFullList<ChapterRecord>({ filter: this.pb.filter('project = {:p}', { p: projectId }) }),
    );

  listScenes = async (chapterId: string) =>
    sortScenes(await this.scenes().getFullList<SceneRecord>({ filter: this.pb.filter('chapter = {:c}', { c: chapterId }) }));

  async setProjectStatusIf(id: string, from: ProjectRecord['status'], to: ProjectRecord['status']): Promise<void> {
    const p = await this.getProject(id);
    if (p.status === from) await this.projects().update(id, { status: to });
  }

  /* ---------- Étape 1 : analyse (§5.1) ---------- */

  private async downloadReference(project: ProjectRecord): Promise<Buffer> {
    const token = await this.pb.files.getToken();
    const url = this.pb.files.getURL(project as never, project.reference_file, { token });
    const res = await fetch(url);
    if (!res.ok) throw new AppError(502, 'file_download', 'Impossible de relire le fichier de référence.');
    return Buffer.from(await res.arrayBuffer());
  }

  async analyze(job: JobHandle, projectId: string, feedback?: string): Promise<void> {
    const project = await this.getProject(projectId);
    let style = project.style_matrix;
    let meta: unknown = project.reference_meta;
    const language = project.language || 'fr';

    if (project.reference_file) {
      await job.progress(1, 3);
      const parsed = await parseReference(await this.downloadReference(project));
      job.assertNotCancelled();
      await job.progress(2, 3);
      const prompt = loadPrompt('style_extract');
      style = await this.llm.structured({
        ctx: job.ctx,
        purpose: 'style_extract',
        promptVersion: prompt.version,
        model: this.env.AI_MODEL_FAST,
        user: renderTemplate(prompt.text, {
          language,
          segments: parsed.segments.map((s, i) => `## Extrait ${i + 1}\n\n${s}`).join('\n\n'),
        }),
        schema: StyleMatrixSchema,
        maxTokens: STRUCTURED_MAX_TOKENS,
        signal: job.signal,
      });
      meta = {
        filename: project.reference_file,
        word_count: parsed.wordCount,
        language: parsed.language,
        analyzed_at: new Date().toISOString(),
      };
    }
    if (!style) {
      await job.progress(2, 3);
      style = await this.inventStyle(job, project, language);
    }

    job.assertNotCancelled();
    await job.progress(3, 3);
    const prompt = loadPrompt('concept');
    const concept = await this.llm.structured({
      ctx: job.ctx,
      purpose: 'concept',
      promptVersion: prompt.version,
      model: this.creativeModel(project),
      effort: this.env.AI_EFFORT_CREATIVE,
      user: renderTemplate(prompt.text, {
        language,
        genre: project.genre,
        audience: project.audience,
        target_chapter_count: project.target_chapter_count,
        target_words_per_chapter: project.target_words_per_chapter,
        raw_ideas: project.raw_ideas,
        style_matrix: formatStyleMatrix(style),
        feedback: section("Retour de l'auteur sur la version précédente", feedback),
      }),
      schema: AiConceptSchema,
      maxTokens: STRUCTURED_MAX_TOKENS,
      signal: job.signal,
    });

    const archive = async (field: 'style_matrix' | 'story_bible' | 'reformulated_concept', content: unknown) => {
      if (!content) return;
      await archiveVersion(this.pb, {
        project: projectId, target_collection: 'projects', target_id: projectId, field, content, reason: 'before_regenerate',
      });
    };
    await archive('style_matrix', project.style_matrix);
    await archive('story_bible', project.story_bible);
    await archive('reformulated_concept', project.reformulated_concept);

    await this.projects().update(projectId, {
      style_matrix: style,
      story_bible: bibleWithIds(concept.story_bible),
      reformulated_concept: concept.reformulated_concept,
      reference_meta: meta,
      language,
      reference_file: null,
      ...(project.status === 'STEP_1_INPUT' ? { status: 'STEP_2_CONCEPT_REVIEW' } : {}),
    });
  }

  /** Sans ouvrage de référence, le style se déduit des idées de l'auteur, qui peut le corriger à l'étape 2. */
  private inventStyle(job: JobHandle, project: ProjectRecord, language: string) {
    const prompt = loadPrompt('style_invent');
    return this.llm.structured({
      ctx: job.ctx,
      purpose: 'style_extract',
      promptVersion: prompt.version,
      model: this.creativeModel(project),
      effort: this.env.AI_EFFORT_CREATIVE,
      user: renderTemplate(prompt.text, {
        language,
        genre: project.genre,
        audience: project.audience,
        raw_ideas: project.raw_ideas,
      }),
      schema: StyleMatrixSchema,
      maxTokens: STRUCTURED_MAX_TOKENS,
      signal: job.signal,
    });
  }

  /* ---------- Étape 2 : trame (§5.2) ---------- */

  async generateOutline(ctx: CallContext, projectId: string, userFeedback?: string): Promise<void> {
    const project = await this.getProject(projectId);
    const existing = await this.listChapters(projectId);
    const locked = existing.filter(isLocked);
    const replaced = existing.filter((c) => !isLocked(c));
    const missing = Math.max(0, project.target_chapter_count - locked.length);

    let generated: Awaited<ReturnType<typeof this.requestOutline>>['chapters'] = [];
    if (missing > 0) generated = (await this.requestOutline(ctx, project, locked, missing, userFeedback)).chapters;

    const slots = mergeOutline(locked.map((c) => c.id), generated, missing);
    // Les anciens brouillons ne sont supprimés qu'une fois la réponse de l'IA obtenue.
    for (const c of replaced) await this.chapters().delete(c.id);
    let number = 0;
    for (const slot of slots) {
      number++;
      if (slot.kind === 'existing') {
        await this.chapters().update(slot.id, { chapter_number: number });
      } else {
        await this.chapters().create({
          project: projectId,
          chapter_number: number,
          ...slot.chapter,
          target_words: project.target_words_per_chapter,
          user_edited_outline: false,
          status: 'PENDING',
        });
      }
    }
    await this.setProjectStatusIf(projectId, 'STEP_2_CONCEPT_REVIEW', 'STEP_3_OUTLINE_REVIEW');
  }

  private requestOutline(ctx: CallContext, project: ProjectRecord, locked: ChapterRecord[], missing: number, feedback?: string) {
    const prompt = loadPrompt('outline');
    return this.llm.structured({
      ctx,
      purpose: 'outline',
      promptVersion: prompt.version,
      model: this.creativeModel(project),
      effort: this.env.AI_EFFORT_CREATIVE,
      user: renderTemplate(prompt.text, {
        language: project.language,
        genre: project.genre,
        audience: project.audience,
        concept: project.reformulated_concept,
        bible: project.story_bible ? formatBibleWithIds(project.story_bible) : '(vide)',
        locked_chapters: locked.length
          ? locked.map((c) => `- [${c.id}] Chapitre ${c.chapter_number}, ${c.title} : ${c.brief_summary}`).join('\n')
          : '(aucun)',
        missing_count: missing,
        target_chapter_count: project.target_chapter_count,
        feedback: section("Retour de l'auteur", feedback),
      }),
      schema: AiOutlineSchema,
      maxTokens: 20_000, // 60 chapitres + réflexion ; au-delà de ~21 000, le SDK impose le streaming
    });
  }

  /* ---------- Contexte d'écriture ---------- */

  private projectContext(p: ProjectRecord): ProjectContext {
    if (!p.style_matrix || !p.story_bible) throw badRequest("Le style et la Bible doivent être validés d'abord.");
    return {
      language: p.language,
      genre: p.genre,
      audience: p.audience,
      style_matrix: p.style_matrix,
      story_bible: p.story_bible,
      reformulated_concept: p.reformulated_concept,
      archived_synopsis: p.archived_synopsis,
      synopsis_covers_up_to: p.synopsis_covers_up_to,
    };
  }

  private async previousChapters(chapters: ChapterRecord[], beforeNumber: number): Promise<PreviousChapter[]> {
    const previous = chapters.filter((c) => c.chapter_number < beforeNumber);
    if (previous.length === 0) return [];
    const scenes = await this.scenes().getFullList<SceneRecord>({
      filter: this.pb.filter('chapter.project = {:p} && chapter.chapter_number < {:n}', {
        p: previous[0]!.project,
        n: beforeNumber,
      }),
      fields: 'chapter,scene_number,content,scene_break_before',
    });
    return previous.map((c) => ({
      chapter_number: c.chapter_number,
      title: c.title,
      post_writing_summary: c.post_writing_summary,
      text: chapterText(scenes.filter((s) => s.chapter === c.id)),
    }));
  }

  /* ---------- Échantillon (§5.3) ---------- */

  async writeSample(job: JobHandle, projectId: string): Promise<void> {
    const project = await this.getProject(projectId);
    const chapters = await this.listChapters(projectId);
    const first = chapters[0];
    if (!first) throw badRequest("La trame doit contenir au moins un chapitre.");
    const system = loadPrompt('ghostwriter_system');
    const objective = loadPrompt('sample');
    const { system: blocks, user } = buildSampleContext({
      templates: { system: system.text, objective: objective.text },
      project: this.projectContext(project),
      outline: chapters,
      chapter: first,
    });
    const writer = new DraftWriter(
      (text) => this.projects().update(projectId, { sample_draft: text }),
      this.env.DRAFT_TICK_MS,
      (e) => job.ctx.log.warn({ err: e }, "échec d'écriture du tampon"),
    );
    const commit = async (text: string) => {
      if (project.sample_text.trim()) {
        await archiveVersion(this.pb, {
          project: projectId, target_collection: 'projects', target_id: projectId, field: 'sample_text',
          content: project.sample_text, reason: 'before_regenerate',
        });
      }
      await this.projects().update(projectId, {
        sample_text: text,
        sample_ai_original: text,
        sample_draft: '',
        ...(project.status === 'STEP_3_OUTLINE_REVIEW' ? { status: 'STEP_4_SAMPLE_REVIEW' } : {}),
      });
    };
    try {
      const { text } = await this.llm.stream({
        ctx: job.ctx,
        purpose: 'sample',
        promptVersion: objective.version,
        model: this.creativeModel(project),
        effort: this.env.AI_EFFORT_CREATIVE,
        system: blocks,
        user,
        maxTokens: SCENE_MAX_TOKENS,
        signal: job.signal,
        refusalLabel: 'cet échantillon',
        onText: (t) => writer.set(t),
      });
      await writer.stop();
      await commit(text);
    } catch (e) {
      await writer.stop();
      if (isAbortError(e) && job.active.keepPartial && writer.text.length > 0) await commit(writer.text);
      else await this.projects().update(projectId, { sample_draft: '' });
      throw e;
    }
  }

  /* ---------- Plan des scènes (§5.5) ---------- */

  async planScenes(ctx: CallContext, chapter: ChapterRecord, signal?: AbortSignal): Promise<void> {
    const project = await this.getProject(chapter.project);
    const scenes = await this.listScenes(chapter.id);
    const kept = scenes.filter((s) => s.status !== 'PENDING');
    const replaced = scenes.filter((s) => s.status === 'PENDING');
    const writtenWords = kept.reduce((n, s) => n + (s.content ? countWords(s.content) : s.target_words), 0);
    const remaining = chapter.target_words - writtenWords;

    let planned: ReturnType<typeof normalizeScenePlan> = [];
    if (remaining >= MIN_REMAINING_WORDS) {
      const count = defaultSceneCount(remaining);
      const prompt = loadPrompt('scene_plan');
      const plan = await this.llm.structured({
        ctx,
        purpose: 'scene_plan',
        promptVersion: prompt.version,
        model: this.env.AI_MODEL_FAST,
        user: renderTemplate(prompt.text, {
          concept: project.reformulated_concept,
          chapter_number: chapter.chapter_number,
          chapter_title: chapter.title,
          chapter_summary: chapter.brief_summary,
          key_events: bullets(chapter.key_events ?? []),
          existing_scenes: section('Scènes déjà écrites', kept.map((s) => `- ${s.beat}`).join('\n')),
          scene_count: count,
          remaining_words: remaining,
        }),
        schema: AiScenePlanSchema,
        maxTokens: STRUCTURED_MAX_TOKENS,
        ...(signal ? { signal } : {}),
      });
      planned = normalizeScenePlan(plan, count, remaining);
    }
    for (const s of replaced) await this.scenes().delete(s.id);
    let number = kept.reduce((n, s) => Math.max(n, s.scene_number), 0);
    for (const s of planned) {
      await this.scenes().create({ chapter: chapter.id, scene_number: ++number, ...s, status: 'PENDING' });
    }
    if (chapter.status === 'PENDING' || chapter.status === 'ERROR') {
      await this.chapters().update(chapter.id, { status: 'PLANNED' });
    }
  }

  /* ---------- Écriture (§5.6, §5.7) ---------- */

  async writeChapter(job: JobHandle, chapterId: string): Promise<void> {
    const chapter = await this.chapters().getOne<ChapterRecord>(chapterId);
    let scenes = await this.listScenes(chapterId);
    const hasPending = scenes.some((s) => s.status === 'PENDING');
    const writtenWords = scenes.reduce((n, s) => n + countWords(s.content), 0);
    if (!hasPending && writtenWords < chapter.target_words * 0.8) {
      await this.planScenes(job.ctx, chapter, job.signal);
      scenes = await this.listScenes(chapterId);
    }
    const pending = scenes.filter((s) => s.status === 'PENDING');
    for (const [index, scene] of pending.entries()) {
      job.assertNotCancelled();
      await job.progress(index + 1, pending.length);
      await this.generateScene(job, chapter, scene);
    }
  }

  async regenerateScene(job: JobHandle, sceneId: string, instructions?: string): Promise<void> {
    const scene = await this.scenes().getOne<SceneRecord>(sceneId);
    const chapter = await this.chapters().getOne<ChapterRecord>(scene.chapter);
    await job.progress(1, 1);
    await this.generateScene(job, chapter, scene, instructions);
  }

  private async generateScene(job: JobHandle, chapter: ChapterRecord, scene: SceneRecord, instructions?: string): Promise<void> {
    const previousStatus = scene.status;
    const previousContent = scene.content;
    await this.scenes().update(scene.id, { status: 'GENERATING', draft: '' });

    const writer = new DraftWriter(
      (text) => this.scenes().update(scene.id, { draft: text }),
      this.env.DRAFT_TICK_MS,
      (e) => job.ctx.log.warn({ err: e }, "échec d'écriture du tampon"),
    );
    const commit = async (text: string, truncated: boolean) => {
      if (previousContent.trim()) {
        await archiveVersion(this.pb, {
          project: chapter.project, target_collection: 'scenes', target_id: scene.id, field: 'content',
          content: previousContent, reason: 'before_regenerate',
        });
      }
      await this.scenes().update(scene.id, {
        content: text, ai_original_content: text, draft: '', status: 'REVIEW', truncated,
      });
    };
    try {
      const project = await this.getProject(chapter.project);
      const chapters = await this.listChapters(chapter.project);
      const siblings = await this.listScenes(chapter.id);
      const previous = await this.previousChapters(chapters, chapter.chapter_number);
      const system = loadPrompt('ghostwriter_system');
      const objective = loadPrompt('scene_write');
      const context = buildSceneContext({
        templates: { system: system.text, objective: objective.text },
        project: this.projectContext(project),
        sampleText: project.sample_text,
        outline: chapters,
        previousChapters: previous,
        memoryTokenLimit: this.memoryLimit(project),
        chapter,
        writtenScenes: siblings
          .filter((s) => s.scene_number < scene.scene_number && s.content.trim())
          .map((s) => s.content.trim()),
        scene,
        ...(instructions ? { instructions } : {}),
      });
      const { text, truncated } = await this.llm.stream({
        ctx: job.ctx,
        purpose: 'scene_write',
        promptVersion: `${objective.version}:${context.memoryMode}`,
        model: this.creativeModel(project),
        effort: this.env.AI_EFFORT_CREATIVE,
        system: context.system,
        user: context.user,
        maxTokens: SCENE_MAX_TOKENS,
        signal: job.signal,
        refusalLabel: 'cette scène',
        onText: (t) => writer.set(t),
      });
      await writer.stop();
      await commit(text, truncated);
    } catch (e) {
      await writer.stop();
      if (isAbortError(e) && job.active.keepPartial && writer.text.length > 0) await commit(writer.text, false);
      else await this.scenes().update(scene.id, { draft: '', status: previousStatus });
      throw e;
    }
  }

  /* ---------- Mémoire et apprentissage (§5.8) ---------- */

  async chapterMemory(
    ctx: CallContext,
    project: ProjectRecord,
    chapter: ChapterRecord,
    scenes: SceneRecord[],
  ): Promise<{ summary: string; patch: BiblePatch }> {
    const prompt = loadPrompt('chapter_summary');
    const result = await this.llm.structured({
      ctx,
      purpose: 'chapter_summary',
      promptVersion: prompt.version,
      model: this.env.AI_MODEL_FAST,
      user: renderTemplate(prompt.text, {
        language: project.language,
        chapter_number: chapter.chapter_number,
        chapter_title: chapter.title,
        chapter_text: chapterText(scenes),
        bible: formatBibleWithIds(project.story_bible as StoryBible),
      }),
      schema: AiChapterMemorySchema,
      maxTokens: STRUCTURED_MAX_TOKENS,
      refusalLabel: 'de résumer ce chapitre',
    });
    return { summary: result.post_writing_summary, patch: toBiblePatch(result.bible_patch) };
  }

  async styleLearning(ctx: CallContext, style: StyleMatrix, diff: DiffResult): Promise<StyleSuggestion | null> {
    const prompt = loadPrompt('style_learning');
    const pairs = diff.pairs
      .slice(0, 60)
      .map((p) => `- Avant : « ${clip(p.before) || '(rien)'} »\n  Après : « ${clip(p.after) || '(supprimé)'} »`)
      .join('\n');
    const result = await this.llm.structured({
      ctx,
      purpose: 'style_learning',
      promptVersion: prompt.version,
      model: this.env.AI_MODEL_FAST,
      user: renderTemplate(prompt.text, {
        style_matrix: formatStyleMatrix(style),
        changed_percent: Math.round(diff.changedPercent),
        pairs,
      }),
      schema: AiStyleLearningSchema,
      maxTokens: STRUCTURED_MAX_TOKENS,
    });
    return toStyleSuggestion(result, diff.pairs.slice(0, 3));
  }

  async proposeChange(projectId: string, kind: 'BIBLE_PATCH' | 'STYLE_SUGGESTION', payload: unknown, sourceChapter?: string): Promise<void> {
    await this.pb.collection('pending_changes').create({
      project: projectId, kind, payload, status: 'PENDING', source_chapter: sourceChapter ?? '',
    });
  }

  /** Seulement en mode « résumés » (§5.8, étape 4). Repart toujours des résumés, jamais d'un synopsis périmé. */
  async compressMemoryIfNeeded(ctx: CallContext, project: ProjectRecord): Promise<void> {
    const chapters = await this.listChapters(project.id);
    const approved = chapters.filter((c) => c.status === 'APPROVED' || c.status === 'STALE');
    const last = approved.at(-1);
    if (!last) return;
    const previous = await this.previousChapters(chapters, last.chapter_number + 1);
    if (chooseMemoryMode(previous, this.memoryLimit(project)) !== 'summary') return;
    const upTo = compressionTarget(
      approved,
      { text: project.archived_synopsis, coversUpTo: project.synopsis_covers_up_to },
      this.env.SUMMARY_COMPRESS_WORDS,
    );
    if (upTo === null) return;
    const prompt = loadPrompt('synopsis_compress');
    const { synopsis } = await this.llm.structured({
      ctx,
      purpose: 'synopsis_compress',
      promptVersion: prompt.version,
      model: this.env.AI_MODEL_FAST,
      user: renderTemplate(prompt.text, {
        language: project.language,
        covers_up_to: upTo,
        summaries: approved
          .filter((c) => c.chapter_number <= upTo)
          .map((c) => `## Chapitre ${c.chapter_number} : ${c.title}\n\n${c.post_writing_summary}`)
          .join('\n\n'),
      }),
      schema: AiSynopsisSchema,
      maxTokens: STRUCTURED_MAX_TOKENS,
    });
    await this.projects().update(project.id, { archived_synopsis: synopsis, synopsis_covers_up_to: upTo });
  }
}
