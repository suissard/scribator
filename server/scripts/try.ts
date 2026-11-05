/**
 * Tranche 0 : le pipeline complet en ligne de commande, sans base de données.
 *   npm run try -w server -- --ideas idees.md [--ref livre.pdf] [--out out/essai] [--words 2200] [--edit corrections.md]
 * Sortie : un fichier Markdown par étape, à relire et à comparer au workflow manuel.
 * Les appels partent vers la vraie API : ils sont facturés. Change AI_MODEL_CREATIVE pour comparer des modèles.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadAiEnv } from '../src/config/env.js';
import { loadPrompt, renderTemplate } from '../src/lib/prompts.js';
import { bibleWithIds, toStyleSuggestion } from '../src/services/bible.service.js';
import { buildSampleContext, buildSceneContext, formatBibleWithIds, formatStyleMatrix, type ProjectContext, type TextBlock } from '../src/services/context.service.js';
import { LlmService, type AiCallEntry, type CallContext, type Purpose } from '../src/services/llm.service.js';
import { computeDiff } from '../src/services/memory.service.js';
import { ModelCatalog } from '../src/services/models.service.js';
import { defaultSceneCount, normalizeScenePlan } from '../src/services/outline.service.js';
import { countWords, parseReference } from '../src/services/parser.service.js';
import { AiConceptSchema, AiOutlineSchema, AiScenePlanSchema, AiStyleLearningSchema, StyleMatrixSchema } from '../src/types.js';
import type { z } from 'zod';

const { values } = parseArgs({
  options: {
    ref: { type: 'string' }, ideas: { type: 'string' }, out: { type: 'string', default: 'out/essai' },
    language: { type: 'string', default: 'fr' }, genre: { type: 'string', default: 'roman' }, audience: { type: 'string', default: 'adulte' },
    chapters: { type: 'string', default: '4' }, words: { type: 'string', default: '2200' }, edit: { type: 'string' },
  },
});
if (!values.ideas) {
  console.error('Usage : npm run try -w server -- --ideas idees.md [--ref livre.pdf] [--edit corrections.md]');
  process.exit(1);
}

const env = loadAiEnv();
const quiet = { info() {}, warn: (o: object, m?: string) => console.warn(m, o), error: (o: object, m?: string) => console.error(m, o) };
const catalog = new ModelCatalog();
await catalog.load(env.OPENROUTER_BASE_URL, quiet);
catalog.assertUsable([env.AI_MODEL_CREATIVE, env.AI_MODEL_FAST]);

let total = 0;
const report = async (e: AiCallEntry) => {
  total += e.cost_usd;
  console.log(`  ${e.purpose} [${e.model}] : ${e.status}, ${e.input_tokens} in, ${e.output_tokens} out, cache lu ${e.cache_read_tokens}, ${e.cost_usd.toFixed(4)} $`);
};
const llm = new LlmService(env, catalog, report, async () => {});
const ctx: CallContext = { userId: 'cli', projectId: 'cli', requestId: 'cli', log: quiet };

const out = values.out!;
mkdirSync(out, { recursive: true });
const save = (name: string, text: string) => {
  writeFileSync(path.join(out, name), text);
  console.log(`  -> ${path.join(out, name)}`);
};

const structured = <S extends z.ZodType>(purpose: Purpose, model: string, user: string, schema: S) =>
  llm.structured({ ctx, purpose, promptVersion: purpose, model, user, schema, maxTokens: 16000 });

const write = async (purpose: Purpose, system: TextBlock[], user: string) =>
  (await llm.stream({
    ctx, purpose, promptVersion: purpose, model: env.AI_MODEL_CREATIVE, effort: env.AI_EFFORT_CREATIVE,
    system, user, maxTokens: 16000, onText: () => {},
  })).text;

console.log('1. Style');
const rawIdeas = readFileSync(values.ideas, 'utf8');
const language = values.language!;
let style;
if (values.ref) {
  const parsed = await parseReference(readFileSync(values.ref));
  console.log(`  ${parsed.wordCount} mots, langue ${parsed.language}`);
  style = await structured('style_extract', env.AI_MODEL_FAST, renderTemplate(loadPrompt('style_extract').text, {
    language,
    segments: parsed.segments.map((s, i) => `## Extrait ${i + 1}\n\n${s}`).join('\n\n'),
  }), StyleMatrixSchema);
} else {
  style = await structured('style_extract', env.AI_MODEL_CREATIVE, renderTemplate(loadPrompt('style_invent').text, {
    language, genre: values.genre!, audience: values.audience!, raw_ideas: rawIdeas,
  }), StyleMatrixSchema);
}
save('1-style.md', formatStyleMatrix(style));

console.log('2. Concept et Bible');
const concept = await structured('concept', env.AI_MODEL_CREATIVE, renderTemplate(loadPrompt('concept').text, {
  language: values.language!, genre: values.genre!, audience: values.audience!,
  target_chapter_count: values.chapters!, target_words_per_chapter: values.words!,
  raw_ideas: rawIdeas, style_matrix: formatStyleMatrix(style), feedback: '',
}), AiConceptSchema);
const bible = bibleWithIds(concept.story_bible);
save('2-concept.md', `${concept.reformulated_concept}\n\n# Bible\n\n${formatBibleWithIds(bible)}`);

console.log('3. Trame');
const outline = await structured('outline', env.AI_MODEL_CREATIVE, renderTemplate(loadPrompt('outline').text, {
  language: values.language!, genre: values.genre!, audience: values.audience!, concept: concept.reformulated_concept,
  bible: formatBibleWithIds(bible), locked_chapters: '(aucun)', missing_count: values.chapters!,
  target_chapter_count: values.chapters!, feedback: '',
}), AiOutlineSchema);
const chapters = outline.chapters.map((c, i) => ({ ...c, chapter_number: i + 1 }));
save('3-trame.md', chapters.map((c) => `${c.chapter_number}. **${c.title}** : ${c.brief_summary}`).join('\n'));

const project: ProjectContext = {
  language: values.language!, genre: values.genre!, audience: values.audience!, style_matrix: style, story_bible: bible,
  reformulated_concept: concept.reformulated_concept, archived_synopsis: '', synopsis_covers_up_to: 0,
};
const ghost = loadPrompt('ghostwriter_system').text;

console.log('4. Échantillon');
const first = chapters[0]!;
const sampleCtx = buildSampleContext({
  templates: { system: ghost, objective: loadPrompt('sample').text }, project, outline: chapters, chapter: first,
});
const sample = await write('sample', sampleCtx.system, sampleCtx.user);
save('4-echantillon.md', sample);

console.log('5. Chapitre 1 en scènes');
const target = Number(values.words);
const count = defaultSceneCount(target);
const plan = await structured('scene_plan', env.AI_MODEL_FAST, renderTemplate(loadPrompt('scene_plan').text, {
  concept: concept.reformulated_concept, chapter_number: 1, chapter_title: first.title, chapter_summary: first.brief_summary,
  key_events: first.key_events.map((e) => `- ${e}`).join('\n'), existing_scenes: '', scene_count: count, remaining_words: target,
}), AiScenePlanSchema);
const written: string[] = [];
for (const scene of normalizeScenePlan(plan, count, target)) {
  const context = buildSceneContext({
    templates: { system: ghost, objective: loadPrompt('scene_write').text }, project, sampleText: sample, outline: chapters,
    previousChapters: [], memoryTokenLimit: catalog.memoryLimit(env.AI_MODEL_CREATIVE, 100_000), chapter: first, writtenScenes: written, scene,
  });
  written.push(await write('scene_write', context.system, context.user));
}
const chapter = written.join('\n\n');
console.log(`  chapitre : ${countWords(chapter)} mots pour une cible de ${target}`);
save('5-chapitre-1.md', chapter);

if (values.edit) {
  console.log('6. Diff et suggestion de style');
  const diff = computeDiff(sample, readFileSync(values.edit, 'utf8'));
  console.log(`  ${diff.changedPercent.toFixed(1)} % de mots modifiés`);
  const learned = await structured('style_learning', env.AI_MODEL_FAST, renderTemplate(loadPrompt('style_learning').text, {
    style_matrix: formatStyleMatrix(style), changed_percent: Math.round(diff.changedPercent),
    pairs: diff.pairs.slice(0, 60).map((p) => `- Avant : « ${p.before} »\n  Après : « ${p.after} »`).join('\n'),
  }), AiStyleLearningSchema);
  save('6-suggestion.md', JSON.stringify(toStyleSuggestion(learned, diff.pairs.slice(0, 3)), null, 2));
}
console.log(`Coût total : ${total.toFixed(4)} $`);
