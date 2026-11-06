import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowRight, GripVertical, Lock, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { pb } from '@/api/pocketbase';
import { api } from '@/api/server';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { Field, Input, Textarea } from '@/components/ui/field';
import { flushAllAutosaves } from '@/lib/autosaveRegistry';
import type { Chapter, Project } from '@/lib/types';
import { useAction } from '@/lib/useAction';
import { useAutoSave } from '@/lib/useAutoSave';
import { useProjectStore } from '@/store/useProjectStore';

type Edit = Partial<Pick<Chapter, 'title' | 'brief_summary' | 'target_words'>>;

function ChapterCard({ chapter, onError }: { chapter: Chapter; onError(run: () => Promise<unknown>): void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: chapter.id, disabled: chapter.status !== 'PENDING' });
  const [form, setForm] = useState({ title: chapter.title, brief_summary: chapter.brief_summary, target_words: chapter.target_words });
  const save = useAutoSave<Edit>((data) => pb.collection('chapters').update(chapter.id, data));
  const pending = chapter.status === 'PENDING';
  const locked = !pending || chapter.user_edited_outline;

  const edit = (patch: Edit, outline = true) => {
    const next = { ...form, ...patch };
    setForm(next);
    save({ ...next, ...(outline ? { user_edited_outline: true } : {}) } as Edit);
  };

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <Card className="flex gap-3 p-4">
        {pending ? (
          <button type="button" aria-label={`Déplacer le chapitre ${chapter.chapter_number}`} className="cursor-grab touch-none self-start text-muted" {...attributes} {...listeners}>
            <GripVertical size={18} />
          </button>
        ) : (
          <span className="w-[18px]" />
        )}
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tabular-nums">{chapter.chapter_number}.</span>
            <Input aria-label="Titre du chapitre" className="h-8 flex-1" value={form.title} onChange={(e) => edit({ title: e.target.value })} />
            {locked && <Badge title="Ce chapitre sera conservé si tu régénères la trame"><Lock size={11} /> Verrouillé</Badge>}
          </div>
          <Textarea aria-label="Résumé du chapitre" className="min-h-16" value={form.brief_summary} onChange={(e) => edit({ brief_summary: e.target.value })} />
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs text-muted">
              Mots visés
              <Input aria-label="Mots visés" type="number" min={100} className="h-8 w-24" value={form.target_words} onChange={(e) => edit({ target_words: Number(e.target.value) }, false)} />
            </label>
            {pending && (
              <Button variant="ghost" size="icon" aria-label={`Supprimer le chapitre ${chapter.chapter_number}`} onClick={() => onError(() => api.deleteChapter(chapter.id))}>
                <Trash2 size={14} />
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
  const { busy, doing, error, run } = useAction();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={chapters.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {chapters.map((c) => (
              <ChapterCard key={c.id} chapter={c} onError={(fn) => void run(async () => { await fn(); await load(); })} />
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
            await api.addChapter(project.id, newTitle.trim());
            setNewTitle('');
            await load();
          });
        }}
      >
        <Input aria-label="Titre du nouveau chapitre" placeholder="Titre d'un nouveau chapitre" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
        <Button type="submit" variant="secondary" disabled={busy}><Plus size={14} /> Ajouter</Button>
      </form>

      <Card className="space-y-3">
        <Field label="Régénérer la trame" hint="Les chapitres verrouillés sont conservés et servent de contraintes.">
          <Input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Ton retour (facultatif)" />
        </Field>
        <Button
          variant="secondary"
          disabled={busy}
          loading={doing === 'outline'}
          onClick={() =>
            void run(async () => {
              await flushAllAutosaves();
              await api.outline(project.id, feedback || undefined);
              await load();
            }, 'outline')
          }
        >
          {doing !== 'outline' && <RefreshCw size={14} />} {doing === 'outline' ? 'Génération de la trame…' : 'Régénérer'}
        </Button>
      </Card>

      <ErrorNote error={error} />
      <div className="flex justify-end">
        <Button
          disabled={busy || job !== null || chapters.length === 0}
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
    </div>
  );
}
