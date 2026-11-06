import type PocketBase from 'pocketbase';
import type { Logger, Purpose } from './llm.service.js';
import { countWords } from './parser.service.js';
import type { EstimateBasis, StageEstimates, StageKey } from './progress.js';

/** `ai_calls` reste la seule source : ces chiffres en sont des agrégats, jamais des compteurs à part. */
export interface CallRow {
  purpose: Purpose;
  status: 'OK' | 'ERROR' | 'CANCELLED' | 'REFUSED';
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number;
}

export interface UsageTotals {
  calls: number;
  failed_calls: number;
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number;
}

export interface PurposeUsage extends UsageTotals {
  purpose: Purpose;
  avg_duration_ms: number;
}

export interface GenerationReport {
  totals: UsageTotals;
  by_purpose: PurposeUsage[];
  words: number;
  truncated_scenes: number;
  cost_per_1000_words: number | null;
}

export interface BookWork {
  chapters: number;
  plans: number;
  scenes: number;
}

export interface BookDuration extends BookWork {
  duration_ms: number;
  basis: EstimateBasis;
}

const CALL_FIELDS = 'purpose,status,duration_ms,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,cost_usd';
const RECENT_CALLS = 20;
const SERVER_HISTORY = 500;

/** Une scène et l'échantillon ont la même taille : chacun sert d'historique à l'autre. */
const STAGE_PURPOSES: Record<StageKey, Purpose[]> = {
  read: [],
  style: ['style_extract'],
  concept: ['concept'],
  sample: ['sample', 'scene_write'],
  plan: ['scene_plan'],
  write: ['scene_write', 'sample'],
  memory: ['chapter_summary'],
};

/** Ordres de grandeur pour un serveur sans aucun historique : le premier maillon mesuré les remplace. */
const DEFAULT_STAGE_MS: Record<StageKey, number> = {
  read: 3_000, style: 45_000, concept: 60_000, sample: 90_000, plan: 15_000, write: 90_000, memory: 30_000,
};

const mean = (values: number[]) => values.reduce((n, v) => n + v, 0) / values.length;

function meanOf(calls: CallRow[], purposes: Purpose[]) {
  for (const purpose of purposes) {
    const rows = calls.filter((c) => c.purpose === purpose && c.status === 'OK').slice(0, RECENT_CALLS);
    if (rows.length) return Math.round(mean(rows.map((r) => r.duration_ms)));
  }
  return null;
}

/** Les deux listes vont du plus récent au plus ancien. Le livre en cours prime sur le reste du serveur. */
export function estimateStages(projectCalls: CallRow[], serverCalls: CallRow[]): StageEstimates {
  const stage = (key: StageKey) => {
    const ms = meanOf(projectCalls, STAGE_PURPOSES[key]) ?? meanOf(serverCalls, STAGE_PURPOSES[key]);
    return ms === null ? { ms: DEFAULT_STAGE_MS[key], basis: 'default' as const } : { ms, basis: 'history' as const };
  };
  const keys = Object.keys(STAGE_PURPOSES) as StageKey[];
  return Object.fromEntries(keys.map((k) => [k, stage(k)])) as StageEstimates;
}

export function estimateBookDuration(work: BookWork, stages: StageEstimates): BookDuration {
  return {
    ...work,
    duration_ms: stages.plan.ms * work.plans + stages.write.ms * work.scenes + stages.memory.ms * work.chapters,
    basis: stages.write.basis,
  };
}

function totalsOf(calls: CallRow[]): UsageTotals {
  const sum = (field: keyof Omit<UsageTotals, 'calls' | 'failed_calls'>) => calls.reduce((n, c) => n + (c[field] ?? 0), 0);
  return {
    calls: calls.length,
    failed_calls: calls.filter((c) => c.status !== 'OK').length,
    duration_ms: sum('duration_ms'),
    input_tokens: sum('input_tokens'),
    output_tokens: sum('output_tokens'),
    cache_read_tokens: sum('cache_read_tokens'),
    cache_write_tokens: sum('cache_write_tokens'),
    cost_usd: sum('cost_usd'),
  };
}

/** Tout appel compte dans les totaux, un échec ou une annulation étant facturés ; la moyenne ne garde que les succès. */
export function buildReport(calls: CallRow[], scenes: Array<{ content: string; truncated: boolean }>): GenerationReport {
  const purposes = [...new Set(calls.map((c) => c.purpose))];
  const by_purpose = purposes
    .map((purpose) => {
      const rows = calls.filter((c) => c.purpose === purpose);
      const ok = rows.filter((c) => c.status === 'OK');
      return { purpose, ...totalsOf(rows), avg_duration_ms: ok.length ? Math.round(mean(ok.map((c) => c.duration_ms))) : 0 };
    })
    .sort((a, b) => b.cost_usd - a.cost_usd);
  const totals = totalsOf(calls);
  const words = scenes.reduce((n, s) => n + countWords(s.content), 0);
  return {
    totals,
    by_purpose,
    words,
    truncated_scenes: scenes.filter((s) => s.truncated).length,
    cost_per_1000_words: words > 0 ? (totals.cost_usd / words) * 1000 : null,
  };
}

export class StatsService {
  constructor(
    private readonly pb: PocketBase,
    private readonly log: Logger,
  ) {}

  private projectCalls(projectId: string) {
    return this.pb.collection('ai_calls').getFullList<CallRow>({
      filter: this.pb.filter('project = {:p}', { p: projectId }),
      fields: CALL_FIELDS,
      sort: '-created',
      batch: 1000,
    });
  }

  /** Une estimation indisponible ne doit jamais empêcher une génération. */
  async stageEstimates(projectId: string): Promise<StageEstimates> {
    try {
      const [project, server] = await Promise.all([
        this.projectCalls(projectId),
        this.pb.collection('ai_calls').getList<CallRow>(1, SERVER_HISTORY, {
          filter: 'status = "OK"', fields: CALL_FIELDS, sort: '-created', skipTotal: true,
        }),
      ]);
      return estimateStages(project, server.items);
    } catch (e) {
      this.log.warn({ err: e, project: projectId }, 'estimation indisponible, valeurs par défaut');
      return estimateStages([], []);
    }
  }

  async report(projectId: string): Promise<GenerationReport> {
    const [calls, scenes] = await Promise.all([
      this.projectCalls(projectId),
      this.pb.collection('scenes').getFullList<{ content: string; truncated: boolean }>({
        filter: this.pb.filter('chapter.project = {:p}', { p: projectId }),
        fields: 'content,truncated',
      }),
    ]);
    return buildReport(calls, scenes);
  }
}
