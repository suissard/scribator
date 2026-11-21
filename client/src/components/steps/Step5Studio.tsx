import { AlertTriangle, ArrowLeft, ArrowRight, Check, ListTree, PenLine, Play, RefreshCw, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/api/server';
import { SceneBlock } from '@/components/editor/SceneBlock';
import { ModelSettings } from '@/components/ModelSettings';
import { PendingChangeCard } from '@/components/review/PendingChangeCard';
import { AutoWriteCard } from '@/components/steps/AutoWriteCard';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { flushAllAutosaves } from '@/lib/autosaveRegistry';
import { canWriteAll } from '@/lib/bookWork';
import { toastError, toastSuccess } from '@/lib/toast';
import type { Chapter, ChapterStatus, Project } from '@/lib/types';
import { useAction } from '@/lib/useAction';
import { cn, countWords, formatNumber } from '@/lib/utils';
import { useProjectStore } from '@/store/useProjectStore';

const STATUS: Record<ChapterStatus, { label: string; className: string }> = {
  PENDING: { label: 'À planifier', className: 'bg-surface text-muted' },
  PLANNED: { label: 'Planifié', className: 'bg-surface text-ink' },
  GENERATING: { label: 'Écriture…', className: 'bg-accent-soft text-accent' },
  REVIEW: { label: 'À relire', className: 'bg-accent text-white' },
  APPROVED: { label: 'Validé', className: 'bg-ok-soft text-ok' },
  STALE: { label: 'À recalculer', className: 'bg-stale/15 text-stale' },
  ERROR: { label: 'Erreur', className: 'bg-danger-soft text-danger' },
};

export function Step5Studio({ project }: { project: Project }) {
  const chapters = useProjectStore((s) => s.chapters);
  const scenes = useProjectStore((s) => s.scenes);
  const changes = useProjectStore((s) => s.changes);
  const job = useProjectStore((s) => s.activeJob);
  const activeId = useProjectStore((s) => s.activeChapterId);
  const setActive = useProjectStore((s) => s.setActiveChapter);
  const setStep = useProjectStore((s) => s.setStep);
  const loadScenes = useProjectStore((s) => s.loadScenes);
  const upsertChange = useProjectStore((s) => s.upsertChange);
  const [confirmRewrite, setConfirmRewrite] = useState(false);
  const { busy, doing, error, run } = useAction();

  useEffect(() => {
    if (activeId && chapters.some((c) => c.id === activeId)) return;
    const next = chapters.find((c) => c.status !== 'APPROVED') ?? chapters[0];
    if (next) setActive(next.id);
  }, [activeId, chapters, setActive]);

  useEffect(() => {
    if (activeId) loadScenes(activeId).catch(() => toastError('Impossible de charger les scènes de ce chapitre.'));
  }, [activeId, loadScenes]);

  // L'écriture automatique emmène le lecteur avec elle, sauf s'il est parti lire un autre chapitre.
  const followed = useRef('');
  const writingId = job?.kind === 'BOOK' ? job.progress?.chapter_id : '';
  useEffect(() => {
    if (!writingId || writingId === followed.current) return;
    const wasFollowing = !followed.current || followed.current === activeId;
    followed.current = writingId;
    if (wasFollowing) setActive(writingId);
  }, [writingId, activeId, setActive]);

  const index = chapters.findIndex((c) => c.id === activeId);
  const chapter = chapters[index];
  const previous = index > 0 ? chapters[index - 1] : undefined;
  const nextChapter = index >= 0 && index < chapters.length - 1 ? chapters[index + 1] : undefined;
  const words = scenes.reduce((n, s) => n + countWords(s.content), 0);
  const bible = project.story_bible;
  const running = job !== null;

  const blocked = Boolean(previous && previous.status !== 'APPROVED');
  const hasPendingScenes = scenes.some((s) => s.status === 'PENDING');
  const hasWrittenScene = scenes.some((s) => s.status === 'REVIEW');
  const allReview = scenes.length > 0 && scenes.every((s) => s.status === 'REVIEW');
  const allApproved = chapters.length > 0 && chapters.every((c) => c.status === 'APPROVED');

  const act = (name: string, fn: () => Promise<unknown>) =>
    void run(async () => {
      await flushAllAutosaves();
      await fn();
    }, name);

  const chapterPct = chapter?.target_words ? Math.min(100, Math.round((words / chapter.target_words) * 100)) : 0;

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[15rem_minmax(0,1fr)_19rem]">
      <aside aria-label="Chapitres" className="lg:sticky lg:top-28 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
        <ul className="flex gap-1.5 overflow-x-auto lg:block lg:space-y-1">
          {chapters.map((c) => (
            <li key={c.id} className="shrink-0">
              <button
                type="button"
                aria-current={c.id === activeId ? 'true' : undefined}
                onClick={() => setActive(c.id)}
                className={cn(
                  'w-full cursor-pointer rounded-md border px-3 py-2 text-left text-sm transition-colors',
                  c.id === activeId ? 'border-accent/40 bg-accent-soft' : 'border-transparent hover:bg-accent-soft/50',
                )}
              >
                <span className="line-clamp-1 font-medium">
                  {c.chapter_number}. {c.title}
                </span>
                <Badge className={cn('mt-1', STATUS[c.status].className)}>{STATUS[c.status].label}</Badge>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="min-w-0 space-y-4">
        {project.status === 'STEP_5_WRITING' && !job && canWriteAll(chapters) && <AutoWriteCard project={project} />}

        {chapter && (
          <>
            <header className="space-y-2 border-b border-line pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge className={STATUS[chapter.status].className}>{STATUS[chapter.status].label}</Badge>
                {chapter.status === 'APPROVED' && (
                  <Button variant="secondary" size="sm" disabled={busy || running} onClick={() => act('reopen', () => api.reopenChapter(chapter.id))}>
                    <RotateCcw size={14} /> Modifier ce chapitre
                  </Button>
                )}
                {chapter.status === 'REVIEW' && allReview && !blocked && (
                  <Button variant="ghost" size="sm" disabled={busy || running} onClick={() => setConfirmRewrite(true)}>
                    <RefreshCw size={14} /> Réécrire le chapitre
                  </Button>
                )}
              </div>
              <h2 className="font-serif text-2xl font-semibold">
                {chapter.chapter_number}. {chapter.title}
              </h2>
              <p className="text-sm text-muted">{chapter.brief_summary}</p>
            </header>

            <ErrorNote error={error} />

            {blocked && previous && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-accent-soft p-3 text-sm text-accent">
                <span>Validez d'abord le chapitre {previous.chapter_number} pour garder la cohérence du récit.</span>
                <Button variant="secondary" size="sm" onClick={() => setActive(previous.id)}>
                  <ArrowLeft size={14} /> Chapitre {previous.chapter_number}
                </Button>
              </div>
            )}

            {chapter.status === 'STALE' && (
              <div className="space-y-2 rounded-md border border-stale/35 bg-stale/10 p-3 text-sm text-stale">
                <p className="flex items-center gap-2 font-medium">
                  <AlertTriangle size={16} className="shrink-0" />
                  <span>{chapter.stale_reason}. Sa mémoire peut ne plus être à jour.</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy || running}
                    loading={doing === 'refresh'}
                    onClick={() =>
                      act('refresh', async () => {
                        await api.refreshMemory(chapter.id);
                        toastSuccess('Mémoire recalculée.');
                      })
                    }
                  >
                    Recalculer la mémoire
                  </Button>
                  <Button variant="secondary" size="sm" disabled={busy || running} onClick={() => act('reopen', () => api.reopenChapter(chapter.id))}>
                    <RotateCcw size={14} /> Modifier ce chapitre
                  </Button>
                  <Button variant="ghost" size="sm" disabled={busy || running} onClick={() => act('ignore', () => api.ignoreStale(chapter.id))}>
                    Ignorer
                  </Button>
                </div>
              </div>
            )}

            {!blocked && ['PENDING', 'PLANNED', 'ERROR'].includes(chapter.status) && (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" disabled={busy || running} loading={doing === 'plan'} onClick={() => act('plan', () => api.planScenes(chapter.id))}>
                  {doing !== 'plan' && <ListTree size={16} />} {hasPendingScenes ? 'Replanifier les scènes' : 'Planifier les scènes'}
                </Button>
                <Button variant="primary" disabled={busy || running} onClick={() => act('write', () => api.writeChapter(chapter.id))}>
                  <PenLine size={16} /> Écrire le chapitre
                </Button>
              </div>
            )}

            {scenes.map((s) => (
              // Une réécriture change le plan d'une scène existante : le champ doit repartir du nouveau.
              <SceneBlock key={`${s.id}:${s.status}`} scene={s} locked={job !== null} />
            ))}
            {scenes.length === 0 && <p className="text-sm text-muted">Aucune scène pour l'instant.</p>}

            {!blocked && (chapter.status === 'PLANNED' || (chapter.status === 'REVIEW' && hasPendingScenes)) && scenes.length > 0 && (
              <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card/95 p-3 shadow-md backdrop-blur">
                <Button variant="secondary" disabled={busy || running} loading={doing === 'plan'} onClick={() => act('plan', () => api.planScenes(chapter.id))}>
                  {doing !== 'plan' && <ListTree size={16} />} Replanifier les scènes
                </Button>
                <Button variant="primary" size="lg" disabled={busy || running} onClick={() => act('write', () => api.writeChapter(chapter.id))}>
                  {hasWrittenScene ? <Play size={16} /> : <PenLine size={16} />}
                  {hasWrittenScene ? "Reprendre l'écriture" : 'Écrire le chapitre'}
                </Button>
              </div>
            )}

            {chapter.status === 'REVIEW' && allReview && (
              <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card/95 p-3 shadow-md backdrop-blur">
                <div>
                  {!blocked && (
                    <Button variant="secondary" disabled={busy || running} onClick={() => setConfirmRewrite(true)}>
                      <RefreshCw size={15} /> Réécrire le chapitre
                    </Button>
                  )}
                </div>
                <Button
                  variant="success"
                  size="lg"
                  disabled={busy || running}
                  loading={doing === 'approve'}
                  onClick={() =>
                    act('approve', async () => {
                      await api.approveChapter(chapter.id);
                      toastSuccess(`Chapitre ${chapter.chapter_number} validé !`);
                      if (nextChapter) setActive(nextChapter.id);
                    })
                  }
                >
                  {doing !== 'approve' && <Check size={18} />}
                  {doing === 'approve' ? 'Validation…' : 'Valider le chapitre'}
                </Button>
              </div>
            )}

            {chapter.status === 'APPROVED' && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                <div>
                  {previous && (
                    <Button variant="secondary" size="sm" onClick={() => setActive(previous.id)}>
                      <ArrowLeft size={14} /> Chapitre {previous.chapter_number}
                    </Button>
                  )}
                </div>
                {nextChapter ? (
                  <Button
                    variant={nextChapter.status !== 'APPROVED' ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => setActive(nextChapter.id)}
                  >
                    Chapitre {nextChapter.chapter_number} <ArrowRight size={14} />
                  </Button>
                ) : (
                  allApproved && (
                    <Button variant="primary" size="md" onClick={() => setStep(6)}>
                      Exporter le livre <ArrowRight size={15} />
                    </Button>
                  )
                )}
              </div>
            )}
          </>
        )}
      </section>

      <aside aria-label="Mémoire du livre" className="space-y-4 lg:sticky lg:top-28 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
        {changes.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Propositions en attente</h3>
              <Badge>{changes.length}</Badge>
            </div>
            {changes.map((c) => (
              <PendingChangeCard
                key={c.id}
                change={c}
                bible={bible}
                onDone={(id) => upsertChange({ ...c, id, status: 'ACCEPTED' })}
              />
            ))}
          </div>
        )}

        {chapter && (
          <Card className="space-y-2 p-4">
            <p className="text-xs text-muted">Mots du chapitre</p>
            <p className="tabular-nums">
              <span className="text-xl font-semibold">{formatNumber(words)}</span> / {formatNumber(chapter.target_words)}
            </p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface" aria-hidden="true">
              <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${chapterPct}%` }} />
            </div>
          </Card>
        )}

        {bible && (
          <Card className="space-y-3 p-4 text-sm">
            <h3 className="font-semibold">Bible</h3>
            <ul className="space-y-2">
              {bible.characters.map((c) => (
                <li key={c.id}>
                  <strong>{c.name}</strong> <span className="text-muted">· {c.current_status}</span>
                </li>
              ))}
            </ul>
            {bible.locations.length > 0 && <p className="text-muted">Lieux : {bible.locations.map((l) => l.name).join(', ')}</p>}
          </Card>
        )}

        <ModelSettings project={project} compact />
      </aside>

      <Dialog
        open={confirmRewrite}
        onOpenChange={setConfirmRewrite}
        title="Réécrire tout le chapitre ?"
        description="Un nouveau plan remplace les scènes actuelles, puis chaque scène est réécrite. Les anciens textes restent dans l'historique des scènes."
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmRewrite(false)}>
            Annuler
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (!chapter) return;
              setConfirmRewrite(false);
              act('rewrite', () => api.rewriteChapter(chapter.id));
            }}
          >
            Réécrire
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
