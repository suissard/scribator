import { UNKNOWN_MODEL_PRICE, type TokenPrice } from '../config/pricing.js';

export interface ModelInfo {
  name: string;
  contextLength: number;
  maxOutput: number | null;
  price: TokenPrice;
  structuredOutputs: boolean;
  reasoning: boolean;
  efforts: string[] | null;
}

interface RawModel {
  id: string;
  name?: string;
  context_length?: number | null;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
  top_provider?: { max_completion_tokens?: number | null };
  reasoning?: { supported_efforts?: string[] } | null;
}

interface WarnLogger {
  warn(o: object, m?: string): void;
}

/** Part de la fenêtre de contexte laissée à la mémoire : le reste va à la Bible, à la trame et à la sortie. */
const MEMORY_CONTEXT_SHARE = 0.5;

/**
 * Catalogue public d'OpenRouter : chaque modèle a ses limites. Sans catalogue (panne au démarrage),
 * le serveur fonctionne quand même, et l'API refusera ce qui ne convient pas.
 */
export class ModelCatalog {
  private readonly models = new Map<string, ModelInfo>();

  async load(baseUrl: string, log: WarnLogger): Promise<void> {
    try {
      const res = await fetch(`${baseUrl}/models`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { data } = (await res.json()) as { data: RawModel[] };
      for (const m of data) this.models.set(m.id, toInfo(m));
    } catch (e) {
      log.warn({ err: e }, 'catalogue de modèles indisponible, limites par défaut appliquées');
    }
  }

  get(id: string): ModelInfo | undefined {
    return this.models.get(id);
  }

  /** Sans catalogue, on ne sait pas : c'est alors l'API qui tranchera. */
  isAvailable(id: string): boolean {
    return this.models.size === 0 || this.models.has(id);
  }

  /** Ce qu'un auteur peut choisir : les variantes `:batch` ne servent pas en temps réel. */
  selectable(): Array<{ id: string; name: string; input_per_million: number; output_per_million: number; context_length: number; free: boolean }> {
    return [...this.models]
      .filter(([id, m]) => m.structuredOutputs && !id.endsWith(':batch'))
      .map(([id, m]) => ({
        id,
        name: m.name,
        input_per_million: m.price.input * 1_000_000,
        output_per_million: m.price.output * 1_000_000,
        context_length: m.contextLength,
        free: m.price.input === 0 && m.price.output === 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Une erreur de configuration doit se voir au démarrage, pas au milieu d'un livre. */
  assertUsable(ids: string[]): void {
    if (this.models.size === 0) return;
    for (const id of ids) {
      const model = this.models.get(id);
      if (!model) throw new Error(`Modèle inconnu d'OpenRouter : ${id}`);
      if (!model.structuredOutputs) throw new Error(`Le modèle ${id} ne gère pas les sorties structurées, indispensables ici.`);
    }
  }

  capMaxTokens(id: string, wanted: number): number {
    const max = this.get(id)?.maxOutput;
    return max ? Math.min(wanted, max) : wanted;
  }

  /** L'effort n'est envoyé qu'à un modèle qui l'accepte. */
  effortFor(id: string, effort: string | undefined): string | undefined {
    const model = this.get(id);
    if (!effort || (model && !model.reasoning)) return undefined;
    return !model?.efforts || model.efforts.includes(effort) ? effort : undefined;
  }

  /** Un petit modèle ne peut pas recevoir 100 000 tokens de mémoire. */
  memoryLimit(id: string, configured: number): number {
    const context = this.get(id)?.contextLength;
    return context ? Math.min(configured, Math.floor(context * MEMORY_CONTEXT_SHARE)) : configured;
  }

  priceOf(id: string): TokenPrice {
    return this.get(id)?.price ?? UNKNOWN_MODEL_PRICE;
  }
}

function toInfo(m: RawModel): ModelInfo {
  const params = m.supported_parameters ?? [];
  const input = Number(m.pricing?.prompt);
  const output = Number(m.pricing?.completion);
  return {
    name: m.name ?? m.id,
    contextLength: m.context_length ?? 0,
    maxOutput: m.top_provider?.max_completion_tokens ?? null,
    price: Number.isFinite(input) && Number.isFinite(output) ? { input, output } : UNKNOWN_MODEL_PRICE,
    structuredOutputs: params.includes('structured_outputs'),
    reasoning: params.includes('reasoning'),
    efforts: m.reasoning?.supported_efforts ?? null,
  };
}
