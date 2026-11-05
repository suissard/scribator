import OpenAI from 'openai';
import type { ChatCompletion, ChatCompletionChunk, ChatCompletionCreateParamsNonStreaming, ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions';
import { z } from 'zod';
import type { AiEnv } from '../config/env.js';
import { estimateCostUsd, type TokenUsage } from '../config/pricing.js';
import { AiOutputError, RefusalError } from '../lib/errors.js';
import type { TextBlock } from './context.service.js';
import type { ModelCatalog } from './models.service.js';

export type Purpose =
  | 'style_extract' | 'concept' | 'outline' | 'sample' | 'scene_plan' | 'scene_write'
  | 'chapter_summary' | 'bible_patch' | 'style_learning' | 'synopsis_compress' | 'test';

export interface Logger {
  info(o: object, m?: string): void;
  warn(o: object, m?: string): void;
  error(o: object, m?: string): void;
}

export interface CallContext {
  userId: string;
  projectId?: string;
  jobId?: string;
  requestId: string;
  log: Logger;
}

interface BaseCall {
  ctx: CallContext;
  purpose: Purpose;
  promptVersion: string;
  model: string;
  system?: TextBlock[] | string;
  user: string;
  maxTokens: number;
  effort?: AiEnv['AI_EFFORT_CREATIVE'];
  signal?: AbortSignal;
  refusalLabel?: string;
}

export interface AiCallEntry extends TokenUsage {
  user: string;
  project: string;
  job: string;
  request_id: string;
  purpose: Purpose;
  prompt_version: string;
  model: string;
  cost_usd: number;
  duration_ms: number;
  stop_reason: string;
  status: 'OK' | 'ERROR' | 'CANCELLED' | 'REFUSED';
  error_message: string;
  prompt_snapshot: string;
  response_snapshot: string;
}

/** Champs d'usage propres à OpenRouter, absents des types du SDK. */
interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } | null;
}

interface Outcome {
  status: AiCallEntry['status'];
  model: string;
  usage?: TokenUsage;
  cost?: number;
  stopReason?: string | null;
  error?: string;
  response?: string;
}

const SNAPSHOT_MAX = 20_000;
const CHARS_PER_TOKEN = 3;

export const isAbortError = (e: unknown) =>
  e instanceof OpenAI.APIUserAbortError || (e instanceof Error && e.name === 'AbortError');

/** Un refus arrive de deux façons : réponse 200 filtrée, ou 403 de modération (pas un 403 de budget). */
export function isModerationError(e: unknown): boolean {
  if (!(e instanceof OpenAI.PermissionDeniedError)) return false;
  const body = e.error as { metadata?: { reasons?: unknown }; error?: { metadata?: { reasons?: unknown } } } | undefined;
  return Boolean(body?.metadata?.reasons ?? body?.error?.metadata?.reasons);
}

function usageOf(u: OpenRouterUsage | null | undefined): TokenUsage {
  const read = u?.prompt_tokens_details?.cached_tokens ?? 0;
  const written = u?.prompt_tokens_details?.cache_write_tokens ?? 0;
  return {
    input_tokens: Math.max(0, (u?.prompt_tokens ?? 0) - read - written), // prompt_tokens inclut le cache
    output_tokens: u?.completion_tokens ?? 0,
    cache_read_tokens: read,
    cache_write_tokens: written,
  };
}

/** Schéma JSON pour `response_format`, sans les bornes que génère Zod et que des fournisseurs stricts refusent. */
export function toStrictSchema(schema: z.ZodType): Record<string, unknown> {
  const clean = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(clean);
    if (typeof node !== 'object' || node === null) return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (['$schema', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum'].includes(key)) continue;
      out[key] = clean(value);
    }
    return out;
  };
  return clean(z.toJSONSchema(schema)) as Record<string, unknown>;
}

/** Certains modèles traitent le schéma comme une consigne et entourent le JSON d'un bloc de code. */
export function parseJsonOutput(text: string): unknown {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return JSON.parse(fenced ? fenced[1]! : text);
}

export class LlmService {
  readonly client: OpenAI;

  constructor(
    private readonly env: AiEnv,
    readonly catalog: ModelCatalog,
    private readonly saveCall: (entry: AiCallEntry) => Promise<unknown>,
    private readonly assertBudget: (userId: string) => Promise<void>,
  ) {
    this.client = new OpenAI({
      apiKey: env.OPENROUTER_API_KEY,
      baseURL: env.OPENROUTER_BASE_URL,
      defaultHeaders: { 'X-OpenRouter-Title': 'Scribator' },
    });
  }

