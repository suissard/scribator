import { Check, Copy, ScrollText } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { formatLogs, logStore } from '@/lib/logger';
import { cn } from '@/lib/utils';

export function LogPanel() {
  const entries = useSyncExternalStore(logStore.subscribe, logStore.snapshot);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const problems = entries.filter((e) => e.level !== 'info').length;

  const copy = async () => {
    await navigator.clipboard.writeText(formatLogs(entries));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <Button variant="ghost" size="icon" className="relative" aria-label="Ouvrir le journal" title="Journal" onClick={() => setOpen(true)}>
        <ScrollText size={16} />
        {problems > 0 && <span aria-hidden="true" className="absolute right-1 top-1 h-2 w-2 rounded-full bg-danger" />}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Journal" description="Ce qui s'est passé dans cet onglet. À copier pour signaler un problème." wide>
        <div className="space-y-3">
          <Button size="sm" variant="secondary" disabled={entries.length === 0} onClick={() => void copy()}>
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copié' : 'Copier le journal'}
          </Button>
          {entries.length === 0 && <p className="text-sm text-muted">Rien pour l'instant.</p>}
          <ul className="max-h-96 space-y-1 overflow-y-auto font-mono text-xs">
            {[...entries].reverse().map((e) => (
              <li key={e.id} className={cn('break-words', e.level === 'error' && 'text-danger', e.level === 'warn' && 'text-stale')}>
                <span className="text-muted">{e.time.slice(11, 19)}</span> {e.message}
                {e.context && <span className="text-muted"> {JSON.stringify(e.context)}</span>}
              </li>
            ))}
          </ul>
        </div>
      </Dialog>
    </>
  );
}
