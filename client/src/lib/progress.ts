import type { Job, JobStage } from './types';

export interface StageView extends JobStage {
  fraction: number;
  remainingMs: number;
}

export interface JobView {
  stages: StageView[];
  fraction: number;
  remainingMs: number;
}

/** Un maillon qui dépasse sa moyenne n'est jamais annoncé comme fini : seul le serveur le sait. */
const LAST_STRETCH = 0.95;

function stageView(stage: JobStage, activeMs: number | null): StageView {
  const left = stage.total - stage.done;
  if (activeMs === null) return { ...stage, fraction: stage.total ? stage.done / stage.total : 1, remainingMs: left * stage.avg_ms };
  const link = Math.min(LAST_STRETCH, activeMs / Math.max(stage.avg_ms, 1));
  return { ...stage, fraction: (stage.done + link) / stage.total, remainingMs: (left - link) * stage.avg_ms };
}

/** Temps restant d'une étape : durée moyenne d'un maillon × maillons restants, moins le maillon entamé. */
export function jobView(job: Job, now: number): JobView | null {
  const p = job.progress;
  if (!p?.stages) return null;
  const elapsed = p.active_since ? Math.max(0, now - Date.parse(p.active_since)) : 0;
  const stages = p.stages.filter((s) => s.total > 0).map((s) => stageView(s, s.key === p.active ? elapsed : null));
  const weight = (s: StageView) => s.total * s.avg_ms;
  const totalWeight = stages.reduce((n, s) => n + weight(s), 0);
  return {
    stages,
    fraction: totalWeight ? stages.reduce((n, s) => n + s.fraction * weight(s), 0) / totalWeight : 0,
    remainingMs: stages.reduce((n, s) => n + s.remainingMs, 0),
  };
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "moins d'une minute";
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} h${rest ? ` ${String(rest).padStart(2, '0')}` : ''}`;
}

/** Durée courte d'un compte rendu, où une poignée de secondes a du sens. */
export function formatSeconds(ms: number): string {
  return ms < 60_000 ? `${(ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s` : formatDuration(ms);
}

/** Un ordre de grandeur : la précision serait trompeuse sur une estimation. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`;
  return n >= 1000 ? `${Math.round(n / 1000).toLocaleString('fr-FR')} 000` : String(n);
}

export const formatUsd = (n: number) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: n > 0 && n < 0.1 ? 4 : 2 })} $`;
