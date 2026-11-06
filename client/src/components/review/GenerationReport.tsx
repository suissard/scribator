import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type GenerationReport as Report, type PurposeUsage } from '@/api/server';
import { Card } from '@/components/ui/card';
import { formatSeconds, formatUsd } from '@/lib/progress';
import { formatNumber } from '@/lib/utils';

const PURPOSES: Record<string, string> = {
  style_extract: 'Analyse du style',
  concept: 'Concept et Bible',
  outline: 'Trame',
  sample: 'Échantillon',
  scene_plan: 'Plans des scènes',
  scene_write: 'Rédaction des scènes',
  chapter_summary: 'Résumés de chapitre',
  style_learning: 'Apprentissage du style',
  synopsis_compress: 'Compression de la mémoire',
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Row({ label, usage, avg }: { label: string; usage: Omit<PurposeUsage, 'purpose' | 'avg_duration_ms'>; avg?: number }) {
  const cells = [
    formatNumber(usage.calls),
    formatSeconds(usage.duration_ms),
    avg === undefined ? '' : formatSeconds(avg),
    formatNumber(usage.input_tokens),
    formatNumber(usage.output_tokens),
    formatNumber(usage.cache_read_tokens),
    formatNumber(usage.cache_write_tokens),
    formatUsd(usage.cost_usd),
  ];
  return (
    <>
      <th scope="row" className="py-1.5 pr-3 text-left font-normal">{label}</th>
      {cells.map((c, i) => <td key={i} className="whitespace-nowrap py-1.5 pl-3 text-right tabular-nums">{c}</td>)}
    </>
  );
}

const HEADERS = ['Appels', 'Durée', 'Moyenne', 'Entrée', 'Sortie', 'Cache lu', 'Cache écrit', 'Coût'];

/** `refreshKey` : à changer quand une génération se termine. */
export function GenerationReport({ projectId, refreshKey }: { projectId: string; refreshKey: unknown }) {
  const [report, setReport] = useState<Report | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api.report(projectId).then(
      (r) => alive && setReport(r),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [projectId, refreshKey]);

  if (failed) return <Card><p className="text-sm text-muted">Le compte rendu n'a pas pu être chargé.</p></Card>;
  if (!report || report.totals.calls === 0) return null;
  const { totals } = report;
  const prompt = totals.input_tokens + totals.cache_read_tokens + totals.cache_write_tokens;
  const cacheShare = prompt > 0 ? Math.round((totals.cache_read_tokens / prompt) * 100) : 0;

  return (
    <Card className="space-y-4">
      <h2 className="font-semibold">Compte rendu de génération</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Coût total" value={formatUsd(totals.cost_usd)} />
        <Stat label="Temps de génération" value={formatSeconds(totals.duration_ms)} />
        <Stat label="Mots écrits" value={formatNumber(report.words)} />
        <Stat label="Coût pour 1 000 mots" value={report.cost_per_1000_words === null ? '–' : formatUsd(report.cost_per_1000_words)} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Détail par type d'appel, tokens compris</caption>
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th scope="col" className="py-1.5 pr-3 text-left font-medium">Tokens et durée par étape</th>
              {HEADERS.map((h) => <th key={h} scope="col" className="whitespace-nowrap py-1.5 pl-3 text-right font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {report.by_purpose.map((p) => (
              <tr key={p.purpose} className="border-b border-line/60">
                <Row label={PURPOSES[p.purpose] ?? p.purpose} usage={p} avg={p.avg_duration_ms} />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold"><Row label="Total" usage={totals} /></tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-muted">
        {cacheShare} % des tokens en entrée ont été lus depuis le cache.
        {totals.failed_calls > 0 && ` ${totals.failed_calls} appel${totals.failed_calls > 1 ? 's' : ''} interrompu${totals.failed_calls > 1 ? 's' : ''} ou en échec, comptés dans le coût.`}
      </p>
      {report.truncated_scenes > 0 && (
        <p className="flex items-center gap-2 text-sm text-stale">
          <AlertTriangle size={16} className="shrink-0" />
          {report.truncated_scenes > 1 ? `${report.truncated_scenes} scènes ont été tronquées` : 'Une scène a été tronquée'} par la limite de longueur : à relire dans le Studio.
        </p>
      )}
    </Card>
  );
}
