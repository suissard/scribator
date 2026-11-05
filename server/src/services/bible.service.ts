import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { conflict } from '../lib/errors.js';
import {
  BiblePatchSchema, StoryBibleSchema, StyleSuggestionSchema,
  type AiBiblePatch, type AiStyleLearning, type BiblePatch, type BibleSection, type StoryBible, type StyleMatrix, type StyleSuggestion,
} from '../types.js';

const PREFIX: Record<BibleSection, string> = {
  characters: 'char',
  locations: 'loc',
  world_rules: 'rule',
  timeline_events: 'evt',
};

export const newEntityId = (section: BibleSection) => `${PREFIX[section]}_${randomBytes(2).toString('hex')}`;

type AiBible = AiBiblePatch['add'];

export function bibleWithIds(ai: AiBible): StoryBible {
  const withId = <T extends object>(section: BibleSection, items: T[]) =>
    items.map((item) => ({ id: newEntityId(section), ...item }));
  return StoryBibleSchema.parse({
    characters: withId('characters', ai.characters),
    locations: withId('locations', ai.locations),
    world_rules: withId('world_rules', ai.world_rules),
    timeline_events: withId('timeline_events', ai.timeline_events),
  });
}

export function toBiblePatch(ai: AiBiblePatch): BiblePatch {
  const operations: BiblePatch['operations'] = [];
  for (const section of Object.keys(PREFIX) as BibleSection[]) {
    for (const item of ai.add[section]) operations.push({ op: 'add', section, item: { ...item } });
  }
  const grouped = new Map<string, { section: BibleSection; id: string; fields: Record<string, string> }>();
  for (const u of ai.updates) {
    const key = `${u.section}/${u.id}`;
    const entry = grouped.get(key) ?? { section: u.section, id: u.id, fields: {} };
    entry.fields[u.field] = u.value;
    grouped.set(key, entry);
  }
  for (const u of grouped.values()) operations.push({ op: 'update', ...u });
  for (const r of ai.removals) operations.push({ op: 'remove', ...r });
  return { operations };
}

/** Applique un patch sans muter la bible d'origine. Le résultat est revalidé par Zod. */
export function applyBiblePatch(bible: StoryBible, rawPatch: unknown): StoryBible {
  const patch = BiblePatchSchema.parse(rawPatch);
  const next = structuredClone(bible) as Record<BibleSection, Array<Record<string, unknown>>>;
  for (const op of patch.operations) {
    const list = next[op.section];
    if (op.op === 'add') {
      list.push({ ...op.item, id: newEntityId(op.section) });
      continue;
    }
    const index = list.findIndex((e) => e.id === op.id);
    if (index === -1) {
      throw conflict(`Cette proposition vise un élément qui n'existe plus dans la Bible (${op.id}).`);
    }
    if (op.op === 'update') {
      const { id: _ignored, ...fields } = op.fields;
      list[index] = { ...list[index], ...fields };
    } else {
      list.splice(index, 1);
    }
  }
  const result = StoryBibleSchema.safeParse(next);
  if (!result.success) throw conflict('Cette proposition produirait une Bible invalide.');
  return result.data;
}

export function toStyleSuggestion(
  ai: AiStyleLearning,
  fallbackEvidence: Array<{ before: string; after: string }>,
): StyleSuggestion | null {
  const changes: StyleSuggestion['changes'] = {};
  for (const key of ['tone', 'pacing', 'vocabulary_level', 'sentence_structure', 'dialogue_style'] as const) {
    const value = ai.changes[key];
    if (value) changes[key] = value;
  }
  for (const key of ['stylistic_rules', 'forbidden_tropes', 'forbidden_phrases'] as const) {
    if (ai.changes[key].length) changes[key] = ai.changes[key];
  }
  if (Object.keys(changes).length === 0) return null;
  const evidence = (ai.evidence.length ? ai.evidence : fallbackEvidence).slice(0, 3);
  return { explanation: ai.explanation, changes, evidence };
}

export function applyStyleSuggestion(style: StyleMatrix, rawSuggestion: unknown): StyleMatrix {
  const { changes } = StyleSuggestionSchema.parse(rawSuggestion);
  const next: StyleMatrix = { ...style };
  for (const key of ['tone', 'pacing', 'vocabulary_level', 'narrative_pov', 'tense', 'sentence_structure', 'dialogue_style'] as const) {
    const value = changes[key];
    if (value) next[key] = value;
  }
  for (const key of ['stylistic_rules', 'forbidden_tropes', 'forbidden_phrases'] as const) {
    const values = changes[key];
    if (values) next[key] = [...new Set([...style[key], ...values])];
  }
  return next;
}

export const PartialStyleSchema: z.ZodType<Partial<StyleMatrix>> = z
  .object({
    tone: z.string(), pacing: z.string(), vocabulary_level: z.string(), narrative_pov: z.string(),
    tense: z.string(), sentence_structure: z.string(), dialogue_style: z.string(),
    stylistic_rules: z.array(z.string()), forbidden_tropes: z.array(z.string()), forbidden_phrases: z.array(z.string()),
  })
  .partial()
  .strict();
