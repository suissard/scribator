import { describe, expect, it } from 'vitest';
import { ProgressTracker, type JobProgress } from '../src/services/progress.js';
import { estimateBookTokens, type BookTokenInput, type ChapterWork } from '../src/services/book-estimate.js';
import { buildReport, estimateBookDuration, estimateStages, type CallRow } from '../src/services/stats.service.js';

const call = (over: Partial<CallRow>): CallRow => ({
  purpose: 'scene_write', status: 'OK', duration_ms: 1000, input_tokens: 100, output_tokens: 50,
  cache_read_tokens: 10, cache_write_tokens: 5, cost_usd: 0.01, ...over,
});

describe('estimateStages', () => {
  it('préfère les appels du livre à ceux du serveur', () => {
    const s = estimateStages([call({ duration_ms: 2000 })], [call({ duration_ms: 9000 })]);
    expect(s.write).toMatchObject({ ms: 2000, basis: 'history' });
  });

  it('ignore les appels échoués, qui fausseraient la moyenne', () => {
    const s = estimateStages([call({ duration_ms: 2000 }), call({ duration_ms: 100, status: 'CANCELLED' })], []);
    expect(s.write.ms).toBe(2000);
  });

  it('prend l’échantillon comme référence tant qu’aucune scène n’est écrite', () => {
    const s = estimateStages([call({ purpose: 'sample', duration_ms: 4000 })], []);
    expect(s.write).toMatchObject({ ms: 4000, basis: 'history' });
  });

  it('retombe sur une valeur par défaut sans aucun historique', () => {
    expect(estimateStages([], []).memory.basis).toBe('default');
  });
});

describe('estimateBookDuration', () => {
  it('additionne les maillons de chaque étape', () => {
    const stages = estimateStages(
      [call({ purpose: 'scene_plan', duration_ms: 10 }), call({ duration_ms: 100 }), call({ purpose: 'chapter_summary', duration_ms: 20 })],
      [],
    );
    expect(estimateBookDuration({ chapters: 2, plans: 1, scenes: 4 }, stages)).toMatchObject({ duration_ms: 10 + 400 + 40 });
  });
});

describe('estimateBookTokens', () => {
  const todo = (scenes = 3, words = 1000): ChapterWork => ({ writtenWords: 0, sceneWords: Array(scenes).fill(words), needsPlan: true, approved: false });
  const price = { input: 3e-6, output: 15e-6, cacheRead: 0.3e-6 };
  const input = (over: Partial<BookTokenInput> = {}): BookTokenInput => ({
    contextTokens: 5000, chapters: [todo(), todo(), todo()], memoryLimit: 100_000, creative: price, fast: { input: 1e-6, output: 5e-6 }, reasoning: true, ...over,
  });

  it('déduit la sortie des mots visés', () => {
    const { output_tokens } = estimateBookTokens(input({ chapters: [{ ...todo(2, 1000), needsPlan: false }] }));
    expect(output_tokens).toBe(2 * 1400 + 700);
  });

  it('fait grossir l’entrée avec le texte déjà écrit', () => {
    const one = estimateBookTokens(input({ chapters: [todo()] })).input_tokens;
    expect(estimateBookTokens(input()).input_tokens).toBeGreaterThan(3 * one);
  });

  it('cesse de grossir une fois passé en mode résumés', () => {
    const many = Array.from({ length: 40 }, () => todo());
    const full = estimateBookTokens(input({ chapters: many, memoryLimit: 1_000_000 }));
    const capped = estimateBookTokens(input({ chapters: many, memoryLimit: 10_000 }));
    expect(capped.input_tokens).toBeLessThan(full.input_tokens / 3);
  });

  it('compte les chapitres validés dans la mémoire, sans leur attribuer d’appel', () => {
    const done: ChapterWork = { writtenWords: 3000, sceneWords: [], needsPlan: false, approved: true };
    const alone = estimateBookTokens(input({ chapters: [todo()] }));
    const after = estimateBookTokens(input({ chapters: [done, todo()] }));
    expect(after.output_tokens).toBe(alone.output_tokens);
    expect(after.input_tokens).toBeGreaterThan(alone.input_tokens);
  });

  it('suit le prix du modèle choisi', () => {
    const base = estimateBookTokens(input());
    const dear = estimateBookTokens(input({ creative: { input: 30e-6, output: 150e-6, cacheRead: 3e-6 } }));
    expect(dear.cost_low_usd).toBeGreaterThan(5 * base.cost_low_usd);
  });

  it('donne une vraie fourchette, qui se resserre sans cache ni réflexion', () => {
    const wide = estimateBookTokens(input());
    const narrow = estimateBookTokens(input({ creative: { input: 3e-6, output: 15e-6 }, reasoning: false }));
    expect(wide.cost_high_usd).toBeGreaterThan(wide.cost_low_usd * 1.5);
    expect(narrow.cost_high_usd / narrow.cost_low_usd).toBeLessThan(wide.cost_high_usd / wide.cost_low_usd);
  });

  it('un modèle gratuit ne coûte que les appels du modèle rapide', () => {
    const free = estimateBookTokens(input({ creative: { input: 0, output: 0 }, fast: { input: 0, output: 0 } }));
    expect(free).toMatchObject({ cost_low_usd: 0, cost_high_usd: 0 });
  });
});

