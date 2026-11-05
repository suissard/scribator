import { RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { pb } from '@/api/pocketbase';
import { api } from '@/api/server';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { flushAllAutosaves } from '@/lib/autosaveRegistry';
import type { Version } from '@/lib/types';
import { useAction } from '@/lib/useAction';

const REASONS: Record<string, string> = {
  before_regenerate: 'Avant une régénération',
  before_restore: 'Avant une restauration',
  before_patch: 'Avant une modification',
};

interface Props {
  open: boolean;
  onOpenChange(open: boolean): void;
  targetId: string;
  field: string;
  onRestored?(): void;
}

export function VersionHistoryModal({ open, onOpenChange, targetId, field, onRestored }: Props) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const { busy, error, run } = useAction();

  useEffect(() => {
    if (!open) return;
    setVersions(null);
    void pb
      .collection('versions')
      .getFullList<Version>({ filter: pb.filter('target_id = {:t} && field = {:f}', { t: targetId, f: field }), sort: '-created' })
      .then(setVersions);
  }, [open, targetId, field]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Historique" description="Les 10 dernières versions sont conservées." wide>
      <ErrorNote error={error} />
      {versions?.length === 0 && <p className="text-sm text-muted">Aucune version antérieure pour l'instant.</p>}
      <ul className="space-y-3">
        {versions?.map((v) => (
          <li key={v.id} className="rounded-md border border-line p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted">
                {new Date(v.created).toLocaleString('fr-FR')} · {REASONS[v.reason] ?? v.reason}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await flushAllAutosaves();
                    await api.restoreVersion(v.id);
                    onRestored?.();
                    onOpenChange(false);
                  })
                }
              >
                <RotateCcw size={14} /> Restaurer
              </Button>
            </div>
            <p className="mt-2 line-clamp-4 whitespace-pre-wrap font-serif text-sm">{v.content}</p>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
