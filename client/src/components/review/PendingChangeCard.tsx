import { Check, X } from 'lucide-react';
import { api } from '@/api/server';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorNote } from '@/components/ui/ErrorNote';
import type { BiblePatchPayload, PendingChange, StyleSuggestionPayload } from '@/lib/types';
import { useAction } from '@/lib/useAction';

const SECTIONS: Record<string, string> = {
  characters: 'Personnage', locations: 'Lieu', world_rules: 'Règle', timeline_events: 'Événement',
};

const itemLabel = (item: Record<string, unknown>) => String(item.name ?? item.rule ?? item.event ?? '');

function BiblePatch({ payload }: { payload: BiblePatchPayload }) {
  return (
    <ul className="space-y-1 text-sm">
      {payload.operations.map((op, i) => (
        <li key={i}>
          {op.op === 'add' && <>➕ {SECTIONS[op.section]} : <strong>{itemLabel(op.item)}</strong></>}
          {op.op === 'update' && <>✏️ {SECTIONS[op.section]} {op.id} : {Object.entries(op.fields).map(([k, v]) => `${k} → ${v}`).join(', ')}</>}
          {op.op === 'remove' && <>➖ {SECTIONS[op.section]} {op.id} : {op.reason}</>}
        </li>
      ))}
    </ul>
  );
}

function StyleSuggestion({ payload }: { payload: StyleSuggestionPayload }) {
  return (
    <div className="space-y-2 text-sm">
      <p>{payload.explanation}</p>
      {payload.evidence.map((e, i) => (
        <div key={i} className="rounded bg-paper p-2 font-serif text-xs">
          <p className="text-danger line-through">{e.before || '(rien)'}</p>
          <p className="text-ok">{e.after || '(supprimé)'}</p>
        </div>
      ))}
    </div>
  );
}

export function PendingChangeCard({ change, onDone }: { change: PendingChange; onDone(id: string): void }) {
  const { busy, error, run } = useAction();
  const isBible = change.kind === 'BIBLE_PATCH';
  const act = (fn: (id: string) => Promise<unknown>) =>
    void run(async () => {
      await fn(change.id);
      onDone(change.id);
    });
  return (
    <Card className="space-y-3 p-4">
      <h4 className="text-sm font-semibold">{isBible ? 'Mise à jour de la Bible' : 'Ajustement du style'}</h4>
      {isBible ? <BiblePatch payload={change.payload as BiblePatchPayload} /> : <StyleSuggestion payload={change.payload as StyleSuggestionPayload} />}
      <ErrorNote error={error} />
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => act(api.acceptChange)}>
          <Check size={14} /> Accepter
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(api.rejectChange)}>
          <X size={14} /> Refuser
        </Button>
      </div>
    </Card>
  );
}
