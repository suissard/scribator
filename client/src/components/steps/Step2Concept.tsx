import { ArrowRight, Check, History, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { pb } from '@/api/pocketbase';
import { api } from '@/api/server';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { VersionHistoryModal } from '@/components/editor/VersionHistoryModal';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { Field, Input, Textarea } from '@/components/ui/field';
import { flushAllAutosaves, registerFlush } from '@/lib/autosaveRegistry';
import { toastSuccess } from '@/lib/toast';
import { STATUS_ORDER, type Project, type StoryBible, type StyleMatrix } from '@/lib/types';
import { useAction } from '@/lib/useAction';
import { useAutoSave } from '@/lib/useAutoSave';
import { cn } from '@/lib/utils';
import { useProjectStore } from '@/store/useProjectStore';

const STYLE_TEXT: Array<[keyof StyleMatrix, string]> = [
  ['tone', 'Ton'], ['pacing', 'Rythme'], ['vocabulary_level', 'Vocabulaire'], ['narrative_pov', 'Point de vue'],
  ['tense', 'Temps du récit'], ['sentence_structure', 'Structure des phrases'], ['dialogue_style', 'Dialogues'],
];
const STYLE_LISTS: Array<[keyof StyleMatrix, string]> = [
  ['stylistic_rules', 'Règles stylistiques'], ['forbidden_tropes', 'Tropes interdits'], ['forbidden_phrases', 'Expressions interdites'],
];

function cleanStyle(style: StyleMatrix): StyleMatrix {
  return {
    ...style,
    ...Object.fromEntries(STYLE_LISTS.map(([k]) => [k, (style[k] as string[]).map((s) => s.trim()).filter(Boolean)])),
  } as StyleMatrix;
}

function StyleEditor({
  project,
  running,
  onDirtyChange,
}: {
  project: Project;
  running: boolean;
  onDirtyChange(dirty: boolean): void;
}) {
  const [style, setStyle] = useState(project.style_matrix!);
  const [history, setHistory] = useState(false);
  const { busy, error, run } = useAction();
  useEffect(() => setStyle(project.style_matrix!), [project.style_matrix]);
  const dirty = JSON.stringify(style) !== JSON.stringify(project.style_matrix);
  const latest = useRef({ dirty, style });
  latest.current = { dirty, style };

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    return registerFlush(async () => {
      if (!latest.current.dirty) return;
      await api.patchStyle(project.id, cleanStyle(latest.current.style));
    });
  }, [project.id]);

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">Style</h2>
          {dirty && <span className="rounded-full bg-stale/15 px-2 py-0.5 text-xs font-medium text-stale">Modifications non enregistrées</span>}
        </div>
        <Button size="sm" variant="ghost" onClick={() => setHistory(true)}><History size={14} /> Historique</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {STYLE_TEXT.map(([key, label]) => (
          <Field key={key} label={label}>
            <Input value={style[key] as string} onChange={(e) => setStyle({ ...style, [key]: e.target.value })} />
          </Field>
        ))}
      </div>
      {STYLE_LISTS.map(([key, label]) => (
        <Field key={key} label={label} hint="Une entrée par ligne">
          <Textarea
            value={(style[key] as string[]).join('\n')}
            onChange={(e) => setStyle({ ...style, [key]: e.target.value.split('\n') })}
          />
        </Field>
      ))}
      <ErrorNote error={error} />
      <Button
        variant="secondary"
        disabled={!dirty || busy || running}
        onClick={() =>
          void run(async () => {
            await api.patchStyle(project.id, cleanStyle(style));
            toastSuccess('Style enregistré.');
          })
        }
      >
        Enregistrer le style
      </Button>
      <VersionHistoryModal open={history} onOpenChange={setHistory} targetId={project.id} field="style_matrix" />
    </Card>
  );
}

const newId = (prefix: string) => `${prefix}_${Math.random().toString(16).slice(2, 6)}`;

