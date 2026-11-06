import { AlertTriangle, Check, ListTree, PenLine, RefreshCw, RotateCcw } from 'lucide-react';
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
import type { Chapter, ChapterStatus, Project } from '@/lib/types';
import { useAction } from '@/lib/useAction';
import { cn, countWords, formatNumber } from '@/lib/utils';
import { useProjectStore } from '@/store/useProjectStore';

const STATUS: Record<ChapterStatus, { label: string; className: string }> = {
  PENDING: { label: 'À planifier', className: 'bg-line text-muted' },
  PLANNED: { label: 'Planifié', className: 'bg-line text-ink' },
  GENERATING: { label: 'Écriture…', className: 'bg-accent-soft text-accent' },
  REVIEW: { label: 'À relire', className: 'bg-accent text-white' },
  APPROVED: { label: 'Validé', className: 'bg-ok/10 text-ok' },
  STALE: { label: 'À recalculer', className: 'bg-stale/15 text-stale' },
  ERROR: { label: 'Erreur', className: 'bg-danger/10 text-danger' },
};

function ChapterActions({ chapter, previous }: { chapter: Chapter; previous: Chapter | undefined }) {
  const scenes = useProjectStore((s) => s.scenes);
  const job = useProjectStore((s) => s.activeJob);
  const { busy, doing, error, run } = useAction();
  const [confirmRewrite, setConfirmRewrite] = useState(false);
  const running = job !== null;
  const blocked = previous && previous.status !== 'APPROVED';
  const hasPendingScenes = scenes.some((s) => s.status === 'PENDING');
  const allReview = scenes.length > 0 && scenes.every((s) => s.status === 'REVIEW');
  const act = (name: string, fn: () => Promise<unknown>) =>
    void run(async () => {
      await flushAllAutosaves();
      await fn();
    }, name);

  return (
    <div className="space-y-2">
      <ErrorNote error={error} />
      {blocked && <p className="text-sm text-muted">Valide d'abord le chapitre {previous.chapter_number}.</p>}
      <div className="flex flex-wrap gap-2">
        {['PENDING', 'PLANNED', 'ERROR', 'REVIEW'].includes(chapter.status) && !blocked && (chapter.status !== 'REVIEW' || hasPendingScenes) && (
          <>
            <Button variant="secondary" disabled={busy || running} loading={doing === 'plan'} onClick={() => act('plan', () => api.planScenes(chapter.id))}>
              {doing !== 'plan' && <ListTree size={16} />} {hasPendingScenes ? 'Replanifier les scènes' : 'Planifier les scènes'}
            </Button>
            <Button disabled={busy || running} onClick={() => act('write', () => api.writeChapter(chapter.id))}>
              <PenLine size={16} /> Écrire le chapitre
            </Button>
          </>
        )}
        {chapter.status === 'REVIEW' && (
          <Button disabled={busy || running || !allReview} loading={doing === 'approve'} onClick={() => act('approve', () => api.approveChapter(chapter.id))}>
            {doing !== 'approve' && <Check size={16} />} {doing === 'approve' ? 'Validation…' : 'Valider le chapitre'}
          </Button>
        )}
        {chapter.status === 'REVIEW' && !blocked && (
          <Button variant="secondary" disabled={busy || running} onClick={() => setConfirmRewrite(true)}>
            <RefreshCw size={16} /> Réécrire le chapitre
          </Button>
        )}
        {(chapter.status === 'APPROVED' || chapter.status === 'STALE') && (
          <Button variant="secondary" disabled={busy || running} onClick={() => act('reopen', () => api.reopenChapter(chapter.id))}>
            <RotateCcw size={16} /> Modifier ce chapitre
          </Button>
        )}
        {chapter.status === 'STALE' && (
          <>
            <Button disabled={busy || running} loading={doing === 'refresh'} onClick={() => act('refresh', () => api.refreshMemory(chapter.id))}>Recalculer la mémoire</Button>
            <Button variant="ghost" disabled={busy || running} onClick={() => act('ignore', () => api.ignoreStale(chapter.id))}>Ignorer</Button>
          </>
        )}
      </div>
      <Dialog open={confirmRewrite} onOpenChange={setConfirmRewrite} title="Réécrire tout le chapitre ?" description="Un nouveau plan remplace les scènes actuelles, puis chaque scène est réécrite. Les anciens textes restent dans l'historique des scènes.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmRewrite(false)}>Annuler</Button>
          <Button
            onClick={() => {
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

export function Step5Studio({ project }: { project: Project }) {
  const chapters = useProjectStore((s) => s.chapters);
  const scenes = useProjectStore((s) => s.scenes);
  const changes = useProjectStore((s) => s.changes);
  const job = useProjectStore((s) => s.activeJob);
  const activeId = useProjectStore((s) => s.activeChapterId);
  const setActive = useProjectStore((s) => s.setActiveChapter);
  const loadScenes = useProjectStore((s) => s.loadScenes);
  const upsertChange = useProjectStore((s) => s.upsertChange);

  useEffect(() => {
    if (activeId && chapters.some((c) => c.id === activeId)) return;
    const next = chapters.find((c) => c.status !== 'APPROVED') ?? chapters[0];
    if (next) setActive(next.id);
  }, [activeId, chapters, setActive]);

  useEffect(() => {
    if (activeId) void loadScenes(activeId);
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
  const words = scenes.reduce((n, s) => n + countWords(s.content), 0);
  const bible = project.story_bible;

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[15rem_minmax(0,1fr)_19rem]">
      <aside aria-label="Chapitres" className="lg:sticky lg:top-28 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
        <ul className="flex gap-1 overflow-x-auto lg:block lg:space-y-1">
          {chapters.map((c) => (
            <li key={c.id} className="shrink-0">
              <button
                type="button"
                aria-current={c.id === activeId ? 'true' : undefined}
                onClick={() => setActive(c.id)}
                className={cn('w-full cursor-pointer rounded-md px-3 py-2 text-left text-sm', c.id === activeId ? 'bg-accent-soft' : 'hover:bg-accent-soft/50')}
              >
                <span className="line-clamp-1 font-medium">{c.chapter_number}. {c.title}</span>
                <Badge className={cn('mt-1', STATUS[c.status].className)}>{STATUS[c.status].label}</Badge>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="min-w-0 space-y-4">
        {project.status === 'STEP_5_WRITING' && !job && chapters.some((c) => c.status !== 'APPROVED') && <AutoWriteCard project={project} />}
        {chapter && (
          <>
            <header>
              <h2 className="font-serif text-2xl font-semibold">{chapter.chapter_number}. {chapter.title}</h2>
              <p className="mt-1 text-sm text-muted">{chapter.brief_summary}</p>
            </header>
            {chapter.status === 'STALE' && (
              <p className="flex items-center gap-2 rounded-md bg-stale/10 p-3 text-sm text-stale">
                <AlertTriangle size={16} /> {chapter.stale_reason}. Sa mémoire peut ne plus être à jour.
              </p>
            )}
            <ChapterActions chapter={chapter} previous={chapters[index - 1]} />
            {scenes.map((s) => (
              // Une réécriture change le plan d'une scène existante : le champ doit repartir du nouveau.
              <SceneBlock key={`${s.id}:${s.status}`} scene={s} locked={job !== null} />
            ))}
            {scenes.length === 0 && <p className="text-sm text-muted">Aucune scène pour l'instant.</p>}
          </>
        )}
      </section>

      <aside aria-label="Mémoire du livre" className="space-y-4">
        {chapter && (
          <Card className="p-4">
            <p className="text-xs text-muted">Mots du chapitre</p>
            <p className="tabular-nums"><span className="text-xl font-semibold">{formatNumber(words)}</span> / {formatNumber(chapter.target_words)}</p>
          </Card>
        )}
        <ModelSettings project={project} compact />
        {changes.map((c) => (
          <PendingChangeCard key={c.id} change={c} onDone={(id) => upsertChange({ ...c, id, status: 'ACCEPTED' })} />
        ))}
        {bible && (
          <Card className="space-y-3 p-4 text-sm">
            <h3 className="font-semibold">Bible</h3>
            <ul className="space-y-2">
              {bible.characters.map((c) => (
                <li key={c.id}><strong>{c.name}</strong> <span className="text-muted">· {c.current_status}</span></li>
              ))}
            </ul>
            {bible.locations.length > 0 && <p className="text-muted">Lieux : {bible.locations.map((l) => l.name).join(', ')}</p>}
          </Card>
        )}
      </aside>
    </div>
  );
}