  private messages(c: BaseCall) {
    return [...(c.system ? [{ role: 'system', content: c.system }] : []), { role: 'user', content: c.user }];
  }

  private body(c: BaseCall, extraProvider: object = {}) {
    const effort = this.catalog.effortFor(c.model, c.effort);
    return {
      model: c.model,
      max_tokens: this.catalog.capMaxTokens(c.model, c.maxTokens),
      messages: this.messages(c),
      // La réflexion reste côté fournisseur : le brouillon vide déclenche l'indicateur « l'IA réfléchit ».
      ...(effort ? { reasoning: { effort, exclude: true } } : {}),
      provider: { data_collection: this.env.OPENROUTER_DATA_COLLECTION, ...extraProvider },
      // Garde un projet sur le même fournisseur : le cache d'un prompt ne survit pas à un changement.
      ...(c.ctx.projectId ? { session_id: c.ctx.projectId } : {}),
    };
  }

  private async record(c: BaseCall, started: number, r: Outcome): Promise<void> {
    const usage = r.usage ?? { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 };
    const entry: AiCallEntry = {
      user: c.ctx.userId,
      project: c.ctx.projectId ?? '',
      job: c.ctx.jobId ?? '',
      request_id: c.ctx.requestId,
      purpose: c.purpose,
      prompt_version: c.promptVersion,
      model: r.model,
      ...usage,
      cost_usd: r.cost ?? 0,
      duration_ms: Date.now() - started,
      stop_reason: r.stopReason ?? '',
      status: r.status,
      error_message: (r.error ?? '').slice(0, 2000),
      prompt_snapshot: this.env.LOG_PROMPTS ? JSON.stringify({ system: c.system, user: c.user }) : '',
      response_snapshot: (r.response ?? '').slice(0, SNAPSHOT_MAX),
    };
    const { prompt_snapshot: _p, response_snapshot: _r, ...line } = entry;
    if (r.status === 'OK') c.ctx.log.info(line, 'appel IA');
    else c.ctx.log.warn(line, 'appel IA non abouti');
    // Une panne du journal ne doit pas faire perdre un texte déjà payé.
    await this.saveCall(entry).catch((e: unknown) => c.ctx.log.error({ err: e }, "échec d'écriture du journal IA"));
  }

  private costOf(model: string, u: OpenRouterUsage | null | undefined, usage: TokenUsage): number {
    if (typeof u?.cost === 'number') return u.cost;
    return estimateCostUsd(this.catalog.priceOf(model), usage.input_tokens + usage.cache_read_tokens + usage.cache_write_tokens, usage.output_tokens);
  }

  private async fail(c: BaseCall, started: number, e: unknown, partial?: { usage: TokenUsage; cost: number; text: string }): Promise<never> {
    if (isModerationError(e)) {
      await this.record(c, started, { status: 'REFUSED', model: c.model, stopReason: 'moderation' });
      throw new RefusalError(c.refusalLabel);
    }
    const cancelled = isAbortError(e);
    await this.record(c, started, {
      status: cancelled ? 'CANCELLED' : 'ERROR',
      model: c.model,
      ...(partial ? { usage: partial.usage, cost: partial.cost, response: partial.text } : {}),
      error: cancelled ? '' : e instanceof Error ? e.message : String(e),
    });
    throw e;
  }

  /** La fiction aborde des thèmes sombres : un refus, y compris sur un résumé, est retenté sur le modèle de repli. */
  private async withRefusalFallback<T>(c: BaseCall, attempt: (model: string) => Promise<T>, onRetry?: () => void): Promise<T> {
    const fallback = this.env.AI_MODEL_REFUSAL_FALLBACK;
    try {
      return await attempt(c.model);
    } catch (e) {
      const retry = e instanceof RefusalError && fallback && fallback !== c.model;
      if (!retry) throw e;
      c.ctx.log.warn({ purpose: c.purpose, model: c.model, fallback }, 'refus, nouvel essai sur le modèle de repli');
      onRetry?.();
      return attempt(fallback);
    }
  }

  /** Appel à sortie structurée, validée par Zod. */
  structured<S extends z.ZodType>(c: BaseCall & { schema: S }): Promise<z.infer<S>> {
    return this.withRefusalFallback(c, (model) => this.structuredOnce({ ...c, model }));
  }

