import { describe, expect, it } from 'vitest';
import { renderTemplate } from '../src/lib/prompts.js';
import { buildSceneContext, formatBible, formatStyleMatrix, type SceneContextInput } from '../src/services/context.service.js';

const style = {
  tone: 'sec', pacing: 'vif', vocabulary_level: 'simple', narrative_pov: 'je', tense: 'présent',
  sentence_structure: 'courte', dialogue_style: 'rare', stylistic_rules: ['r1'], forbidden_tropes: ['t1'], forbidden_phrases: ['p1'],
};
const bible = {
  characters: [{ id: 'char_1', name: 'Ana', role: 'principal' as const, traits: 'vive', current_status: 'libre' }],
  locations: [{ id: 'loc_1', name: 'Port', description: 'gris' }],
  world_rules: [{ id: 'rule_1', rule: 'pas de magie' }],
  timeline_events: [
    { id: 'evt_2', chapter_number: 2, event: 'Fuite' },
    { id: 'evt_1', chapter_number: 1, event: 'Vol' },
  ],
};
const input = (over: Partial<SceneContextInput> = {}): SceneContextInput => ({
  templates: { system: 'SYS {{language}} {{genre}} {{audience}} {{style_matrix}} REF {{sample_text}}', objective: 'OBJ {{chapter_number}} {{chapter_title}} {{chapter_summary}} {{key_events}} {{beat}} {{target_words}}{{instructions}}' },
  project: { language: 'fr', genre: 'noir', audience: 'adulte', style_matrix: style, story_bible: bible, reformulated_concept: 'CONCEPT', archived_synopsis: '', synopsis_covers_up_to: 0 },
  sampleText: 'ECHANTILLON',
  outline: [{ chapter_number: 2, title: 'B', brief_summary: 'sb' }, { chapter_number: 1, title: 'A', brief_summary: 'sa' }],
  previousChapters: [{ chapter_number: 1, title: 'A', post_writing_summary: 'RESUME', text: 'TEXTE_CH1' }],
  memoryTokenLimit: 100_000,
  chapter: { chapter_number: 2, title: 'B', brief_summary: 'sb', key_events: ['e1'] },
  writtenScenes: ['SCENE_1'],
  scene: { beat: 'BEAT', target_words: 900 },
  ...over,
});

describe('buildSceneContext', () => {
  it('respecte l’ordre : système, global, mémoire, puis variable', () => {
    const { system, user } = buildSceneContext(input());
    expect(system).toHaveLength(3);
    expect(system[0]!.text).toContain('ECHANTILLON');
    expect(system[1]!.text).toContain('CONCEPT');
    expect(system[1]!.text).toContain('Ana');
    expect(system[2]!.text).toContain('TEXTE_CH1');
    expect(user.indexOf('SCENE_1')).toBeLessThan(user.indexOf('BEAT'));
  });

  it('pose un point de cache sur chaque bloc stable, sans dépasser 4', () => {
    const { system } = buildSceneContext(input());
    expect(system.every((b) => b.cache_control?.type === 'ephemeral')).toBe(true);
    expect(system.length).toBeLessThanOrEqual(4);
  });

  it('garde les blocs stables identiques entre deux scènes d’un chapitre', () => {
    const a = buildSceneContext(input());
    const b = buildSceneContext(input({
      writtenScenes: ['SCENE_1', 'SCENE_2'], scene: { beat: 'AUTRE', target_words: 500 }, instructions: 'plus sec',
    }));
    expect(JSON.stringify(b.system)).toBe(JSON.stringify(a.system));
    expect(b.user).not.toBe(a.user);
  });

  it('omet le bloc mémoire pour le premier chapitre', () => {
    const { system } = buildSceneContext(input({ previousChapters: [] }));
    expect(system).toHaveLength(2);
    expect(system.every((b) => b.text.length > 0)).toBe(true);
  });

  it('choisit le mode selon la limite', () => {
    expect(buildSceneContext(input()).memoryMode).toBe('full');
    const summary = buildSceneContext(input({ memoryTokenLimit: 1 }));
    expect(summary.memoryMode).toBe('summary');
  });

  it("n'y met ni date ni JSON brut", () => {
    const text = buildSceneContext(input()).system.map((b) => b.text).join('');
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}|"tone"|\{"/);
  });

  it('ajoute les instructions de l’auteur', () => {
    expect(buildSceneContext(input({ instructions: 'Plus de pluie' })).user).toContain('Plus de pluie');
  });
});

describe('formatage déterministe', () => {
  it('ne dépend pas de l’ordre des clés', () => {
    const shuffled = Object.fromEntries(Object.entries(style).reverse()) as typeof style;
    expect(formatStyleMatrix(shuffled)).toBe(formatStyleMatrix(style));
    const reversed = Object.fromEntries(Object.entries(bible).reverse()) as typeof bible;
    expect(formatBible(reversed)).toBe(formatBible(bible));
  });

  it('trie la chronologie', () => {
    const text = formatBible(bible);
    expect(text.indexOf('Vol')).toBeLessThan(text.indexOf('Fuite'));
  });
});

describe('gabarits', () => {
  it('ne réinterprète pas une variable présente dans un texte d’auteur', () => {
    expect(renderTemplate('{{a}} {{b}}', { a: '{{b}}', b: 'x' })).toBe('{{b}} x');
  });
  it('échoue si une variable manque', () => {
    expect(() => renderTemplate('{{a}}', {})).toThrow(/manquante/);
  });
});
