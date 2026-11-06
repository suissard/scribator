import { ArrowRight, History, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { pb } from '@/api/pocketbase';
import { api } from '@/api/server';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { VersionHistoryModal } from '@/components/editor/VersionHistoryModal';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { Field, Input, Textarea } from '@/components/ui/field';
import { flushAllAutosaves } from '@/lib/autosaveRegistry';
import { STATUS_ORDER, type Project, type StoryBible, type StyleMatrix } from '@/lib/types';
import { useAction } from '@/lib/useAction';
import { useAutoSave } from '@/lib/useAutoSave';

const STYLE_TEXT: Array<[keyof StyleMatrix, string]> = [
  ['tone', 'Ton'], ['pacing', 'Rythme'], ['vocabulary_level', 'Vocabulaire'], ['narrative_pov', 'Point de vue'],
  ['tense', 'Temps du récit'], ['sentence_structure', 'Structure des phrases'], ['dialogue_style', 'Dialogues'],
];
const STYLE_LISTS: Array<[keyof StyleMatrix, string]> = [
  ['stylistic_rules', 'Règles stylistiques'], ['forbidden_tropes', 'Tropes interdits'], ['forbidden_phrases', 'Expressions interdites'],
];

function StyleEditor({ project }: { project: Project }) {
  const [style, setStyle] = useState(project.style_matrix!);
  const [history, setHistory] = useState(false);
  const { busy, error, run } = useAction();
  useEffect(() => setStyle(project.style_matrix!), [project.style_matrix]);
  const dirty = JSON.stringify(style) !== JSON.stringify(project.style_matrix);
  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Style</h2>
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
        disabled={!dirty || busy}
        onClick={() =>
          void run(() =>
            api.patchStyle(project.id, {
              ...style,
              ...Object.fromEntries(STYLE_LISTS.map(([k]) => [k, (style[k] as string[]).map((s) => s.trim()).filter(Boolean)])),
            }),
          )
        }
      >
        Enregistrer le style
      </Button>
      <VersionHistoryModal open={history} onOpenChange={setHistory} targetId={project.id} field="style_matrix" />
    </Card>
  );
}

const newId = (prefix: string) => `${prefix}_${Math.random().toString(16).slice(2, 6)}`;

function BibleEditor({ project }: { project: Project }) {
  const [bible, setBible] = useState<StoryBible>(project.story_bible!);
  const [history, setHistory] = useState(false);
  const { busy, error, run } = useAction();
  useEffect(() => setBible(project.story_bible!), [project.story_bible]);
  const dirty = JSON.stringify(bible) !== JSON.stringify(project.story_bible);

  function patch<K extends keyof StoryBible>(key: K, index: number, change: Partial<StoryBible[K][number]>) {
    setBible({ ...bible, [key]: bible[key].map((item, i) => (i === index ? { ...item, ...change } : item)) });
  }
  const remove = (key: keyof StoryBible, index: number) => setBible({ ...bible, [key]: bible[key].filter((_, i) => i !== index) });
  const Remove = ({ k, i }: { k: keyof StoryBible; i: number }) => (
    <Button variant="ghost" size="icon" aria-label="Supprimer" onClick={() => remove(k, i)}><Trash2 size={14} /></Button>
  );

  return (
    <Card className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Bible de l'histoire</h2>
        <Button size="sm" variant="ghost" onClick={() => setHistory(true)}><History size={14} /> Historique</Button>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Personnages</h3>
        {bible.characters.map((c, i) => (
          <div key={c.id} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-[1fr_8rem_auto]">
            <Input aria-label="Nom" value={c.name} onChange={(e) => patch('characters', i, { name: e.target.value })} />
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
        <Button size="sm" variant="ghost" onClick={() => setBible({ ...bible, characters: [...bible.characters, { id: newId('char'), name: '', role: 'secondaire', traits: '', current_status: '' }] })}>
          <Plus size={14} /> Personnage
        </Button>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Lieux</h3>
        {bible.locations.map((l, i) => (
          <div key={l.id} className="grid gap-2 sm:grid-cols-[12rem_1fr_auto]">
            <Input aria-label="Nom du lieu" value={l.name} onChange={(e) => patch('locations', i, { name: e.target.value })} />
            <Input aria-label="Description" value={l.description} onChange={(e) => patch('locations', i, { description: e.target.value })} />
            <Remove k="locations" i={i} />
          </div>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setBible({ ...bible, locations: [...bible.locations, { id: newId('loc'), name: '', description: '' }] })}>
          <Plus size={14} /> Lieu
        </Button>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Règles du monde</h3>
        {bible.world_rules.map((r, i) => (
          <div key={r.id} className="flex gap-2">
            <Input aria-label="Règle" value={r.rule} onChange={(e) => patch('world_rules', i, { rule: e.target.value })} />
            <Remove k="world_rules" i={i} />
          </div>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setBible({ ...bible, world_rules: [...bible.world_rules, { id: newId('rule'), rule: '' }] })}>
          <Plus size={14} /> Règle
        </Button>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Chronologie</h3>
        {bible.timeline_events.map((t, i) => (
          <div key={t.id} className="grid grid-cols-[5rem_1fr_auto] gap-2">
            <Input aria-label="Chapitre" type="number" min={0} value={t.chapter_number} onChange={(e) => patch('timeline_events', i, { chapter_number: Number(e.target.value) })} />
            <Input aria-label="Événement" value={t.event} onChange={(e) => patch('timeline_events', i, { event: e.target.value })} />
            <Remove k="timeline_events" i={i} />
          </div>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setBible({ ...bible, timeline_events: [...bible.timeline_events, { id: newId('evt'), chapter_number: 0, event: '' }] })}>
          <Plus size={14} /> Événement
        </Button>
      </section>

      <ErrorNote error={error} />
      <Button variant="secondary" disabled={!dirty || busy} onClick={() => void run(() => api.patchBible(project.id, bible))}>
        Enregistrer la Bible
      </Button>
      <VersionHistoryModal open={history} onOpenChange={setHistory} targetId={project.id} field="story_bible" />
    </Card>
  );
}

export function Step2Concept({ project }: { project: Project }) {
  const [feedback, setFeedback] = useState('');
  const { busy, doing, error, run } = useAction();
  const save = useAutoSave<string>((reformulated_concept) => pb.collection('projects').update(project.id, { reformulated_concept }));
  const earlyStage = STATUS_ORDER.indexOf(project.status) <= 1;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <Card className="space-y-3">
        <h2 className="font-semibold">Concept</h2>
        <RichTextEditor value={project.reformulated_concept} onChange={save} ariaLabel="Concept du livre" />
      </Card>
      {project.style_matrix && <StyleEditor project={project} />}
      {project.story_bible && <BibleEditor project={project} />}
      <ErrorNote error={error} />
      {earlyStage && (
        <Card className="space-y-3">
          <Field label="Retour sur le concept (facultatif)">
            <Input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Plus sombre, une fin ouverte…" />
          </Field>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await flushAllAutosaves();
                await api.analyze(project.id, feedback || undefined);
              })
            }
          >
            <RefreshCw size={14} /> Régénérer le concept et la Bible
          </Button>
        </Card>
      )}
      <div className="flex justify-end">
        <Button
          disabled={busy}
          loading={doing === 'outline'}
          onClick={() =>
            void run(async () => {
              await flushAllAutosaves();
              await api.outline(project.id);
            }, 'outline')
          }
        >
          {doing === 'outline' ? 'Génération de la trame…' : earlyStage ? 'Valider et générer la trame' : 'Compléter la trame'} <ArrowRight size={16} />
        </Button>
      </div>
    </div>
  );
}