  private async structuredOnce<S extends z.ZodType>(c: BaseCall & { schema: S }): Promise<z.infer<S>> {
    await this.assertBudget(c.ctx.userId);
    const started = Date.now();
    const request = {
      ...this.body(c, { require_parameters: true }),
      response_format: {
        type: 'json_schema',
        json_schema: { name: c.purpose, strict: true, schema: toStrictSchema(c.schema) },
      },
    };
    let completion: ChatCompletion;
    try {
      completion = await this.client.chat.completions.create(
        request as unknown as ChatCompletionCreateParamsNonStreaming,
        c.signal ? { signal: c.signal } : undefined,
      );
    } catch (e) {
      return this.fail(c, started, e);
    }

    const raw = completion.usage as OpenRouterUsage | undefined;
    const usage = usageOf(raw);
    const outcome = { model: completion.model ?? c.model, usage, cost: this.costOf(c.model, raw, usage) };
    const choice = completion.choices?.[0]; // une erreur en cours de génération peut arriver en 200 sans `choices`
    const finish = choice?.finish_reason ?? null;
    if (finish === 'content_filter' || choice?.message.refusal) {
      await this.record(c, started, { ...outcome, status: 'REFUSED', stopReason: finish });
      throw new RefusalError(c.refusalLabel);
    }
    const text = choice?.message.content ?? '';
    let parsed: z.ZodSafeParseResult<z.infer<S>> | undefined;
    try {
      parsed = c.schema.safeParse(parseJsonOutput(text)) as z.ZodSafeParseResult<z.infer<S>>;
    } catch {
      parsed = undefined;
    }
    if (!parsed?.success || finish === 'length') {
      const error = finish === 'length' ? 'Sortie structurée tronquée' : 'Sortie structurée invalide';
      await this.record(c, started, { ...outcome, status: 'ERROR', stopReason: finish, error, response: text });
      throw new AiOutputError();
    }
    await this.record(c, started, { ...outcome, status: 'OK', stopReason: finish, response: text });
    return parsed.data;
  }

  /** Rédaction en streaming. `onText` reçoit le texte accumulé, remis à zéro si le repli repart de rien. */
  stream(c: BaseCall & { onText: (accumulated: string) => void }): Promise<{ text: string; truncated: boolean }> {
    return this.withRefusalFallback(c, (model) => this.streamOnce({ ...c, model }), () => c.onText(''));
  }

  private async streamOnce(c: BaseCall & { onText: (accumulated: string) => void }): Promise<{ text: string; truncated: boolean }> {
    await this.assertBudget(c.ctx.userId);
    const started = Date.now();
    let accumulated = '';
    let model = c.model;
    let finish: ChatCompletionChunk.Choice['finish_reason'] = null;
    let refused = false;
    let raw: OpenRouterUsage | undefined;
    try {
      const stream = await this.client.chat.completions.create(
        { ...this.body(c), stream: true } as unknown as ChatCompletionCreateParamsStreaming,
        c.signal ? { signal: c.signal } : undefined,
      );
      for await (const chunk of stream) {
        model = chunk.model ?? model;
        if (chunk.usage) raw = chunk.usage as OpenRouterUsage;
        const choice = chunk.choices?.[0];
        finish = choice?.finish_reason ?? finish;
        if (choice?.delta?.refusal) refused = true;
        if (choice?.delta?.content) {
          accumulated += choice.delta.content;
          c.onText(accumulated);
        }
      }
      // Le SDK termine l'itération sans erreur quand la requête est annulée.
      if (c.signal?.aborted) throw new OpenAI.APIUserAbortError();
    } catch (e) {
      // Une annulation reste facturée et n'a pas d'usage : on l'estime pour que le budget n'ait pas de trou.
      const usage = usageOf(undefined);
      usage.input_tokens = Math.ceil(JSON.stringify(this.messages(c)).length / CHARS_PER_TOKEN);
      usage.output_tokens = Math.ceil(accumulated.length / CHARS_PER_TOKEN);
      return this.fail(c, started, e, {
        usage,
        cost: estimateCostUsd(this.catalog.priceOf(model), usage.input_tokens, usage.output_tokens),
        text: accumulated,
      });
    }

    const usage = usageOf(raw);
    const outcome = { model, usage, cost: this.costOf(model, raw, usage), stopReason: finish };
    if (finish === 'content_filter' || refused) {
      await this.record(c, started, { ...outcome, status: 'REFUSED' });
      throw new RefusalError(c.refusalLabel);
    }
    if (!finish || !accumulated.trim()) {
      // Flux coupé sans fin de message, ou budget de sortie consommé par la réflexion.
      await this.record(c, started, { ...outcome, status: 'ERROR', error: 'Réponse vide ou interrompue', response: accumulated });
      throw new AiOutputError();
    }
    const truncated = finish === 'length';
    if (truncated) c.ctx.log.warn({ purpose: c.purpose, model }, 'sortie tronquée par max_tokens');
    await this.record(c, started, { ...outcome, status: 'OK', response: accumulated });
    return { text: accumulated, truncated };
  }
}
