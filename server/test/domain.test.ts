import { describe, expect, it, vi } from 'vitest';
import { estimateCostUsd, UNKNOWN_MODEL_PRICE } from '../src/config/pricing.js';
import { DraftWriter } from '../src/lib/draftWriter.js';
import { applyBiblePatch, applyStyleSuggestion, bibleWithIds, toBiblePatch, toStyleSuggestion } from '../src/services/bible.service.js';
import { parseJsonOutput, toStrictSchema } from '../src/services/llm.service.js';
import { ModelCatalog } from '../src/services/models.service.js';
import { AiOutlineSchema, AiScenePlanSchema } from '../src/types.js';
import { settledChapterStatus } from '../src/services/jobs.service.js';
import { defaultSceneCount, isLocked, mergeOutline, normalizeScenePlan, reorderPending } from '../src/services/outline.service.js';

const bible = () => bibleWithIds({
  characters: [{ name: 'Ana', role: 'principal', traits: 'vive', current_status: 'libre' }],
  locations: [], world_rules: [], timeline_events: [],
});

describe('bible', () => {
  it('attribue des identifiants stables et préfixés', () => {
    expect(bible().characters[0]!.id).toMatch(/^char_[0-9a-f]{4}$/);
  });
  it('applique add, update et remove sans muter l’original', () => {
    const b = bible();
    const id = b.characters[0]!.id;
    const next = applyBiblePatch(b, {
      operations: [
        { op: 'add', section: 'locations', item: { name: 'Port', description: 'gris' } },
        { op: 'update', section: 'characters', id, fields: { current_status: 'en fuite' } },
      ],
    });
    expect(next.characters[0]!.current_status).toBe('en fuite');
    expect(next.locations[0]!.id).toMatch(/^loc_/);
    expect(b.characters[0]!.current_status).toBe('libre');
    expect(applyBiblePatch(next, { operations: [{ op: 'remove', section: 'characters', id, reason: 'mort' }] }).characters).toEqual([]);
  });
  it('refuse un patch sur un élément disparu ou qui casserait le schéma', () => {
    expect(() => applyBiblePatch(bible(), { operations: [{ op: 'update', section: 'characters', id: 'x', fields: {} }] })).toThrow(/n'existe plus/);
    expect(() => applyBiblePatch(bible(), { operations: [{ op: 'add', section: 'locations', item: { nom: 'x' } }] })).toThrow(/invalide/);
  });
  it('convertit la forme du modèle et regroupe les champs', () => {
    const patch = toBiblePatch({
      add: { characters: [], locations: [], world_rules: [{ rule: 'r' }], timeline_events: [] },
      updates: [{ section: 'characters', id: 'a', field: 'traits', value: 't' }, { section: 'characters', id: 'a', field: 'current_status', value: 's' }],
      removals: [],
    });
    expect(patch.operations).toHaveLength(2);
    expect(patch.operations[1]).toMatchObject({ op: 'update', fields: { traits: 't', current_status: 's' } });
  });
});

describe('suggestions de style', () => {
  const style = {
    tone: 't', pacing: 'p', vocabulary_level: 'v', narrative_pov: 'n', tense: 'te', sentence_structure: 's', dialogue_style: 'd',
    stylistic_rules: ['a'], forbidden_tropes: [], forbidden_phrases: ['x'],
  };
  const ai = (over = {}) => ({
    explanation: 'e',
    changes: { tone: null, pacing: null, vocabulary_level: null, sentence_structure: null, dialogue_style: null, stylistic_rules: [], forbidden_tropes: [], forbidden_phrases: [], ...over },
    evidence: [],
  });
  it('ignore une analyse sans changement', () => {
    expect(toStyleSuggestion(ai(), [])).toBeNull();
  });
  it('complète les preuves depuis le diff et limite à 3', () => {
    const pairs = [1, 2, 3, 4].map((n) => ({ before: `${n}`, after: '' }));
    expect(toStyleSuggestion(ai({ tone: 'x' }), pairs)!.evidence).toHaveLength(3);
  });
  it('ajoute aux listes sans doublon et remplace les textes', () => {
    const next = applyStyleSuggestion(style, { explanation: 'e', changes: { tone: 'nouveau', forbidden_phrases: ['x', 'y'] }, evidence: [] });
    expect(next.tone).toBe('nouveau');
    expect(next.forbidden_phrases).toEqual(['x', 'y']);
  });
});

describe('trame', () => {
  const gen = (title: string, after: string | null) => ({ title, brief_summary: '', key_events: [], after_chapter_id: after });
  it('insère autour des chapitres verrouillés', () => {
    const slots = mergeOutline(['a', 'b'], [gen('début', null), gen('milieu1', 'a'), gen('milieu2', 'a'), gen('fin', 'b')], 4);
    expect(slots.map((s) => (s.kind === 'existing' ? s.id : s.chapter.title))).toEqual(['début', 'a', 'milieu1', 'milieu2', 'b', 'fin']);
  });
  it('conserve à la fin un chapitre à l’ancre inconnue et coupe le surplus', () => {
    const slots = mergeOutline(['a'], [gen('x', 'inconnu'), gen('y', 'a')], 1);
    expect(slots.map((s) => (s.kind === 'existing' ? s.id : s.chapter.title))).toEqual(['a', 'x']);
  });
  it('verrouille tout chapitre retouché ou avancé', () => {
    expect(isLocked({ status: 'PENDING', user_edited_outline: false })).toBe(false);
    expect(isLocked({ status: 'PENDING', user_edited_outline: true })).toBe(true);
    expect(isLocked({ status: 'PLANNED', user_edited_outline: false })).toBe(true);
  });
  it('réordonne uniquement les PENDING', () => {
    const c = (id: string, n: number, status: any) => ({ id, chapter_number: n, status });
    const list = [c('a', 1, 'APPROVED'), c('b', 2, 'PENDING'), c('c', 3, 'PLANNED'), c('d', 4, 'PENDING')];
    expect(reorderPending(list, ['d', 'b'])).toEqual(['a', 'd', 'c', 'b']);
    expect(reorderPending(list, ['a', 'b'])).toBeNull();
    expect(reorderPending(list, ['b'])).toBeNull();
  });
});

describe('scènes', () => {
  it('suit la formule clamp(round(mots / 1100), 1, 8)', () => {
    expect(defaultSceneCount(300)).toBe(1);
    expect(defaultSceneCount(3500)).toBe(3);
    expect(defaultSceneCount(20_000)).toBe(8);
  });
  it('ramène la somme à ±10 % de la cible', () => {
    const plan = { scenes: [100, 100, 200].map((w) => ({ beat: 'b', target_words: w, scene_break_before: false })) };
    const scenes = normalizeScenePlan(plan, 3, 4000);
    const sum = scenes.reduce((n, s) => n + s.target_words, 0);
    expect(Math.abs(sum - 4000)).toBeLessThan(400);
  });
  it('coupe un plan trop long', () => {
    const plan = { scenes: Array.from({ length: 5 }, () => ({ beat: 'b', target_words: 0, scene_break_before: false })) };
    expect(normalizeScenePlan(plan, 2, 1000).map((s) => s.target_words)).toEqual([500, 500]);
  });
  it('déduit le statut du chapitre à la fin du job', () => {
    expect(settledChapterStatus([{ status: 'REVIEW' }, { status: 'PENDING' }], 'failed')).toBe('REVIEW');
    expect(settledChapterStatus([{ status: 'PENDING' }], 'failed')).toBe('ERROR');
    expect(settledChapterStatus([{ status: 'PENDING' }], 'cancelled')).toBe('PLANNED');
  });
});

describe('coût estimé', () => {
  it('multiplie les tokens par le tarif', () => {
    expect(estimateCostUsd({ input: 2e-6, output: 1e-5 }, 1_000_000, 1_000_000)).toBeCloseTo(12);
  });
  it('ne sous-estime pas un modèle inconnu', () => {
    expect(new ModelCatalog().priceOf('inconnu')).toEqual(UNKNOWN_MODEL_PRICE);
  });
});

describe('sorties structurées', () => {
  it('retire les bornes et garde un schéma fermé', () => {
    const schema = toStrictSchema(AiScenePlanSchema);
    const text = JSON.stringify(schema);
    expect(text).not.toMatch(/minimum|maximum|\$schema/);
    expect(schema.additionalProperties).toBe(false);
    expect(text).toContain('target_words');
  });
  it('exprime un champ nullable', () => {
    expect(JSON.stringify(toStrictSchema(AiOutlineSchema))).toContain('"null"');
  });
  it('accepte un JSON entouré d’un bloc de code', () => {
    expect(parseJsonOutput('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonOutput('{"a":1}')).toEqual({ a: 1 });
    expect(() => parseJsonOutput('pas du json')).toThrow();
  });
});

describe('DraftWriter', () => {
  const tick = () => new Promise((r) => setTimeout(r, 15));
  it("n'écrit que si le texte a changé", async () => {
    const write = vi.fn(async () => {});
    const w = new DraftWriter(write, 5);
    await tick();
    expect(write).not.toHaveBeenCalled(); // phase de réflexion
    w.set('a');
    await tick();
    await tick();
    expect(write).toHaveBeenCalledTimes(1);
    await w.stop();
  });
  it('stop attend l’écriture en vol', async () => {
    let done = false;
    const w = new DraftWriter(async () => { await new Promise((r) => setTimeout(r, 30)); done = true; }, 5);
    w.set('a');
    await tick();
    await w.stop();
    expect(done).toBe(true);
  });
  it('survit à une écriture en échec', async () => {
    const onError = vi.fn();
    const w = new DraftWriter(async () => { throw new Error('x'); }, 5, onError);
    w.set('a');
    await tick();
    await w.stop();
    expect(onError).toHaveBeenCalled();
  });
});
