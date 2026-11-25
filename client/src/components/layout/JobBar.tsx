import { AlertCircle, Check, Square, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/api/server';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { Spinner } from '@/components/ui/spinner';
import { formatDuration, jobView, type StageView } from '@/lib/progress';
import type { Job, StageKey } from '@/lib/types';
import { useUiMode } from '@/lib/uiMode';
import { useAction } from '@/lib/useAction';
import { cn } from '@/lib/utils';

const JOB_LABELS: Record<Job['kind'], string> = {
  ANALYZE: 'Analyse en cours',
  OUTLINE: 'Création de la trame',
  CHAPTER: 'Écriture du chapitre',
  SCENE: 'Régénération de la scène',
  BOOK: 'Écriture automatique du livre',
};

const SIMPLE_JOB_LABELS: Record<Job['kind'], string> = {
  ANALYZE: 'Préparation du résumé de votre histoire',
  OUTLINE: 'Création du plan de vos chapitres',
  CHAPTER: 'Écriture de votre chapitre en cours',
  SCENE: 'Réécriture du passage en cours',
  BOOK: 'Écriture automatique de votre livre',
};

const FAILED_LABELS: Record<Job['kind'], string> = {
  ANALYZE: "L'analyse a échoué",
  OUTLINE: "Le plan des chapitres n'a pas pu être créé",
  CHAPTER: "L'écriture du chapitre a échoué",
  SCENE: 'La régénération de la scène a échoué',
  BOOK: "L'écriture automatique s'est arrêtée",
};

const STAGE_LABELS: Record<StageKey, string> = {
  read: 'Lecture',
  style: 'Style',
  concept: 'Concept',
  outline: 'Trame',
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
function StageBar({ stage, failed }: { stage: StageView; failed: boolean }) {
  return (
    <div className={cn('h-1.5 min-w-4 overflow-hidden rounded-full', failed ? 'bg-danger/25' : 'bg-white')} style={{ flex: `${Math.max(stage.total * stage.avg_ms, 1)} 1 0` }}>
      <div className={cn('h-full rounded-full transition-[width] duration-1000 ease-linear', failed ? 'bg-danger' : 'bg-accent')} style={{ width: `${stage.fraction * 100}%` }} />
    </div>
  );
}

/** `failed` : l'étape où le job a planté. `halted` : le job est fini, plus aucune estimation n'a de sens. */
function StageLegend({ stage, failed, halted }: { stage: StageView; failed: boolean; halted: boolean }) {
  const done = stage.done >= stage.total;
  return (
    <li className={cn('flex items-center gap-1.5 whitespace-nowrap text-xs', failed ? 'text-danger' : 'text-accent')}>
      {done && <Check size={12} aria-hidden="true" />}
      {failed && <AlertCircle size={12} aria-hidden="true" />}
      <span className="font-medium">{STAGE_LABELS[stage.key]}</span>
      <span className="tabular-nums">{stage.done}/{stage.total}</span>
      {failed && <span>· échec ici</span>}
      {!done && !halted && (
        <span className="tabular-nums text-accent/75" title={stage.basis === 'default' ? "Pas encore d'historique : l'estimation s'affine après le premier maillon" : undefined}>
          · {stage.basis === 'default' ? 'env. ' : ''}{formatDuration(stage.remainingMs)}
        </span>
      )}
    </li>
  );
}

/** Étape où le job s'est arrêté : celle qui tournait, sinon la première inachevée. */
function failedStageKey(job: Job): StageKey | null {
  const p = job.progress;
  if (!p?.stages) return null;
  return p.active ?? p.stages.find((s) => s.total > 0 && s.done < s.total)?.key ?? null;
}

function FailedJobBar({ job, onDismiss }: { job: Job; onDismiss: () => void }) {
  const { isSimple } = useUiMode();
  // Figée : sans `active_since`, le maillon interrompu ne continue pas d'avancer à l'écran.
  const view = useMemo(() => (job.progress ? jobView({ ...job, progress: { ...job.progress, active_since: null } }, 0) : null), [job]);
  const failedKey = failedStageKey(job);
  const where = failedKey ? `Étape « ${STAGE_LABELS[failedKey]} »` : null;
  const detail = isSimple ? job.progress?.detail : [where, job.progress?.detail].filter(Boolean).join(' · ');

  return (
    <div role="alert" className="border-b border-danger/30 bg-danger-soft px-4 py-2.5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-2 text-sm text-danger">
          <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p>
              <span className="font-semibold">{FAILED_LABELS[job.kind]}</span>
              {detail && <span className="text-danger/80"> · {detail}</span>}
            </p>
            <p className="mt-0.5 break-words">{job.error_message || 'La génération a échoué.'}</p>
          </div>
        </div>
        <Button size="icon" variant="ghost" aria-label="Fermer" className="h-10 w-10 shrink-0 text-danger hover:bg-danger/10 hover:text-danger" onClick={onDismiss}>
          <X size={18} />
        </Button>
      </div>
      {!isSimple && view && view.stages.length > 0 && (
        <>
          <div className="mt-2 flex gap-1" aria-hidden="true">
            {view.stages.map((s) => <StageBar key={s.key} stage={s} failed={s.key === failedKey} />)}
          </div>
          <ul className="mt-1 flex flex-wrap gap-x-4">
            {view.stages.map((s) => <StageLegend key={s.key} stage={s} failed={s.key === failedKey} halted />)}
          </ul>
        </>
      )}
    </div>
  );
}

export function JobBar({ job, onDismiss }: { job: Job; onDismiss?: () => void }) {
  if (job.status === 'FAILED') return <FailedJobBar job={job} onDismiss={onDismiss ?? (() => {})} />;
  return <RunningJobBar job={job} />;
}

function RunningJobBar({ job }: { job: Job }) {
  const { isSimple } = useUiMode();
  const [asking, setAsking] = useState(false);
  const { busy, error, run } = useAction();
  const now = useNow(1000);
  const view = jobView(job, now);
  const stop = (keepPartial: boolean) => {
    setAsking(false);
    void run(() => api.cancelJob(job.id, keepPartial));
  };
  const percent = view ? Math.round(view.fraction * 100) : undefined;
  const label = isSimple ? SIMPLE_JOB_LABELS[job.kind] : JOB_LABELS[job.kind];

  return (
    <div className="border-b border-line bg-accent-soft px-4 py-2.5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2 text-sm text-accent">
          <Spinner />
          <p role="status" className="min-w-0 truncate">
            {/* Sur téléphone, le détail prime : il dit où en est le travail. */}
            <span className={job.progress?.detail ? 'hidden font-semibold sm:inline' : 'font-semibold'}>{label}</span>
            {job.progress?.detail && <span><span className="hidden sm:inline"> · </span>{job.progress.detail}</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {view && (
            <span className="hidden text-xs tabular-nums text-accent sm:inline">
              {percent} % · environ {formatDuration(view.remainingMs)} restante{view.remainingMs >= 120_000 ? 's' : ''}
            </span>
          )}
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => (job.kind === 'ANALYZE' || job.kind === 'OUTLINE' ? stop(false) : setAsking(true))}>
            <Square size={12} /> Arrêter
          </Button>
        </div>
      </div>

      {isSimple ? (
        <>
          <div
            role="progressbar"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={100}
            {...(percent !== undefined ? { 'aria-valuenow': percent } : {})}
            className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-white"
          >
            {percent !== undefined ? (
              <div className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${percent}%` }} />
            ) : (
              <div className="progress-indeterminate h-full w-1/3 rounded-full bg-accent" />
            )}
          </div>
          {view && (
            <p className="mt-1 text-xs tabular-nums text-accent sm:hidden">
              {percent} % · environ {formatDuration(view.remainingMs)}
            </p>
          )}
        </>
      ) : (
        <>
          <div
            role="progressbar"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={100}
            {...(percent !== undefined ? { 'aria-valuenow': percent } : {})}
            className="mt-2 flex gap-1"
          >
            {view && view.stages.length > 0 ? (
              view.stages.map((s) => <StageBar key={s.key} stage={s} failed={false} />)
            ) : (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white">
                <div className="progress-indeterminate h-full w-1/3 rounded-full bg-accent" />
              </div>
            )}
          </div>
          {view && (
            <ul className="mt-1 flex flex-wrap gap-x-4">
              {view.stages.map((s) => <StageLegend key={s.key} stage={s} failed={false} halted={false} />)}
              <li className="text-xs tabular-nums text-accent sm:hidden">{percent} % · reste {formatDuration(view.remainingMs)}</li>
            </ul>
          )}
        </>
      )}

      <ErrorNote error={error} />
      <Dialog
        open={asking}
        onOpenChange={setAsking}
        title="Arrêter la génération ?"
        description={
          job.kind === 'BOOK'
            ? 'Les chapitres déjà validés restent acquis. Vous pourrez reprendre plus tard. Le texte de la scène en cours peut être conservé.'
            : 'Le texte déjà écrit peut être conservé.'
        }
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setAsking(false)}>
            Continuer la génération
          </Button>
          <Button variant="danger" onClick={() => stop(false)}>
            Arrêter et jeter
          </Button>
          <Button variant="primary" onClick={() => stop(true)}>
            Arrêter et garder le début
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
