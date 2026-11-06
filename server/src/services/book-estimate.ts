import type { TokenPrice } from '../config/pricing.js';
import { estimateTokens } from './memory.service.js';

/**
 * Estimation du coût d'un livre : d'abord les tokens, déduits des mots visés et du contexte que
 * recevra chaque scène, puis le prix du modèle choisi. La mémoire contient le texte déjà écrit :
 * l'entrée grossit donc à chaque chapitre et pèse souvent plus lourd que la sortie.
 *
 * La fourchette encadre ce qu'on ne sait pas d'avance. Bas : cache toujours touché, pas de réflexion
 * facturée. Haut : aucun cache, réflexion et dépassement de longueur.
 */
export interface ChapterWork {
  /** Mots déjà écrits dans ce chapitre. */
  writtenWords: number;
  /** Mots visés de chaque scène restant à écrire, dans l'ordre. */
  sceneWords: number[];
  needsPlan: boolean;
  /** Validé : plus aucun appel, il ne compte que dans la mémoire des suivants. */
  approved: boolean;
}

export interface BookTokenInput {
  /** Consignes, style, échantillon, trame et Bible : identiques pour toutes les scènes. */
  contextTokens: number;
  chapters: ChapterWork[];
  memoryLimit: number;
  creative: TokenPrice;
  fast: TokenPrice;
  reasoning: boolean;
}

export interface BookTokenEstimate {
  input_tokens: number;
  /** Part de l'entrée que le cache peut servir, si le modèle en a un. */
  cacheable_tokens: number;
  output_tokens: number;
  cost_low_usd: number;
  cost_high_usd: number;
}

const SCENE_PROMPT_TOKENS = 250;
const PLAN_PROMPT_TOKENS = 800;
const PLAN_TOKENS_PER_SCENE = 100;
const SUMMARY_PROMPT_TOKENS = 500;
const SUMMARY_OUTPUT_TOKENS = 700;
/** Résumé d'un chapitre en mémoire, une fois le texte intégral trop long. */
const MEMORY_SUMMARY_TOKENS = 300;

/** Le nombre de tokens par mot varie selon le tokenizer et la langue. */
const TOKEN_MARGIN = { low: 0.9, high: 1.2 };
/** Un modèle dépasse volontiers sa cible, et la réflexion est facturée en sortie sans apparaître. */
const LENGTH_OVERRUN = 1.15;
const REASONING_OVERHEAD = 1.5;

export function estimateBookTokens(input: BookTokenInput): BookTokenEstimate {
  const { creative, fast } = input;
  const read = creative.cacheRead ?? creative.input;
  const total = { input: 0, cacheable: 0, output: 0, fastInput: 0, fastOutput: 0 };
  let bookWords = 0;
  let chaptersBefore = 0;

  for (const chapter of input.chapters) {
    let words = chapter.writtenWords;
    if (!chapter.approved) {
      const fullMemory = estimateTokens(bookWords);
      const memory = fullMemory < input.memoryLimit ? fullMemory : chaptersBefore * MEMORY_SUMMARY_TOKENS;
      const stable = input.contextTokens + memory;
      for (const [index, sceneWords] of chapter.sceneWords.entries()) {
        total.input += stable + estimateTokens(words) + SCENE_PROMPT_TOKENS;
        // La mémoire change à chaque chapitre : sa première scène réécrit le cache, les suivantes le lisent.
        if (index > 0) total.cacheable += stable;
        total.output += estimateTokens(sceneWords);
        words += sceneWords;
      }
      if (chapter.needsPlan) {
        total.fastInput += PLAN_PROMPT_TOKENS;
        total.fastOutput += chapter.sceneWords.length * PLAN_TOKENS_PER_SCENE;
      }
      total.fastInput += estimateTokens(words) + input.contextTokens + SUMMARY_PROMPT_TOKENS;
      total.fastOutput += SUMMARY_OUTPUT_TOKENS;
    }
    bookWords += words;
    chaptersBefore += 1;
  }

  const fastCost = total.fastInput * fast.input + total.fastOutput * fast.output;
  const low = (total.input - total.cacheable) * creative.input + total.cacheable * read + total.output * creative.output + fastCost;
  const high =
    total.input * creative.input +
    total.output * creative.output * LENGTH_OVERRUN * (input.reasoning ? REASONING_OVERHEAD : 1) +
    fastCost;
  return {
    input_tokens: total.input + total.fastInput,
    cacheable_tokens: total.cacheable,
    output_tokens: total.output + total.fastOutput,
    cost_low_usd: low * TOKEN_MARGIN.low,
    cost_high_usd: high * TOKEN_MARGIN.high,
  };
}
