import { Check, X } from 'lucide-react';
import { api } from '@/api/server';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { toastSuccess } from '@/lib/toast';
import type { BiblePatchPayload, PendingChange, StoryBible, StyleSuggestionPayload } from '@/lib/types';
import { useAction } from '@/lib/useAction';

const SECTIONS: Record<string, string> = {
  characters: 'Personnage',
  locations: 'Lieu',
  world_rules: 'Règle',
  timeline_events: 'Événement',
};

const FIELD_LABELS: Record<string, string> = {
  name: 'nom',
  role: 'rôle',
  traits: 'traits',
  current_status: 'situation',
  description: 'description',
  rule: 'règle',
  event: 'événement',
};

const itemLabel = (item: Record<string, unknown>) => String(item.name ?? item.rule ?? item.event ?? '');

function resolveEntityName(bible: StoryBible | null | undefined, section: string, id: string): string {
  if (!bible) return id;
  if (section === 'characters') return bible.characters.find((c) => c.id === id)?.name || id;
  if (section === 'locations') return bible.locations.find((l) => l.id === id)?.name || id;
  if (section === 'world_rules') return bible.world_rules.find((r) => r.id === id)?.rule || id;
  if (section === 'timeline_events') return bible.timeline_events.find((t) => t.id === id)?.event || id;
  return id;
}

function BiblePatch({ payload, bible }: { payload: BiblePatchPayload; bible?: StoryBible | null }) {
  return (
    <ul className="space-y-1.5 text-sm">
      {payload.operations.map((op, i) => (
        <li key={i}>
          {op.op === 'add' && (
            <>
              ➕ {SECTIONS[op.section] ?? op.section} : <strong>{itemLabel(op.item)}</strong>
            </>
          )}
          {op.op === 'update' && (
            <>
              ✏️ {SECTIONS[op.section] ?? op.section} <strong>{resolveEntityName(bible, op.section, op.id)}</strong> :{' '}
              {Object.entries(op.fields)
                .map(([k, v]) => `${FIELD_LABELS[k] ?? k} → ${v}`)
                .join(', ')}
            </>
          )}
          {op.op === 'remove' && (
            <>
              ➖ {SECTIONS[op.section] ?? op.section} <strong>{resolveEntityName(bible, op.section, op.id)}</strong> : {op.reason}
            </>
          )}
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

export function PendingChangeCard({
  change,
  bible,
  onDone,
}: {
  change: PendingChange;
  bible?: StoryBible | null;
  onDone(id: string): void;
}) {
  const { busy, error, run } = useAction();
  const isBible = change.kind === 'BIBLE_PATCH';
  const act = (fn: (id: string) => Promise<unknown>, okMessage?: string) =>
    void run(async () => {
      await fn(change.id);
      if (okMessage) toastSuccess(okMessage);
      onDone(change.id);
    });
  return (
    <Card className="space-y-3 border-accent/30 p-4">
      <h4 className="text-sm font-semibold">{isBible ? 'Mise à jour de la Bible' : 'Ajustement du style'}</h4>
      {isBible ? (
        <BiblePatch payload={change.payload as BiblePatchPayload} bible={bible} />
      ) : (
        <StyleSuggestion payload={change.payload as StyleSuggestionPayload} />
      )}
      <ErrorNote error={error} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="success" disabled={busy} onClick={() => act(api.acceptChange, 'Proposition appliquée.')}>
          <Check size={14} /> Accepter
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(api.rejectChange)}>
          <X size={14} /> Refuser
        </Button>
      </div>
    </Card>
  );
}
