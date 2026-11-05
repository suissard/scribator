import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prompts');

/** Version active de chaque prompt : changer de version ici, jamais écraser un fichier. */
export const PROMPT_VERSIONS = {
  style_extract: 'v1',
  style_invent: 'v1',
  concept: 'v1',
  outline: 'v1',
  sample: 'v1',
  scene_plan: 'v1',
  ghostwriter_system: 'v1',
  scene_write: 'v1',
  chapter_summary: 'v1',
  style_learning: 'v1',
  synopsis_compress: 'v1',
} as const;

export type PromptName = keyof typeof PROMPT_VERSIONS;

const cache = new Map<string, string>();

export function loadPrompt(name: PromptName): { text: string; version: string } {
  const version = `${name}.${PROMPT_VERSIONS[name]}`;
  let text = cache.get(version);
  if (text === undefined) {
    const raw = readFileSync(path.join(dir, `${version}.md`), 'utf8');
    text = raw.replace(/^<!--[\s\S]*?-->\s*/, '').trimEnd();
    cache.set(version, text);
  }
  return { text, version };
}

/** Une seule passe : un `{{x}}` présent dans une valeur injectée (texte d'auteur) n'est pas réinterprété. */
export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in vars)) throw new Error(`Variable de prompt manquante : ${key}`);
    return String(vars[key]);
  });
}
