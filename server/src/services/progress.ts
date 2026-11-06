/**
 * Progression d'un job : des étapes, faites de maillons de durée comparable.
 * Le temps restant d'une étape vaut donc durée moyenne × maillons restants. La moyenne vient de
 * l'historique au démarrage, puis des maillons réellement mesurés pendant ce job.
 */
export type StageKey = 'read' | 'style' | 'concept' | 'sample' | 'plan' | 'write' | 'memory';

/** run : mesuré sur ce job. history : appels passés. default : aucune donnée, valeur de départ. */
export type EstimateBasis = 'run' | 'history' | 'default';

export interface StageEstimate {
  ms: number;
  basis: EstimateBasis;
}

export type StageEstimates = Record<StageKey, StageEstimate>;

export interface StageProgress {
  key: StageKey;
  done: number;
  total: number;
  avg_ms: number;
  basis: EstimateBasis;
}

export interface JobProgress {
  current: number;
  total: number;
  stages: StageProgress[];
  active: StageKey | null;
  active_since: string | null;
  detail: string;
  chapter_id: string;
}

export interface StepPlace {
  detail: string;
  chapterId?: string;
}

export class ProgressTracker {
  private stages: StageProgress[] = [];
  private readonly spentMs = new Map<StageKey, number>();
  private active: { key: StageKey; since: number; place: StepPlace } | null = null;

  constructor(
    private readonly save: (progress: JobProgress) => Promise<void>,
    private readonly now: () => number = Date.now,
  ) {}

  define(stages: Array<{ key: StageKey; total: number }>, estimates: StageEstimates): Promise<void> {
    this.stages = stages.map(({ key, total }) => ({ key, total, done: 0, avg_ms: estimates[key].ms, basis: estimates[key].basis }));
    return this.save(this.snapshot());
  }

  /** Une étape dont le nombre de maillons n'était qu'estimé : le plan des scènes donne le vrai chiffre. */
  setTotal(key: StageKey, total: number): Promise<void> {
    const stage = this.stage(key);
    stage.total = Math.max(total, stage.done);
    return this.save(this.snapshot());
  }

  /** Un maillon échoué ou annulé n'est pas compté : il ne fausse pas la moyenne. */
  async step<T>(key: StageKey, place: StepPlace, fn: () => Promise<T>): Promise<T> {
    const stage = this.stage(key);
    const since = this.now();
    this.active = { key, since, place };
    await this.save(this.snapshot());
    const result = await fn();
    const spent = (this.spentMs.get(key) ?? 0) + this.now() - since;
    this.spentMs.set(key, spent);
    stage.done += 1;
    stage.total = Math.max(stage.total, stage.done);
    stage.avg_ms = Math.round(spent / stage.done);
    stage.basis = 'run';
    this.active = null;
    await this.save(this.snapshot());
    return result;
  }

  snapshot(): JobProgress {
    return {
      current: this.stages.reduce((n, s) => n + s.done, 0),
      total: this.stages.reduce((n, s) => n + s.total, 0),
      stages: this.stages.map((s) => ({ ...s })),
      active: this.active?.key ?? null,
      active_since: this.active ? new Date(this.active.since).toISOString() : null,
      detail: this.active?.place.detail ?? '',
      chapter_id: this.active?.place.chapterId ?? '',
    };
  }

  private stage(key: StageKey): StageProgress {
    const stage = this.stages.find((s) => s.key === key);
    if (!stage) throw new Error(`Étape inconnue : ${key}`);
    return stage;
  }
}
