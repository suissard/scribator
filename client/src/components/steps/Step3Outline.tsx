import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowRight, GripVertical, Lock, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { pb } from '@/api/pocketbase';
import { api } from '@/api/server';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { Field, Input, Textarea } from '@/components/ui/field';
import { flushAllAutosaves } from '@/lib/autosaveRegistry';
import { toastSuccess } from '@/lib/toast';
import type { Chapter, Project } from '@/lib/types';
import { useAction } from '@/lib/useAction';
import { useAutoSave } from '@/lib/useAutoSave';
import { formatNumber } from '@/lib/utils';
import { useProjectStore } from '@/store/useProjectStore';

type Edit = Partial<Pick<Chapter, 'title' | 'brief_summary' | 'target_words'>>;

function ChapterCard({
  chapter,
  lockedByJob,
  onDeleteRequest,
  onUnprotect,
}: {
  chapter: Chapter;
  lockedByJob: boolean;
  onDeleteRequest(chapter: Chapter): void;
  onUnprotect(chapter: Chapter): void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: chapter.id,
    disabled: chapter.status !== 'PENDING' || lockedByJob,
  });
  const [form, setForm] = useState({
    title: chapter.title,
    brief_summary: chapter.brief_summary,
    target_words: chapter.target_words,
  });
  const save = useAutoSave<Edit>((data) => pb.collection('chapters').update(chapter.id, data));
  const pending = chapter.status === 'PENDING';

  useEffect(() => {
    setForm({ title: chapter.title, brief_summary: chapter.brief_summary, target_words: chapter.target_words });
  }, [chapter.title, chapter.brief_summary, chapter.target_words]);

  const edit = (patch: Edit, outline = true) => {
    const next = { ...form, ...patch };
    setForm(next);
    save({ ...next, ...(outline ? { user_edited_outline: true } : {}) } as Edit);
  };

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <Card className="flex gap-3 p-4">
        {pending ? (
          <button
            type="button"
            aria-label={`Déplacer le chapitre ${chapter.chapter_number}`}
            className="cursor-grab touch-none self-start text-muted hover:text-ink"
            {...attributes}
            {...listeners}
          >
            <GripVertical size={18} />
          </button>
        ) : (
          <span className="w-[18px]" />
        )}
        <div className="flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold tabular-nums">{chapter.chapter_number}.</span>
            <Input aria-label="Titre du chapitre" className="h-9 min-w-44 flex-1" value={form.title} onChange={(e) => edit({ title: e.target.value })} />
            {!pending ? (
              <Badge className="bg-surface text-muted" title="Ce chapitre a déjà commencé à être rédigé">
                <Lock size={11} /> Déjà engagé
              </Badge>
            ) : (
              chapter.user_edited_outline && (
                <button
                  type="button"
                  onClick={() => onUnprotect(chapter)}
                  title="Chapitre retouché manuellement : conservé si vous régénérez la trame. Cliquez pour retirer la protection."
                  className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent hover:bg-accent/15"
                >
                  <ShieldCheck size={12} /> Protégé
                </button>
              )
            )}
          </div>
          <Textarea aria-label="Résumé du chapitre" className="min-h-16" value={form.brief_summary} onChange={(e) => edit({ brief_summary: e.target.value })} />
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs text-muted">
              Mots visés
              <Input
                aria-label="Mots visés"
                type="number"
                min={100}
                className="h-8 w-24"
                value={form.target_words}
                onChange={(e) => edit({ target_words: Number(e.target.value) }, false)}
              />
            </label>
            {pending && (
              <Button
                variant="ghost"
                size="icon"
                className="text-muted hover:bg-danger/10 hover:text-danger"
                disabled={lockedByJob}
                aria-label={`Supprimer le chapitre ${chapter.chapter_number}`}
                onClick={() => onDeleteRequest(chapter)}
              >
                <Trash2 size={15} />
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

export function Step3Outline({ project }: { project: Project }) {
  const chapters = useProjectStore((s) => s.chapters);
  const load = useProjectStore((s) => s.loadChapters);
  const job = useProjectStore((s) => s.activeJob);
  const [feedback, setFeedback] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [regenOpen, setRegenOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Chapter | null>(null);
  const { busy, doing, error, run } = useAction();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const running = job !== null;
  const totalWords = chapters.reduce((sum, c) => sum + (c.target_words || 0), 0);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const pending = chapters.filter((c) => c.status === 'PENDING').map((c) => c.id);
    const from = pending.indexOf(String(active.id));
    const to = pending.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    void run(async () => {
      await api.reorder(project.id, arrayMove(pending, from, to));
      await load();
    });
  };

  const unprotect = (chapter: Chapter) => {
    void run(async () => {
      await flushAllAutosaves();
      await pb.collection('chapters').update(chapter.id, { user_edited_outline: false });
      await load();
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <Card className="flex flex-wrap items-center justify-between gap-2 p-4">
        <span className="text-sm font-semibold tabular-nums">
          {chapters.length} {chapters.length > 1 ? 'chapitres' : 'chapitre'} · {formatNumber(totalWords)} mots visés
        </span>
        <span className="text-xs text-muted">
          Glissez les chapitres pour les réordonner. Les chapitres « Protégé » sont conservés lors d'une régénération.
        </span>
      </Card>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={chapters.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {chapters.map((c) => (
              <ChapterCard
                key={c.id}
                chapter={c}
                lockedByJob={busy || running}
                onDeleteRequest={setToDelete}
                onUnprotect={unprotect}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newTitle.trim()) return;
          void run(async () => {
            await flushAllAutosaves();
            await api.addChapter(project.id, newTitle.trim());
            setNewTitle('');
            await load();
            toastSuccess('Chapitre ajouté.');
          });
        }}
      >
        <Input
          aria-label="Titre du nouveau chapitre"
          placeholder="Titre d'un nouveau chapitre"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
        />
        <Button type="submit" variant="secondary" disabled={busy || !newTitle.trim()}>
          <Plus size={14} /> Ajouter
        </Button>
      </form>

      <ErrorNote error={error} />

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card/95 p-3 shadow-md backdrop-blur">
        <Button variant="secondary" disabled={busy || running} onClick={() => setRegenOpen(true)}>
          <RefreshCw size={15} /> Régénérer la trame…
        </Button>
        <Button
          variant="primary"
          disabled={busy || running || chapters.length === 0}
          onClick={() =>
            void run(async () => {
              await flushAllAutosaves();
              await api.sample(project.id);
            })
          }
        >
          Rédiger l'échantillon <ArrowRight size={16} />
        </Button>
      </div>

      <Dialog
        open={regenOpen}
        onOpenChange={setRegenOpen}
        title="Régénérer la trame ?"
        description="Les chapitres protégés ou déjà engagés sont conservés et servent de contraintes."
      >
        <div className="space-y-4">
          <Field label="Votre retour (facultatif)">
            <Textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Plus de tension au milieu, développer tel personnage…"
            />
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setRegenOpen(false)}>
              Annuler
            </Button>
            <Button
              variant="primary"
              disabled={busy || running}
              loading={doing === 'outline'}
              onClick={() => {
                setRegenOpen(false);
                void run(async () => {
                  await flushAllAutosaves();
                  await api.outline(project.id, feedback.trim() || undefined);
                  setFeedback('');
                }, 'outline');
              }}
            >
              {doing !== 'outline' && <RefreshCw size={15} />} Régénérer la trame
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={toDelete !== null}
        onOpenChange={() => setToDelete(null)}
        title={`Supprimer le chapitre ${toDelete?.chapter_number ?? ''} ?`}
        description={`« ${toDelete?.title ?? ''} » sera supprimé de la trame.`}
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setToDelete(null)}>
            Annuler
          </Button>
          <Button
            variant="dangerSolid"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await flushAllAutosaves();
                await api.deleteChapter(toDelete!.id);
                setToDelete(null);
                await load();
                toastSuccess('Chapitre supprimé.');
              })
            }
          >
            Supprimer
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
