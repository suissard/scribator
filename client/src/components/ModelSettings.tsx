import { Check, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/api/server';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { Input } from '@/components/ui/field';
import type { ModelOption, Project } from '@/lib/types';
import { useAction } from '@/lib/useAction';
import { cn, formatNumber } from '@/lib/utils';
import { useProjectStore } from '@/store/useProjectStore';

const MAX_SHOWN = 60;

const price = (m: ModelOption) =>
  m.free ? 'Gratuit' : `${m.input_per_million.toFixed(2)} $ / ${m.output_per_million.toFixed(2)} $ par million de tokens`;

function Option({ selected, label, detail, badge, onPick, disabled }: { selected: boolean; label: string; detail: string; badge?: boolean; onPick(): void; disabled: boolean }) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        disabled={disabled}
        onClick={onPick}
        className={cn('flex w-full cursor-pointer items-start justify-between gap-2 rounded-md px-3 py-2 text-left', selected ? 'bg-accent-soft' : 'hover:bg-accent-soft/50')}
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-sm font-medium">
            <span className="truncate">{label}</span>
            {badge && <Badge className="bg-ok/10 text-ok">Gratuit</Badge>}
          </span>
          <span className="block text-xs text-muted">{detail}</span>
        </span>
        {selected && <Check size={16} className="mt-0.5 shrink-0 text-accent" />}
      </button>
    </li>
  );
}

export function ModelSettings({ project, compact }: { project: Project; compact?: boolean }) {
  const job = useProjectStore((s) => s.activeJob);
  const setProject = useProjectStore((s) => s.setProject);
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<{ default_model: string; models: ModelOption[] } | null>(null);
  const [query, setQuery] = useState('');
  const [freeOnly, setFreeOnly] = useState(false);
  const { busy, error, run } = useAction();

  useEffect(() => {
    void run(async () => setCatalog(await api.models()));
  }, [run]);

  const current = project.model_creative;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (catalog?.models ?? [])
      .filter((m) => (!freeOnly || m.free) && (!q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)));
  }, [catalog, query, freeOnly]);

  const pick = (model: string) =>
    void run(async () => {
      await api.setModel(project.id, model);
      setProject({ ...project, model_creative: model });
      setOpen(false);
    });

  const label = current || `${catalog?.default_model ?? '…'} (par défaut)`;

  return (
    <Card className={cn('space-y-2', compact && 'p-4')}>
      <h2 className={compact ? 'text-sm font-semibold' : 'font-semibold'}>Modèle de rédaction</h2>
      <p className="break-all text-sm">{label}</p>
      {!compact && <p className="text-sm text-muted">Il écrit le concept, la trame et les scènes de ce livre. Tu peux en changer à tout moment.</p>}
      <ErrorNote error={open ? null : error} />
      <Button size="sm" variant="secondary" disabled={job !== null} onClick={() => setOpen(true)}>Changer de modèle</Button>

      <Dialog open={open} onOpenChange={setOpen} title="Modèle de rédaction" description="Seuls les modèles compatibles avec Scribator sont listés. Le prix indique l'entrée puis la sortie." wide>
        <div className="space-y-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-3 text-muted" />
            <Input aria-label="Rechercher un modèle" className="pl-8" placeholder="claude, gemini, deepseek…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-[var(--color-accent)]" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} />
            Modèles gratuits uniquement
          </label>
          {freeOnly && <p className="text-xs text-muted">Les modèles gratuits ont un quota quotidien partagé par tout le serveur, et leur qualité varie beaucoup.</p>}
          <ErrorNote error={error} />
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {!query && !freeOnly && (
              <Option selected={!current} label="Modèle par défaut" detail={catalog?.default_model ?? ''} onPick={() => pick('')} disabled={busy} />
            )}
            {shown.slice(0, MAX_SHOWN).map((m) => (
              <Option
                key={m.id}
                selected={current === m.id}
                label={m.name}
                detail={`${m.id} · ${price(m)} · ${formatNumber(m.context_length)} tokens de contexte`}
                badge={m.free}
                onPick={() => pick(m.id)}
                disabled={busy}
              />
            ))}
          </ul>
          {shown.length > MAX_SHOWN && <p className="text-xs text-muted">{shown.length - MAX_SHOWN} autres modèles : affine ta recherche.</p>}
          {catalog && shown.length === 0 && <p className="text-sm text-muted">Aucun modèle ne correspond.</p>}
        </div>
      </Dialog>
    </Card>
  );
}
