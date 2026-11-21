import { ArrowRight, Check, History, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { pb } from '@/api/pocketbase';
import { api } from '@/api/server';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { StreamingViewer } from '@/components/editor/StreamingViewer';
import { VersionHistoryModal } from '@/components/editor/VersionHistoryModal';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { flushAllAutosaves } from '@/lib/autosaveRegistry';
import { toastSuccess } from '@/lib/toast';
import type { Project } from '@/lib/types';
import { useAction } from '@/lib/useAction';
import { useAutoSave } from '@/lib/useAutoSave';
import { countWords, formatNumber } from '@/lib/utils';
import { useProjectStore } from '@/store/useProjectStore';

export function Step4Sample({ project }: { project: Project }) {
  const job = useProjectStore((s) => s.activeJob);
  const setStep = useProjectStore((s) => s.setStep);
  const [history, setHistory] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const { busy, doing, error, run } = useAction();
  const save = useAutoSave<string>((sample_text) => pb.collection('projects').update(project.id, { sample_text }));
  const generating = job?.kind === 'SAMPLE';
  const canApprove = project.status === 'STEP_4_SAMPLE_REVIEW';

  const regenerateSample = () => {
    setConfirmRegen(false);
    void run(async () => {
      await flushAllAutosaves();
      await api.sample(project.id);
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">Échantillon</h2>
          <span className="text-xs tabular-nums text-muted">
            {formatNumber(countWords(generating ? project.sample_draft : project.sample_text))} mots
          </span>
        </div>
        <div className="rounded-md border border-accent/25 bg-accent-soft/40 p-3 text-sm text-ink">
          Corrigez ce texte comme vous le souhaitez : il devient la référence de style du livre, et vos corrections servent à ajuster ce style.
        </div>
        {generating ? (
          <StreamingViewer text={project.sample_draft} label="scène d'ouverture" />
        ) : (
          <RichTextEditor value={project.sample_text} onChange={save} ariaLabel="Texte de l'échantillon" />
        )}
      </Card>

      <ErrorNote error={error} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={() => setHistory(true)}>
            <History size={14} /> Historique
          </Button>
          <Button variant="secondary" disabled={busy || generating} onClick={() => setConfirmRegen(true)}>
            <RefreshCw size={14} /> Régénérer
          </Button>
        </div>

        {canApprove ? (
          <Button
            variant="success"
            disabled={busy || generating}
            loading={doing === 'approve'}
            onClick={() =>
              void run(async () => {
                await flushAllAutosaves();
                await api.approveSample(project.id);
                toastSuccess('Échantillon validé !');
              }, 'approve')
            }
          >
            {doing !== 'approve' && <Check size={16} />}
            {doing === 'approve' ? 'Validation…' : "Valider l'échantillon"}
          </Button>
        ) : (
          <Button variant="primary" onClick={() => setStep(5)}>
            Aller au Studio <ArrowRight size={16} />
          </Button>
        )}
      </div>

      <Dialog
        open={confirmRegen}
        onOpenChange={setConfirmRegen}
        title="Régénérer l'échantillon ?"
        description="Le texte actuel sera remplacé par une nouvelle version. L'ancienne version reste disponible dans l'historique."
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmRegen(false)}>
            Annuler
          </Button>
          <Button variant="primary" onClick={regenerateSample}>
            Régénérer
          </Button>
        </div>
      </Dialog>

      <VersionHistoryModal open={history} onOpenChange={setHistory} targetId={project.id} field="sample_text" />
    </div>
  );
}
