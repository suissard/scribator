import { Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '@/api/server';
import { subscribe } from '@/api/realtime';
import { AppShell } from '@/components/layout/AppShell';
import { maxStep, StepIndicator } from '@/components/layout/StepIndicator';
import { Step1Input } from '@/components/steps/Step1Input';
import { Step2Concept } from '@/components/steps/Step2Concept';
import { Step3Outline } from '@/components/steps/Step3Outline';
import { Step4Sample } from '@/components/steps/Step4Sample';
import { Step5Studio } from '@/components/steps/Step5Studio';
import { Step6Export } from '@/components/steps/Step6Export';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { pb } from '@/api/pocketbase';
import type { Chapter, Job, PendingChange, Project, Scene } from '@/lib/types';
import { useAction } from '@/lib/useAction';
import { useProjectStore } from '@/store/useProjectStore';

const JOB_LABELS: Record<Job['kind'], string> = {
  ANALYZE: 'Analyse en cours',
  SAMPLE: "Rédaction de l'échantillon",
  CHAPTER: 'Écriture du chapitre',
  SCENE: 'Régénération de la scène',
};

function JobBar({ job }: { job: Job }) {
  const [asking, setAsking] = useState(false);
  const { busy, error, run } = useAction();
  const stop = (keepPartial: boolean) => {
    setAsking(false);
    void run(() => api.cancelJob(job.id, keepPartial));
  };
  return (
    <div className="border-b border-line bg-accent-soft px-4 py-2">
      <div className="flex items-center justify-between gap-4">
        <p role="status" className="text-sm text-accent">
          {JOB_LABELS[job.kind]}
          {job.progress && job.kind !== 'SCENE' && ` : étape ${job.progress.current} sur ${job.progress.total}`}…
        </p>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => (job.kind === 'ANALYZE' ? stop(false) : setAsking(true))}>
          <Square size={12} /> Arrêter la génération
        </Button>
      </div>
      <ErrorNote error={error} />
      <Dialog open={asking} onOpenChange={setAsking} title="Arrêter la génération ?" description="Le texte déjà écrit peut être conservé.">
        <div className="flex justify-end gap-2">
          <Button variant="danger" onClick={() => stop(false)}>Tout jeter</Button>
          <Button onClick={() => stop(true)}>Garder le début</Button>
        </div>
      </Dialog>
    </div>
  );
}

export function ProjectWorkspace() {
  const { id = '' } = useParams();
  const s = useProjectStore();
  const { project, activeJob, activeStepView, activeChapterId, lastJobError } = s;
  const [notFound, setNotFound] = useState(false);
  const shownStatus = useRef<string | null>(null);
  const [usageKey, setUsageKey] = useState(0);

  useEffect(() => {
    const st = useProjectStore.getState();
    st.reset();
    setNotFound(false);
    shownStatus.current = null;
    st.load(id).catch(() => setNotFound(true));
    const stops = [
      subscribe<Project>('projects', pb.filter('id = {:id}', { id }), (e) => {
        if (e.action === 'update') useProjectStore.getState().setProject(e.record);
      }),
      subscribe<Chapter>('chapters', pb.filter('project = {:id}', { id }), (e) => {
        const store = useProjectStore.getState();
        if (e.action === 'delete') store.removeChapter(e.record.id);
        else store.upsertChapter(e.record);
      }),
      subscribe<PendingChange>('pending_changes', pb.filter('project = {:id}', { id }), (e) => {
        if (e.action !== 'delete') useProjectStore.getState().upsertChange(e.record);
      }),
      subscribe<Job>('generation_jobs', pb.filter('project = {:id}', { id }), (e) => {
        const store = useProjectStore.getState();
        store.applyJob(e.record);
        if (e.record.status !== 'RUNNING') {
          setUsageKey((k) => k + 1);
          // Filet de sécurité : un événement Realtime a pu être perdu pendant le job.
          void store.load(id);
          const chapterId = store.activeChapterId;
          if (chapterId) void store.loadScenes(chapterId);
        }
      }),
    ];
    return () => stops.forEach((stop) => stop());
  }, [id]);

  useEffect(() => {
    if (!activeChapterId) return;
    return subscribe<Scene>('scenes', pb.filter('chapter = {:c}', { c: activeChapterId }), (e) => {
      const store = useProjectStore.getState();
      if (e.action === 'delete') store.removeScene(e.record.id);
      else store.upsertScene(e.record);
    });
  }, [activeChapterId]);

  // Un jalon franchi amène à l'écran correspondant ; sinon, la navigation reste libre.
  useEffect(() => {
    if (!project || project.status === shownStatus.current) return;
    shownStatus.current = project.status;
    useProjectStore.getState().setStep(Math.min(maxStep(project.status), project.status === 'COMPLETED' ? 6 : 5) as 1);
  }, [project]);

  // Le statut ne passe à l'étape 4 qu'à la fin du job : il faut pourtant y être pour suivre le streaming.
  useEffect(() => {
    if (activeJob?.kind === 'SAMPLE') useProjectStore.getState().setStep(4);
  }, [activeJob?.kind]);

  useEffect(() => {
    window.scrollTo(0, 0); // renvoie une promesse sur les Chrome récents : ne pas en faire la valeur de retour
  }, [activeStepView]);

  if (notFound) {
    return (
      <AppShell>
        <div className="mx-auto mt-16 max-w-md text-center">
          <p>Ce livre est introuvable.</p>
          <Link to="/" className="mt-2 inline-block text-sm text-accent underline">Retour à mes livres</Link>
        </div>
      </AppShell>
    );
  }
  if (!project) return <AppShell><p className="p-6 text-sm text-muted">Chargement…</p></AppShell>;

  return (
    <AppShell usageKey={usageKey}>
      <div className="sticky top-14 z-10">
        <StepIndicator status={project.status} active={activeStepView} onSelect={s.setStep} />
        {activeJob && <JobBar job={activeJob} />}
      </div>
      {lastJobError && (
        <div className="mx-auto mt-4 max-w-3xl px-4">
          <ErrorNote error={lastJobError} />
        </div>
      )}
      {activeStepView === 1 && <Step1Input key={project.id} project={project} />}
      {activeStepView === 2 && <Step2Concept project={project} />}
      {activeStepView === 3 && <Step3Outline project={project} />}
      {activeStepView === 4 && <Step4Sample project={project} />}
      {activeStepView === 5 && <Step5Studio project={project} />}
      {activeStepView === 6 && <Step6Export project={project} />}
    </AppShell>
  );
}
