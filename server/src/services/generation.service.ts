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
import { estimateBookTokens, type ChapterWork } from './book-estimate.js';
import { applyBiblePatch, bibleWithIds, toBiblePatch, toStyleSuggestion } from './bible.service.js';
import { buildSampleContext, buildSceneContext, formatBibleWithIds, formatStyleMatrix, type ProjectContext } from './context.service.js';
import { settledChapterStatus, type JobHandle } from './jobs.service.js';
import { isAbortError, type CallContext, type LlmService } from './llm.service.js';
import {
  allApproved, chapterText, compressionTarget, chooseMemoryMode, computeDiff, estimateTokens, sortChapters, sortScenes, STYLE_DIFF_THRESHOLD_PERCENT,
  type DiffResult, type PreviousChapter,
} from './memory.service.js';
import { defaultSceneCount, isLocked, mergeOutline, needsPlanning, needsRewrite, normalizeScenePlan } from './outline.service.js';
import { countWords, parseReference } from './parser.service.js';
import type { StatsService } from './stats.service.js';
import { archiveVersion } from './versions.service.js';

const SCENE_MAX_TOKENS = 16_000;
const STRUCTURED_MAX_TOKENS = 16_000;
const MIN_REMAINING_WORDS = 200;

const bullets = (items: string[]) => items.map((i) => `- ${i}`).join('\n');
const section = (title: string, body?: string) => (body?.trim() ? `\n\n## ${title}\n\n${body.trim()}` : '');
const clip = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n)}…` : s);
const nowIso = () => new Date().toISOString().replace('T', ' ');

interface MemoryOptions {
  signal?: AbortSignal;
  /** En écriture automatique, personne ne relit les propositions : la Bible doit suivre pour les chapitres suivants. */
  applyBible?: boolean;
}

const remainingWords = (chapter: ChapterRecord, kept: Array<Pick<SceneRecord, 'content' | 'target_words'>>) =>
  chapter.target_words - kept.reduce((n, s) => n + (s.content ? countWords(s.content) : (s.target_words ?? 0)), 0);

/** Nombre de scènes que le plan va créer : le modèle en reçoit la consigne exacte. */
function expectedScenes(chapter: ChapterRecord, scenes: SceneRecord[]): number {
  const remaining = remainingWords(chapter, scenes.filter((s) => s.status !== 'PENDING'));
  return remaining >= MIN_REMAINING_WORDS ? defaultSceneCount(remaining) : 0;
}

export class GenerationService {
  constructor(
    private readonly pb: PocketBase,
    private readonly env: Env,
    private readonly llm: LlmService,
    private readonly stats: StatsService,
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
    await job.stages(
      [
        ...(project.reference_file ? [{ key: 'read' as const, total: 1 }] : []),
        ...(project.reference_file || !style ? [{ key: 'style' as const, total: 1 }] : []),
        { key: 'concept', total: 1 },
      ],
      await this.stats.stageEstimates(projectId),
    );

    if (project.reference_file) {
      const parsed = await job.step('read', { detail: "Lecture de l'ouvrage" }, async () => parseReference(await this.downloadReference(project)));
      job.assertNotCancelled();
      const prompt = loadPrompt('style_extract');
      style = await job.step('style', { detail: 'Analyse du style' }, () =>
        this.llm.structured({
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
        }),
      );
      meta = {
        filename: project.reference_file,
        word_count: parsed.wordCount,
        language: parsed.language,
        analyzed_at: new Date().toISOString(),
      };
    }
    if (!style) style = await job.step('style', { detail: 'Choix du style' }, () => this.inventStyle(job, project, language));
    const matrix = style;

    job.assertNotCancelled();
    const prompt = loadPrompt('concept');
    const concept = await job.step('concept', { detail: 'Concept et Bible' }, () =>
      this.llm.structured({
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
          style_matrix: formatStyleMatrix(matrix),
          feedback: section("Retour de l'auteur sur la version précédente", feedback),
        }),
        schema: AiConceptSchema,
        maxTokens: STRUCTURED_MAX_TOKENS,
        signal: job.signal,
      }),
    );

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
    await job.stages([{ key: 'sample', total: 1 }], await this.stats.stageEstimates(projectId));
    try {
      const { text } = await job.step('sample', { detail: "Scène d'ouverture" }, () =>
        this.llm.stream({
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
        }),
      );
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
    const planned = await this.requestScenePlan(ctx, project, chapter, kept, signal);
    for (const s of replaced) await this.dropScene(chapter, s);
    let number = kept.reduce((n, s) => Math.max(n, s.scene_number), 0);
    for (const s of planned) {
      await this.scenes().create({ chapter: chapter.id, scene_number: ++number, ...s, status: 'PENDING' });
    }
    if (chapter.status === 'PENDING' || chapter.status === 'ERROR') {
      await this.chapters().update(chapter.id, { status: 'PLANNED' });
    }
  }

  private async requestScenePlan(ctx: CallContext, project: ProjectRecord, chapter: ChapterRecord, kept: SceneRecord[], signal?: AbortSignal) {
    const remaining = remainingWords(chapter, kept);
    if (remaining < MIN_REMAINING_WORDS) return [];
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
    return normalizeScenePlan(plan, count, remaining);
  }

  /** Une réécriture interrompue laisse des scènes à écrire qui portent encore l'ancien texte. */
  private async dropScene(chapter: ChapterRecord, scene: SceneRecord): Promise<void> {
    if (scene.content.trim()) {
      await archiveVersion(this.pb, {
        project: chapter.project, target_collection: 'scenes', target_id: scene.id, field: 'content',
        content: scene.content, reason: 'before_regenerate',
      });
    }
    await this.scenes().delete(scene.id);
  }

  /* ---------- Écriture (§5.6, §5.7) ---------- */

  async writeChapter(job: JobHandle, chapterId: string): Promise<void> {
    const chapter = await this.chapters().getOne<ChapterRecord>(chapterId);
    let scenes = await this.listScenes(chapterId);
    const planning = needsPlanning(chapter, scenes);
    await job.stages(
      [
        ...(planning ? [{ key: 'plan' as const, total: 1 }] : []),
        { key: 'write', total: planning ? expectedScenes(chapter, scenes) : scenes.filter((s) => s.status === 'PENDING').length },
      ],
      await this.stats.stageEstimates(chapter.project),
    );
    if (planning) {
      await job.step('plan', { detail: 'Plan des scènes' }, () => this.planScenes(job.ctx, chapter, job.signal));
      scenes = await this.listScenes(chapterId);
    }
    await this.writePendingScenes(job, chapter, scenes);
  }

  private async writePendingScenes(job: JobHandle, chapter: ChapterRecord, scenes: SceneRecord[]): Promise<void> {
    const pending = scenes.filter((s) => s.status === 'PENDING');
    await job.setStageTotal('write', pending.length);
    for (const [index, scene] of pending.entries()) {
      job.assertNotCancelled();
      await job.step('write', { detail: `Scène ${index + 1} sur ${pending.length}`, chapterId: chapter.id }, () => this.generateScene(job, chapter, scene));
    }
  }

  /**
   * Remet tout le chapitre à écrire sur un nouveau plan. Si le plan échoue, rien ne change. Ensuite,
   * chaque scène garde son ancien texte jusqu'à son remplacement, qui l'archive dans son historique.
   */
  private async replanChapter(ctx: CallContext, chapter: ChapterRecord, signal: AbortSignal): Promise<void> {
    const project = await this.getProject(chapter.project);
    const scenes = await this.listScenes(chapter.id);
    const planned = await this.requestScenePlan(ctx, project, chapter, [], signal);
    if (planned.length === 0) throw conflict('Ce chapitre vise trop peu de mots pour être replanifié.');
    for (const [index, plan] of planned.entries()) {
      const data = { ...plan, scene_number: index + 1, status: 'PENDING', truncated: false };
      const old = scenes[index];
      if (old) await this.scenes().update(old.id, data);
      else await this.scenes().create({ chapter: chapter.id, ...data });
    }
    for (const extra of scenes.slice(planned.length)) await this.dropScene(chapter, extra);
  }

  async rewriteChapter(job: JobHandle, chapterId: string): Promise<void> {
    const chapter = await this.chapters().getOne<ChapterRecord>(chapterId);
    await job.stages(
      [{ key: 'plan', total: 1 }, { key: 'write', total: defaultSceneCount(chapter.target_words) }],
      await this.stats.stageEstimates(chapter.project),
    );
    await job.step('plan', { detail: 'Nouveau plan des scènes' }, () => this.replanChapter(job.ctx, chapter, job.signal));
    await this.writePendingScenes(job, chapter, await this.listScenes(chapterId));
  }

  async regenerateScene(job: JobHandle, sceneId: string, instructions?: string): Promise<void> {
    const scene = await this.scenes().getOne<SceneRecord>(sceneId);
    const chapter = await this.chapters().getOne<ChapterRecord>(scene.chapter);
    await job.stages([{ key: 'write', total: 1 }], await this.stats.stageEstimates(chapter.project));
    await job.step('write', { detail: `Scène ${scene.scene_number}`, chapterId: chapter.id }, () => this.generateScene(job, chapter, scene, instructions));
  }

  /* ---------- Écriture automatique du livre ---------- */

  /** Ce qu'il reste à faire. Sert à la fois à estimer et à écrire : les deux ne peuvent pas diverger. */
  async bookWork(projectId: string) {
    const chapters = await this.listChapters(projectId);
    const scenes = await this.scenes().getFullList<SceneRecord>({
      filter: this.pb.filter('chapter.project = {:p}', { p: projectId }),
      fields: 'chapter,status,content,target_words',
    });
    const todo = chapters.filter((c) => c.status !== 'APPROVED');
    const toPlan: ChapterRecord[] = [];
    const toRewrite: ChapterRecord[] = [];
    const perChapter: ChapterWork[] = [];
    for (const chapter of chapters) {
      const own = scenes.filter((s) => s.chapter === chapter.id);
      const active = chapter.status !== 'APPROVED';
      if (needsRewrite(chapter, own)) {
        toRewrite.push(chapter);
        const count = defaultSceneCount(chapter.target_words);
        perChapter.push({ writtenWords: 0, sceneWords: Array<number>(count).fill(chapter.target_words / count), needsPlan: true, approved: false });
        continue;
      }
      const needsPlan = active && needsPlanning(chapter, own);
      const planned = needsPlan ? expectedScenes(chapter, own) : 0;
      if (needsPlan) toPlan.push(chapter);
      perChapter.push({
        writtenWords: own.reduce((n, s) => n + countWords(s.content), 0),
        sceneWords: active
          ? [
              ...own.filter((s) => s.status === 'PENDING').map((s) => s.target_words),
              ...Array<number>(planned).fill(remainingWords(chapter, own.filter((s) => s.status !== 'PENDING')) / Math.max(planned, 1)),
            ]
          : [],
        needsPlan,
        approved: chapter.status === 'APPROVED',
      });
    }
    return { total: chapters.length, todo, toPlan, toRewrite, sceneCount: perChapter.reduce((n, c) => n + c.sceneWords.length, 0), perChapter };
  }

  /** Tokens et prix, pour le modèle choisi sur ce livre. Le contexte est le vrai, construit comme pour une scène. */
  estimateBookCost(project: ProjectRecord, chapters: ChapterRecord[], work: ChapterWork[]) {
    const model = project.model_creative || this.env.AI_MODEL_CREATIVE;
    const { system, user } = buildSceneContext({
      templates: { system: loadPrompt('ghostwriter_system').text, objective: loadPrompt('scene_write').text },
      project: this.projectContext(project),
      sampleText: project.sample_text,
      outline: chapters,
      previousChapters: [],
      memoryTokenLimit: this.env.MEMORY_FULLTEXT_TOKEN_LIMIT,
      chapter: chapters[0]!,
      writtenScenes: [],
      scene: { beat: '', target_words: 0 },
    });
    return {
      model,
      ...estimateBookTokens({
        contextTokens: estimateTokens(countWords([...system.map((b) => b.text), user].join('\n'))),
        chapters: work,
        memoryLimit: this.llm.catalog.memoryLimit(model, this.env.MEMORY_FULLTEXT_TOKEN_LIMIT),
        creative: this.llm.catalog.priceOf(model),
        fast: this.llm.catalog.priceOf(this.env.AI_MODEL_FAST),
        reasoning: Boolean(this.llm.catalog.effortFor(model, this.env.AI_EFFORT_CREATIVE)),
      }),
    };
  }

  /**
   * Les plans passent d'abord : ils ne dépendent pas des chapitres précédents et donnent le nombre
   * exact de scènes. L'écriture reprend là où elle s'est arrêtée : relancer un livre interrompu suffit.
   * Un chapitre entièrement écrit mais non validé est à refaire. Son plan attend son tour : un arrêt
   * en cours de route laisse ainsi intacts les chapitres suivants.
   */
  async writeBook(job: JobHandle, projectId: string): Promise<void> {
    const { total, todo, toPlan, toRewrite, sceneCount } = await this.bookWork(projectId);
    const rewrites = new Set(toRewrite.map((c) => c.id));
    await job.stages(
      [
        { key: 'plan', total: toPlan.length + toRewrite.length },
        { key: 'write', total: sceneCount },
        { key: 'memory', total: todo.length },
      ],
      await this.stats.stageEstimates(projectId),
    );
    for (const chapter of toPlan) {
      job.assertNotCancelled();
      await job.step('plan', { detail: `Plan du chapitre ${chapter.chapter_number}` }, () => this.planScenes(job.ctx, chapter, job.signal));
    }
    await job.setStageTotal('write', (await this.bookWork(projectId)).sceneCount);

    for (const { id } of todo) {
      job.assertNotCancelled();
      const chapter = await this.chapters().getOne<ChapterRecord>(id);
      const label = `Chapitre ${chapter.chapter_number} sur ${total}`;
      const memory = { signal: job.signal, applyBible: true };
      if (rewrites.has(id)) {
        await job.step('plan', { detail: `Nouveau plan du chapitre ${chapter.chapter_number}` }, () => this.replanChapter(job.ctx, chapter, job.signal));
      }
      await this.chapters().update(id, { status: 'GENERATING' });
      const pending = (await this.listScenes(id)).filter((s) => s.status === 'PENDING');
      for (const [index, scene] of pending.entries()) {
        job.assertNotCancelled();
        await job.step('write', { detail: `${label}, scène ${index + 1} sur ${pending.length}`, chapterId: id }, () => this.generateScene(job, chapter, scene));
      }
      await this.chapters().update(id, { status: settledChapterStatus(await this.listScenes(id), 'done') });
      job.assertNotCancelled();
      await job.step('memory', { detail: `${label}, résumé` }, () => this.approveChapter(job.ctx, id, memory));
    }
  }

  /** Fin d'un job de livre : le chapitre en cours ne doit pas rester en écriture. */
  async settleChapters(projectId: string, outcome: 'DONE' | 'CANCELLED' | 'FAILED'): Promise<void> {
    const map = { DONE: 'done', CANCELLED: 'cancelled', FAILED: 'failed' } as const;
    for (const chapter of await this.listChapters(projectId)) {
      if (chapter.status !== 'GENERATING') continue;
      await this.chapters().update(chapter.id, { status: settledChapterStatus(await this.listScenes(chapter.id), map[outcome]) });
    }
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
    signal?: AbortSignal,
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
      ...(signal ? { signal } : {}),
    });
    return { summary: result.post_writing_summary, patch: toBiblePatch(result.bible_patch) };
  }

  /** Le verrou du projet est à la charge de l'appelant : la route, ou le job qui le détient déjà. */
  async approveChapter(ctx: CallContext, chapterId: string, options: MemoryOptions = {}): Promise<{ changedPercent: number }> {
    const chapter = await this.chapters().getOne<ChapterRecord>(chapterId);
    if (chapter.status !== 'REVIEW') throw conflict("Ce chapitre n'est pas en relecture.");
    const scenes = await this.listScenes(chapter.id);
    if (scenes.length === 0 || scenes.some((s) => s.status !== 'REVIEW')) {
      throw conflict('Toutes les scènes doivent être écrites et en relecture.');
    }
    const project = await this.getProject(chapter.project);
    const original = scenes.map((s) => ({ ...s, content: s.ai_original_content }));
    const diff = computeDiff(chapterText(original), chapterText(scenes));

    // Les appels IA passent avant tout changement d'état : en cas d'échec, l'auteur peut réessayer
    // sans laisser un chapitre validé sans résumé. L'apprentissage du style, lui, est facultatif.
    const [memory, suggestion] = await Promise.all([
      this.chapterMemory(ctx, project, chapter, scenes, options.signal),
      diff.changedPercent > STYLE_DIFF_THRESHOLD_PERCENT && project.style_matrix
        ? this.styleLearning(ctx, project.style_matrix, diff).catch((e: unknown) => {
            ctx.log.warn({ err: e }, "échec de l'apprentissage du style, validation maintenue");
            return null;
          })
        : Promise.resolve(null),
    ]);

    for (const s of scenes) await this.scenes().update(s.id, { status: 'APPROVED' });
    await this.chapters().update(chapter.id, {
      status: 'APPROVED',
      approved_at: nowIso(),
      post_writing_summary: memory.summary,
      stale_reason: '',
    });
    await this.handleBiblePatch(ctx, project, memory.patch, chapter.id, options);
    if (suggestion) await this.proposeChange(project.id, 'STYLE_SUGGESTION', suggestion, chapter.id);

    await this.compressMemoryIfNeeded(ctx, await this.getProject(project.id)).catch((e: unknown) => {
      ctx.log.warn({ err: e }, 'échec de la compression mémoire, réessai à la prochaine validation');
    });
    await this.syncCompletion(project.id);
    return { changedPercent: diff.changedPercent };
  }

  async refreshChapterMemory(ctx: CallContext, chapterId: string, options: MemoryOptions = {}): Promise<void> {
    const chapter = await this.chapters().getOne<ChapterRecord>(chapterId);
    if (chapter.status !== 'STALE') throw conflict("Ce chapitre n'est pas à recalculer.");
    const project = await this.getProject(chapter.project);
    const { summary, patch } = await this.chapterMemory(ctx, project, chapter, await this.listScenes(chapter.id), options.signal);
    await this.chapters().update(chapter.id, { status: 'APPROVED', post_writing_summary: summary, stale_reason: '' });
    await this.handleBiblePatch(ctx, project, patch, chapter.id, options);
    await this.syncCompletion(project.id);
  }

  /** Un patch inapplicable, par exemple un identifiant inventé, reste une proposition à relire. */
  private async handleBiblePatch(ctx: CallContext, project: ProjectRecord, patch: BiblePatch, chapterId: string, options: MemoryOptions): Promise<void> {
    if (patch.operations.length === 0) return;
    if (options.applyBible && project.story_bible) {
      try {
        const story_bible = applyBiblePatch(project.story_bible, patch);
        await archiveVersion(this.pb, {
          project: project.id, target_collection: 'projects', target_id: project.id, field: 'story_bible',
          content: project.story_bible, reason: 'before_patch',
        });
        await this.projects().update(project.id, { story_bible });
        return;
      } catch (e) {
        ctx.log.warn({ err: e, chapter: chapterId }, 'patch de Bible inapplicable, laissé en proposition');
      }
    }
    await this.proposeChange(project.id, 'BIBLE_PATCH', patch, chapterId);
  }

  /** §4.2 : statut final du projet, recalculé après tout changement de la liste des chapitres. */
  async syncCompletion(projectId: string): Promise<void> {
    const project = await this.getProject(projectId);
    const chapters = await this.listChapters(projectId);
    if (project.status === 'STEP_5_WRITING' && allApproved(chapters)) {
      await this.projects().update(projectId, { status: 'COMPLETED' });
    } else if (project.status === 'COMPLETED' && !allApproved(chapters)) {
      await this.projects().update(projectId, { status: 'STEP_5_WRITING' });
    }
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