describe('buildReport', () => {
  const report = buildReport(
    [call({ cost_usd: 1 }), call({ status: 'CANCELLED', duration_ms: 3000, cost_usd: 1 }), call({ purpose: 'scene_plan', cost_usd: 0.5 })],
    [{ content: 'un deux trois quatre', truncated: true }, { content: 'cinq', truncated: false }],
  );

  it('compte les appels annulés dans les totaux : ils sont facturés', () => {
    expect(report.totals).toMatchObject({ calls: 3, failed_calls: 1, cost_usd: 2.5, duration_ms: 5000, input_tokens: 300, cache_read_tokens: 30 });
  });

  it('calcule la durée moyenne sur les seuls succès', () => {
    expect(report.by_purpose[0]).toMatchObject({ purpose: 'scene_write', calls: 2, avg_duration_ms: 1000 });
  });

  it('rapporte le coût aux mots écrits', () => {
    expect(report).toMatchObject({ words: 5, truncated_scenes: 1, cost_per_1000_words: 500 });
  });

  it('ne divise pas par zéro sur un livre sans texte', () => {
    expect(buildReport([], []).cost_per_1000_words).toBeNull();
  });
});

describe('ProgressTracker', () => {
  const setup = () => {
    let clock = 0;
    const saved: JobProgress[] = [];
    const tracker = new ProgressTracker(async (p) => void saved.push(p), () => clock);
    const estimates = estimateStages([call({ duration_ms: 5000 })], []);
    return { tracker, saved, estimates, tick: (ms: number) => (clock += ms) };
  };

  it('remplace l’historique par la moyenne mesurée', async () => {
    const { tracker, estimates, tick } = setup();
    await tracker.define([{ key: 'write', total: 3 }], estimates);
    expect(tracker.snapshot().stages[0]).toMatchObject({ avg_ms: 5000, basis: 'history' });
    await tracker.step('write', { detail: 'a' }, async () => void tick(1000));
    await tracker.step('write', { detail: 'b' }, async () => void tick(3000));
    expect(tracker.snapshot()).toMatchObject({ current: 2, total: 3, active: null });
    expect(tracker.snapshot().stages[0]).toMatchObject({ avg_ms: 2000, basis: 'run' });
  });

  it('publie le maillon en cours avant de le lancer', async () => {
    const { tracker, saved, estimates } = setup();
    await tracker.define([{ key: 'write', total: 1 }], estimates);
    await tracker.step('write', { detail: 'Scène 1', chapterId: 'c1' }, async () => {
      expect(saved.at(-1)).toMatchObject({ active: 'write', detail: 'Scène 1', chapter_id: 'c1' });
    });
  });

  it('ne compte pas un maillon en échec', async () => {
    const { tracker, estimates } = setup();
    await tracker.define([{ key: 'write', total: 2 }], estimates);
    await expect(tracker.step('write', { detail: 'a' }, () => Promise.reject(new Error('non')))).rejects.toThrow('non');
    expect(tracker.snapshot().stages[0]).toMatchObject({ done: 0, avg_ms: 5000 });
  });

  it('corrige le total sans passer sous ce qui est fait', async () => {
    const { tracker, estimates } = setup();
    await tracker.define([{ key: 'write', total: 2 }], estimates);
    await tracker.step('write', { detail: 'a' }, async () => {});
    await tracker.setTotal('write', 0);
    expect(tracker.snapshot().stages[0]).toMatchObject({ total: 1 });
  });
});
