import { KeyRound, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type Usage } from '@/api/server';
import { cn } from '@/lib/utils';
import { KEY_UPDATED_EVENT } from './OpenRouterKeySection';

export function UsageBadge({ refreshKey }: { refreshKey?: unknown }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.usage().then((u) => alive && setUsage(u)).catch(() => {});
    void load();
    const t = setInterval(load, 60_000);
    window.addEventListener(KEY_UPDATED_EVENT, load);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener(KEY_UPDATED_EVENT, load);
    };
  }, [refreshKey]);
  if (!usage) return null;
  if (usage.using_own_key) {
    return (
      <span
        title="Coût estimé de vos appels IA ce mois-ci avec votre clé OpenRouter personnelle"
        className="inline-flex items-center gap-1.5 text-xs tabular-nums text-muted"
      >
        <KeyRound size={14} className="text-ok" />
        {usage.spent_usd.toFixed(2)} $ (clé perso)
      </span>
    );
  }
  const ratio = usage.budget_usd > 0 ? usage.spent_usd / usage.budget_usd : 1;
  return (
    <span
      title="Coût des appels IA ce mois-ci, sur votre budget mensuel"
      className={cn('inline-flex items-center gap-1.5 text-xs tabular-nums', ratio >= 0.8 ? 'font-medium text-stale' : 'text-muted')}
    >
      <Wallet size={14} />
      {usage.spent_usd.toFixed(2)} $ / {usage.budget_usd.toFixed(2)} $
    </span>
  );
}
