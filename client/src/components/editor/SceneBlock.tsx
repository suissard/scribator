import { AlertTriangle, History, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { pb } from '@/api/pocketbase';
import { api } from '@/api/server';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { Field, Input, Textarea } from '@/components/ui/field';
import { flushAllAutosaves } from '@/lib/autosaveRegistry';
import type { Scene } from '@/lib/types';
import { useAction } from '@/lib/useAction';
import { useAutoSave } from '@/lib/useAutoSave';
import { countWords, formatNumber } from '@/lib/utils';
import { RichTextEditor } from './RichTextEditor';
import { StreamingViewer } from './StreamingViewer';
import { VersionHistoryModal } from './VersionHistoryModal';

export function SceneBlock({ scene, locked }: { scene: Scene; locked: boolean }) {
  const [history, setHistory] = useState(false);
  const [regen, setRegen] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [beat, setBeat] = useState(scene.beat);
  const { busy, error, run } = useAction();

  const saveContent = useAutoSave<string>((content) => pb.collection('scenes').update(scene.id, { content }));
  const saveBeat = useAutoSave<string>((value) => pb.collection('scenes').update(scene.id, { beat: value }));

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Scène {scene.scene_number}</h3>
        <div className="flex items-center gap-2">
          {scene.truncated && (
            <Badge className="bg-stale/10 text-stale" title="La génération a atteint sa limite de longueur">
              <AlertTriangle size={12} /> Scène tronquée
            </Badge>
          )}
          {(scene.status === 'REVIEW' || scene.status === 'APPROVED') && (
            <span className="text-xs tabular-nums text-muted">
              {formatNumber(countWords(scene.content))} / {formatNumber(scene.target_words)} mots
            </span>
          )}
        </div>
      </div>

      {scene.status === 'PENDING' && (
        <Field label="Ce qui doit se passer">
          <Textarea
            value={beat}
            disabled={locked}
            onChange={(e) => {
              setBeat(e.target.value);
              saveBeat(e.target.value);
            }}
          />
        </Field>
      )}
      {scene.status === 'GENERATING' && <StreamingViewer text={scene.draft} />}
      {scene.status === 'REVIEW' && (
        <RichTextEditor value={scene.content} onChange={saveContent} ariaLabel={`Texte de la scène ${scene.scene_number}`} />
      )}
      {scene.status === 'APPROVED' && <div className="prose-book whitespace-pre-wrap">{scene.content}</div>}

      <ErrorNote error={error} />
      {scene.status !== 'PENDING' && scene.status !== 'GENERATING' && (
        <div className="flex flex-wrap gap-2">
          {scene.status === 'REVIEW' && (
            <Button size="sm" variant="secondary" disabled={locked} onClick={() => setRegen(true)}>
              <RefreshCw size={14} /> Régénérer cette scène
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setHistory(true)}>
            <History size={14} /> Historique
          </Button>
        </div>
      )}

      <Dialog open={regen} onOpenChange={setRegen} title="Régénérer la scène" description="L'ancienne version sera conservée dans l'historique.">
        <Field label="Instructions (facultatif)">
          <Input value={instructions} placeholder="Plus de tension, moins de description…" onChange={(e) => setInstructions(e.target.value)} />
        </Field>
        <div className="mt-4 flex justify-end">
          <Button
            disabled={busy}
            onClick={() => {
              setRegen(false);
              void run(async () => {
                await flushAllAutosaves();
                await api.regenerateScene(scene.id, instructions || undefined);
              });
            }}
          >
            Régénérer
          </Button>
        </div>
      </Dialog>
      <VersionHistoryModal open={history} onOpenChange={setHistory} targetId={scene.id} field="content" />
    </Card>
  );
}
