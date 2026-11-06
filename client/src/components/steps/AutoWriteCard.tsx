import { Wand2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type BookEstimate } from '@/api/server';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { flushAllAutosaves } from '@/lib/autosaveRegistry';
import { formatDuration, formatTokens, formatUsd } from '@/lib/progress';
import type { Project } from '@/lib/types';
import { useAction } from '@/lib/useAction';
import { useProjectStore } from '@/store/useProjectStore';

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

/** Proposée dès l'échantillon validé. L'estimation se recalcule quand l'état des chapitres change. */
export function AutoWriteCard({ project }: { project: Project }) {
  const chaptersKey = useProjectStore((s) => s.chapters.map((c) => c.status).join());
  const pendingChanges = useProjectStore((s) => s.changes.length);
  const [estimate, setEstimate] = useState<BookEstimate | null>(null);
  const [asking, setAsking] = useState(false);
  const { busy, doing, error, run } = useAction();

  useEffect(() => {
    let alive = true;
    api.estimate(project.id).then((e) => alive && setEstimate(e)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [project.id, chaptersKey]);

  const free = estimate !== null && estimate.cost_high_usd === 0;
  const overBudget = estimate !== null && estimate.cost_high_usd > estimate.budget_left_usd;
  return (
    <Card className="space-y-3 border-accent/30">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">Écrire la suite automatiquement</h3>
          {estimate ? (
            <>
              <p className="mt-0.5 text-sm tabular-nums text-muted">
                {plural(estimate.chapters, 'chapitre')}{estimate.rewrites > 0 && ` dont ${estimate.rewrites} à refaire`} · {plural(estimate.scenes, 'scène')} · environ {formatDuration(estimate.duration_ms)}
              </p>
              <p className="text-sm tabular-nums text-muted">
                {free ? 'Gratuit' : <>Entre <strong className="font-semibold text-ink">{formatUsd(estimate.cost_low_usd)}</strong> et <strong className="font-semibold text-ink">{formatUsd(estimate.cost_high_usd)}</strong></>}
                {' '}· environ {formatTokens(estimate.input_tokens)} tokens en entrée, {formatTokens(estimate.output_tokens)} en sortie
              </p>
            </>
          ) : (
            <p className="mt-0.5 text-sm text-muted">Calcul de l'estimation…</p>
          )}
        </div>
        <Button disabled={busy} loading={doing === 'start'} onClick={() => setAsking(true)}>
          <Wand2 size={16} /> Tout écrire
        </Button>
      </div>
      {overBudget && (
        <p className="text-sm text-stale">
          {estimate.cost_low_usd > estimate.budget_left_usd ? 'Cette estimation dépasse' : 'Le haut de cette fourchette dépasse'} ce qu'il reste de ton budget du mois ({formatUsd(estimate.budget_left_usd)}). L'écriture s'arrêtera une fois le budget atteint, et les chapitres déjà validés seront conservés.
        </p>
      )}
      <ErrorNote error={error} />
      <Dialog open={asking} onOpenChange={setAsking} title="Écrire tout le reste du livre ?">
        <div className="space-y-3 text-sm">
          <ul className="list-disc space-y-1 pl-5">
            <li>Chaque chapitre est écrit puis validé sans relecture. Les chapitres déjà validés ne changent pas.</li>
            {estimate && estimate.rewrites > 0 && (
              <li><strong className="font-semibold">{estimate.rewrites > 1 ? `${estimate.rewrites} chapitres écrits mais non validés seront entièrement refaits` : 'Un chapitre écrit mais non validé sera entièrement refait'}</strong>, tes corrections comprises. Les anciens textes restent dans l'historique des scènes.</li>
            )}
            <li>La Bible se met à jour toute seule. Les versions précédentes restent dans l'historique.</li>
            <li>Tu peux arrêter à tout moment et reprendre ensuite. Un chapitre validé peut toujours être rouvert.</li>
          </ul>
          {estimate && !free && (
            <p className="text-muted">
              Prix calculé pour {estimate.model}, d'après la longueur visée. Le bas de la fourchette suppose que le cache fonctionne ; le haut, qu'il ne sert pas et que le modèle réfléchit beaucoup.
            </p>
          )}
          {pendingChanges > 0 && (
            <p className="text-stale">
              {pendingChanges > 1 ? `${pendingChanges} propositions attendent` : 'Une proposition attend'} ta décision. Traite-les d'abord si tu veux qu'elles s'appliquent à la suite.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAsking(false)}>Annuler</Button>
            <Button
              onClick={() => {
                setAsking(false);
                void run(async () => {
                  await flushAllAutosaves();
                  await api.writeAll(project.id);
                }, 'start');
              }}
            >
              Lancer l'écriture
            </Button>
          </div>
        </div>
      </Dialog>
    </Card>
  );
}