function BibleEditor({
  project,
  running,
  onDirtyChange,
}: {
  project: Project;
  running: boolean;
  onDirtyChange(dirty: boolean): void;
}) {
  const [bible, setBible] = useState<StoryBible>(project.story_bible!);
  const [history, setHistory] = useState(false);
  const { busy, error, run } = useAction();
  useEffect(() => setBible(project.story_bible!), [project.story_bible]);
  const dirty = JSON.stringify(bible) !== JSON.stringify(project.story_bible);
  const latest = useRef({ dirty, bible });
  latest.current = { dirty, bible };

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    return registerFlush(async () => {
      if (!latest.current.dirty) return;
      await api.patchBible(project.id, latest.current.bible);
    });
  }, [project.id]);

  function patch<K extends keyof StoryBible>(key: K, index: number, change: Partial<StoryBible[K][number]>) {
    setBible({ ...bible, [key]: bible[key].map((item, i) => (i === index ? { ...item, ...change } : item)) });
  }
  const remove = (key: keyof StoryBible, index: number) => setBible({ ...bible, [key]: bible[key].filter((_, i) => i !== index) });
  const Remove = ({ k, i }: { k: keyof StoryBible; i: number }) => (
    <Button variant="ghost" size="icon" className="text-muted hover:bg-danger/10 hover:text-danger" aria-label="Supprimer" onClick={() => remove(k, i)}>
      <Trash2 size={14} />
    </Button>
  );

  return (
    <Card className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">Bible de l'histoire</h2>
          {dirty && <span className="rounded-full bg-stale/15 px-2 py-0.5 text-xs font-medium text-stale">Modifications non enregistrées</span>}
        </div>
        <Button size="sm" variant="ghost" onClick={() => setHistory(true)}><History size={14} /> Historique</Button>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Personnages</h3>
        {bible.characters.map((c, i) => (
          <div key={c.id} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-[1fr_8rem_auto]">
            <Input aria-label="Nom" placeholder="Nom" value={c.name} onChange={(e) => patch('characters', i, { name: e.target.value })} />
            <select
              aria-label="Rôle"
              className="h-10 rounded-md border border-line bg-card px-2 text-sm"
              value={c.role}
              onChange={(e) => patch('characters', i, { role: e.target.value as typeof c.role })}
            >
              <option value="principal">Principal</option>
              <option value="secondaire">Secondaire</option>
              <option value="figurant">Figurant</option>
            </select>
            <Remove k="characters" i={i} />
            <Input aria-label="Traits" className="sm:col-span-3" placeholder="Traits" value={c.traits} onChange={(e) => patch('characters', i, { traits: e.target.value })} />
            <Input aria-label="État actuel" className="sm:col-span-3" placeholder="État actuel" value={c.current_status} onChange={(e) => patch('characters', i, { current_status: e.target.value })} />
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={() => setBible({ ...bible, characters: [...bible.characters, { id: newId('char'), name: '', role: 'secondaire', traits: '', current_status: '' }] })}>
          <Plus size={14} /> Personnage
        </Button>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Lieux</h3>
        {bible.locations.map((l, i) => (
          <div key={l.id} className="grid gap-2 sm:grid-cols-[12rem_1fr_auto]">
            <Input aria-label="Nom du lieu" placeholder="Nom du lieu" value={l.name} onChange={(e) => patch('locations', i, { name: e.target.value })} />
            <Input aria-label="Description" placeholder="Description" value={l.description} onChange={(e) => patch('locations', i, { description: e.target.value })} />
            <Remove k="locations" i={i} />
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={() => setBible({ ...bible, locations: [...bible.locations, { id: newId('loc'), name: '', description: '' }] })}>
          <Plus size={14} /> Lieu
        </Button>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Règles du monde</h3>
        {bible.world_rules.map((r, i) => (
          <div key={r.id} className="flex gap-2">
            <Input aria-label="Règle" placeholder="Règle" value={r.rule} onChange={(e) => patch('world_rules', i, { rule: e.target.value })} />
            <Remove k="world_rules" i={i} />
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={() => setBible({ ...bible, world_rules: [...bible.world_rules, { id: newId('rule'), rule: '' }] })}>
          <Plus size={14} /> Règle
        </Button>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Chronologie</h3>
        {bible.timeline_events.map((t, i) => (
          <div key={t.id} className="grid grid-cols-[5rem_1fr_auto] gap-2">
            <Input aria-label="Chapitre" type="number" min={0} value={t.chapter_number} onChange={(e) => patch('timeline_events', i, { chapter_number: Number(e.target.value) })} />
            <Input aria-label="Événement" placeholder="Événement" value={t.event} onChange={(e) => patch('timeline_events', i, { event: e.target.value })} />
            <Remove k="timeline_events" i={i} />
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={() => setBible({ ...bible, timeline_events: [...bible.timeline_events, { id: newId('evt'), chapter_number: 0, event: '' }] })}>
          <Plus size={14} /> Événement
        </Button>
      </section>

      <ErrorNote error={error} />
      <Button
        variant="secondary"
        disabled={!dirty || busy || running}
        onClick={() =>
          void run(async () => {
            await api.patchBible(project.id, bible);
            toastSuccess('Bible enregistrée.');
          })
        }
      >
        Enregistrer la Bible
      </Button>
      <VersionHistoryModal open={history} onOpenChange={setHistory} targetId={project.id} field="story_bible" />
    </Card>
  );
}

type ConceptTab = 'concept' | 'style' | 'bible';

export function Step2Concept({ project }: { project: Project }) {
  const job = useProjectStore((s) => s.activeJob);
  const running = job !== null;
  const [tab, setTab] = useState<ConceptTab>('concept');
  const [styleDirty, setStyleDirty] = useState(false);
  const [bibleDirty, setBibleDirty] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [regenOpen, setRegenOpen] = useState(false);
  const [confirmOutlineOpen, setConfirmOutlineOpen] = useState(false);
  const { busy, doing, error, run } = useAction();
  const save = useAutoSave<string>((reformulated_concept) => pb.collection('projects').update(project.id, { reformulated_concept }));
  const earlyStage = STATUS_ORDER.indexOf(project.status) <= 1;

  const bibleCount = project.story_bible
    ? project.story_bible.characters.length +
      project.story_bible.locations.length +
      project.story_bible.world_rules.length +
      project.story_bible.timeline_events.length
    : 0;

  const generateOutline = () => {
    setConfirmOutlineOpen(false);
    void run(async () => {
      await flushAllAutosaves();
      await api.outline(project.id);
    }, 'outline');
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <div role="tablist" aria-label="Sections du concept" className="flex flex-wrap gap-2 border-b border-line pb-2">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'concept'}
          onClick={() => setTab('concept')}
          className={cn(
            'cursor-pointer rounded-md border px-4 py-2 text-sm font-medium transition-colors',
            tab === 'concept' ? 'border-accent/40 bg-accent-soft text-accent font-semibold' : 'border-transparent text-muted hover:bg-accent-soft/50 hover:text-ink',
          )}
        >
          Concept
        </button>
        {project.style_matrix && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'style'}
            onClick={() => setTab('style')}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors',
              tab === 'style' ? 'border-accent/40 bg-accent-soft text-accent font-semibold' : 'border-transparent text-muted hover:bg-accent-soft/50 hover:text-ink',
            )}
          >
            Style
            {styleDirty && <span className="h-2 w-2 rounded-full bg-stale" title="Modifications non enregistrées" />}
          </button>
        )}
        {project.story_bible && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'bible'}
            onClick={() => setTab('bible')}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors',
              tab === 'bible' ? 'border-accent/40 bg-accent-soft text-accent font-semibold' : 'border-transparent text-muted hover:bg-accent-soft/50 hover:text-ink',
            )}
          >
            Bible ({bibleCount})
            {bibleDirty && <span className="h-2 w-2 rounded-full bg-stale" title="Modifications non enregistrées" />}
          </button>
        )}
      </div>

      {/* Garder les éditeurs montés évite de flusher/réinitialiser prématurément au changement d'onglet. */}
      <div className={tab === 'concept' ? 'space-y-4' : 'hidden'}>
        {project.reference_meta?.story_memory && (
          <Card className="space-y-2 border-accent/30 bg-accent-soft/30">
            <h2 className="font-semibold">Mémoire extraite de l'ouvrage fourni</h2>
            <p className="text-sm text-muted">{project.reference_meta.story_memory.summary}</p>
            {project.reference_meta.story_memory.ending_state && (
              <p className="text-sm">
                <strong>Situation à la fin du livre fourni :</strong> {project.reference_meta.story_memory.ending_state}
              </p>
            )}
          </Card>
        )}
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Concept</h2>
            <span className="text-xs text-muted">Cliquez dans le texte pour l'éditer directement</span>
          </div>
          <RichTextEditor value={project.reformulated_concept} onChange={save} ariaLabel="Concept du livre" />
        </Card>
      </div>

      {project.style_matrix && (
        <div className={tab === 'style' ? undefined : 'hidden'}>
          <StyleEditor project={project} running={running} onDirtyChange={setStyleDirty} />
        </div>
      )}

      {project.story_bible && (
        <div className={tab === 'bible' ? undefined : 'hidden'}>
          <BibleEditor project={project} running={running} onDirtyChange={setBibleDirty} />
        </div>
      )}

      <ErrorNote error={error} />

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card/95 p-3 shadow-md backdrop-blur">
        <div>
          {earlyStage && (
            <Button variant="secondary" disabled={busy || running} onClick={() => setRegenOpen(true)}>
              <RefreshCw size={15} /> Régénérer concept & Bible…
            </Button>
          )}
        </div>

        {earlyStage ? (
          <Button
            variant="success"
            disabled={busy || running}
            loading={doing === 'outline'}
            onClick={generateOutline}
          >
            {doing !== 'outline' && <Check size={16} />}
            {doing === 'outline' ? 'Génération de la trame…' : 'Valider et créer la trame'}
            {doing !== 'outline' && <ArrowRight size={16} />}
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={busy || running}
            loading={doing === 'outline'}
            onClick={() => setConfirmOutlineOpen(true)}
          >
            {doing === 'outline' ? 'Mise à jour de la trame…' : 'Mettre à jour la trame'}
            {doing !== 'outline' && <ArrowRight size={16} />}
          </Button>
        )}
      </div>

      <Dialog
        open={regenOpen}
        onOpenChange={setRegenOpen}
        title="Régénérer le concept et la Bible ?"
        description="Le concept, le style et la Bible actuels seront remplacés par une nouvelle génération."
      >
        <div className="space-y-4">
          <Field label="Indications (facultatif)">
            <Textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Plus sombre, une fin ouverte, renforcer le rôle d'un personnage…"
            />
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setRegenOpen(false)}>
              Annuler
            </Button>
            <Button
              variant="primary"
              disabled={busy || running}
              onClick={() => {
                setRegenOpen(false);
                void run(async () => {
                  await flushAllAutosaves();
                  await api.analyze(project.id, feedback.trim() || undefined);
                  setFeedback('');
                });
              }}
            >
              <RefreshCw size={15} /> Régénérer
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={confirmOutlineOpen}
        onOpenChange={setConfirmOutlineOpen}
        title="Mettre à jour la trame ?"
        description="La trame existante sera complétée ou actualisée à partir du concept et de la Bible. Les chapitres déjà modifiés ou commencés sont conservés."
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmOutlineOpen(false)}>
            Annuler
          </Button>
          <Button variant="primary" onClick={generateOutline}>
            Mettre à jour la trame
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
