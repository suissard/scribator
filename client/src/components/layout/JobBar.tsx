import { Check, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/api/server';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { Spinner } from '@/components/ui/spinner';
import { formatDuration, jobView, type StageView } from '@/lib/progress';
import type { Job, StageKey } from '@/lib/types';
import { useAction } from '@/lib/useAction';

const JOB_LABELS: Record<Job['kind'], string> = {
  ANALYZE: 'Analyse en cours',
  SAMPLE: "Rédaction de l'échantillon",
  CHAPTER: 'Écriture du chapitre',
  SCENE: 'Régénération de la scène',
  BOOK: 'Écriture automatique du livre',
};

const STAGE_LABELS: Record<StageKey, string> = {
  read: 'Lecture',
  style: 'Style',
  concept: 'Concept',
  sample: 'Échantillon',
  plan: 'Plans des scènes',
  write: 'Rédaction',
  memory: 'Résumés et mémoire',
};

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Largeur proportionnelle à la durée prévue : la barre donne la vraie part de chaque étape. */
function StageBar({ stage }: { stage: StageView }) {
  return (
    <div className="h-1.5 min-w-4 overflow-hidden rounded-full bg-white" style={{ flex: `${Math.max(stage.total * stage.avg_ms, 1)} 1 0` }}>
      <div className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${stage.fraction * 100}%` }} />
    </div>
  );
}

function StageLegend({ stage }: { stage: StageView }) {
  const done = stage.done >= stage.total;
  return (
    <li className="flex items-center gap-1.5 whitespace-nowrap text-xs text-accent">
      {done && <Check size={12} aria-hidden="true" />}
      <span className="font-medium">{STAGE_LABELS[stage.key]}</span>
      <span className="tabular-nums">{stage.done}/{stage.total}</span>
      {!done && (
        <span className="tabular-nums text-accent/75" title={stage.basis === 'default' ? "Pas encore d'historique : l'estimation s'affine après le premier maillon" : undefined}>
          · {stage.basis === 'default' ? 'env. ' : ''}{formatDuration(stage.remainingMs)}
        </span>
      )}
    </li>
  );
}

export function JobBar({ job }: { job: Job }) {
  const [asking, setAsking] = useState(false);
  const { busy, error, run } = useAction();
  const now = useNow(1000);
  const view = jobView(job, now);
  const stop = (keepPartial: boolean) => {
    setAsking(false);
    void run(() => api.cancelJob(job.id, keepPartial));
  };
  const percent = view ? Math.round(view.fraction * 100) : undefined;

  return (
    <div className="border-b border-line bg-accent-soft px-4 py-2">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2 text-sm text-accent">
          <Spinner />
          <p role="status" className="min-w-0 truncate">
            {/* Sur téléphone, le détail prime : il dit où en est le travail. */}
            <span className={job.progress?.detail ? 'hidden font-medium sm:inline' : 'font-medium'}>{JOB_LABELS[job.kind]}</span>
            {job.progress?.detail && <span><span className="hidden sm:inline"> · </span>{job.progress.detail}</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {view && (
            <span className="hidden text-xs tabular-nums text-accent sm:inline">
              {percent} % · reste {formatDuration(view.remainingMs)}
            </span>
          )}
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => (job.kind === 'ANALYZE' ? stop(false) : setAsking(true))}>
            <Square size={12} /> Arrêter<span className="hidden sm:inline"> la génération</span>
          </Button>
        </div>
      </div>
      <div
        role="progressbar"
        aria-label={JOB_LABELS[job.kind]}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(percent !== undefined ? { 'aria-valuenow': percent } : {})}
        className="mt-2 flex gap-1"
      >
        {view && view.stages.length > 0 ? (
          view.stages.map((s) => <StageBar key={s.key} stage={s} />)
        ) : (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white">
            <div className="progress-indeterminate h-full w-1/3 rounded-full bg-accent" />
          </div>
        )}
      </div>
      {view && (
        <ul className="mt-1 flex flex-wrap gap-x-4">
          {view.stages.map((s) => <StageLegend key={s.key} stage={s} />)}
          <li className="text-xs tabular-nums text-accent sm:hidden">{percent} % · reste {formatDuration(view.remainingMs)}</li>
        </ul>
      )}
      <ErrorNote error={error} />
      <Dialog open={asking} onOpenChange={setAsking} title="Arrêter la génération ?" description={job.kind === 'BOOK' ? 'Les chapitres déjà validés restent acquis. Tu pourras reprendre plus tard. Le texte de la scène en cours peut être conservé.' : 'Le texte déjà écrit peut être conservé.'}>
        <div className="flex justify-end gap-2">
          <Button variant="danger" onClick={() => stop(false)}>Tout jeter</Button>
          <Button onClick={() => stop(true)}>Garder le début</Button>
        </div>
      </Dialog>
    </div>
  );
}
