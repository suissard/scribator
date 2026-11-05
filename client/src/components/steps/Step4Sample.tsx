import { Check, History, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { pb } from '@/api/pocketbase';
import { api } from '@/api/server';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { StreamingViewer } from '@/components/editor/StreamingViewer';
import { VersionHistoryModal } from '@/components/editor/VersionHistoryModal';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { flushAllAutosaves } from '@/lib/autosaveRegistry';
import type { Project } from '@/lib/types';
import { useAction } from '@/lib/useAction';
import { useAutoSave } from '@/lib/useAutoSave';
import { countWords, formatNumber } from '@/lib/utils';
import { useProjectStore } from '@/store/useProjectStore';

export function Step4Sample({ project }: { project: Project }) {
  const job = useProjectStore((s) => s.activeJob);
  const [history, setHistory] = useState(false);
  const { busy, error, run } = useAction();
  const save = useAutoSave<string>((sample_text) => pb.collection('projects').update(project.id, { sample_text }));
  const generating = job?.kind === 'SAMPLE';
  const canApprove = project.status === 'STEP_4_SAMPLE_REVIEW';

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Échantillon</h2>
          <span className="text-xs tabular-nums text-muted">{formatNumber(countWords(generating ? project.sample_draft : project.sample_text))} mots</span>
        </div>
        {generating ? (
          <StreamingViewer text={project.sample_draft} label="scène d'ouverture" />
        ) : (
          <RichTextEditor value={project.sample_text} onChange={save} ariaLabel="Texte de l'échantillon" />
        )}
      </Card>
      <p className="text-sm text-muted">
        Corrige ce texte comme tu le souhaites : il devient la référence de style du livre, et tes corrections servent à ajuster ce style.
      </p>
      <ErrorNote error={error} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => setHistory(true)}><History size={14} /> Historique</Button>
        <Button
          variant="secondary"
          disabled={busy || generating}
          onClick={() =>
            void run(async () => {
              await flushAllAutosaves();
              await api.sample(project.id);
            })
          }
        >
          <RefreshCw size={14} /> Régénérer
        </Button>
        {canApprove && (
          <Button
            disabled={busy || generating}
            onClick={() =>
              void run(async () => {
                await flushAllAutosaves();
                await api.approveSample(project.id);
              })
            }
          >
            <Check size={16} /> Valider l'échantillon
          </Button>
        )}
      </div>
      <VersionHistoryModal open={history} onOpenChange={setHistory} targetId={project.id} field="sample_text" />
    </div>
  );
}
