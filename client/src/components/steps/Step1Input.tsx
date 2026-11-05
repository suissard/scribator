import { FileUp, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { pb } from '@/api/pocketbase';
import { api } from '@/api/server';
import { ModelSettings } from '@/components/ModelSettings';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { Field, Input, Textarea } from '@/components/ui/field';
import { flushAllAutosaves } from '@/lib/autosaveRegistry';
import { LENGTH_PRESETS, type LengthPreset, type Project } from '@/lib/types';
import { useAction } from '@/lib/useAction';
import { useAutoSave } from '@/lib/useAutoSave';
import { cn, formatNumber } from '@/lib/utils';
import { useProjectStore } from '@/store/useProjectStore';

const MAX_BYTES = 20 * 1024 * 1024;

export function Step1Input({ project }: { project: Project }) {
  const job = useProjectStore((s) => s.activeJob);
  const setProject = useProjectStore((s) => s.setProject);
  const [form, setForm] = useState(() => ({
    title: project.title, language: project.language || 'fr', genre: project.genre, audience: project.audience,
    length_preset: project.length_preset || 'ROMAN',
    target_chapter_count: project.target_chapter_count || 20,
    target_words_per_chapter: project.target_words_per_chapter || 3500,
    raw_ideas: project.raw_ideas,
  }));
  const [terms, setTerms] = useState(Boolean(pb.authStore.record?.accepted_terms_at));
  const [uploaded, setUploaded] = useState(project.reference_file ? 'Fichier déposé' : '');
  const { busy, error, run } = useAction();
  const save = useAutoSave<typeof form>((data) => pb.collection('projects').update(project.id, data));
  const running = job?.kind === 'ANALYZE';

  const update = (patch: Partial<typeof form>) => {
    const next = { ...form, ...patch };
    setForm(next);
    save(next);
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    void run(async () => {
      if (file.size > MAX_BYTES) throw new Error('Fichier trop lourd');
      const data = new FormData();
      data.append('reference_file', file);
      setProject(await pb.collection('projects').update<Project>(project.id, data));
      setUploaded(file.name);
    });
  };

  const acceptTerms = (checked: boolean) => {
    if (!checked) return;
    void run(async () => {
      await api.acceptTerms();
      await pb.collection('users').authRefresh();
      setTerms(true);
    });
  };

  const canAnalyze = form.title.trim() && (form.raw_ideas.trim() || uploaded);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <Card className="space-y-4">
        <Field label="Titre">
          <Input value={form.title} onChange={(e) => update({ title: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Langue du livre">
            <Input value={form.language} onChange={(e) => update({ language: e.target.value })} placeholder="fr" />
          </Field>
          <Field label="Genre">
            <Input value={form.genre} onChange={(e) => update({ genre: e.target.value })} placeholder="thriller, fantasy…" />
          </Field>
          <Field label="Public">
            <Input value={form.audience} onChange={(e) => update({ audience: e.target.value })} placeholder="adulte, young adult…" />
          </Field>
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-semibold">Longueur</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {LENGTH_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={form.length_preset === p.id}
              onClick={() => update({ length_preset: p.id, target_chapter_count: p.chapters, target_words_per_chapter: p.words })}
              className={cn(
                'cursor-pointer rounded-md border p-3 text-left',
                form.length_preset === p.id ? 'border-accent bg-accent-soft' : 'border-line hover:bg-accent-soft/40',
              )}
            >
              <span className="block text-sm font-medium">{p.label}</span>
              <span className="block text-xs text-muted">{p.total} · {p.chapters} chapitres</span>
            </button>
          ))}
          <button
            type="button"
            aria-pressed={form.length_preset === 'CUSTOM'}
            onClick={() => update({ length_preset: 'CUSTOM' as LengthPreset })}
            className={cn(
              'cursor-pointer rounded-md border p-3 text-left sm:col-span-2',
              form.length_preset === 'CUSTOM' ? 'border-accent bg-accent-soft' : 'border-line hover:bg-accent-soft/40',
            )}
          >
            <span className="block text-sm font-medium">Personnalisé</span>
          </button>
        </div>
        {form.length_preset === 'CUSTOM' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Chapitres : ${form.target_chapter_count}`}>
              <input type="range" min={1} max={60} className="w-full accent-[var(--color-accent)]" value={form.target_chapter_count} onChange={(e) => update({ target_chapter_count: Number(e.target.value) })} />
            </Field>
            <Field label={`Mots par chapitre : ${formatNumber(form.target_words_per_chapter)}`}>
              <input type="range" min={500} max={8000} step={100} className="w-full accent-[var(--color-accent)]" value={form.target_words_per_chapter} onChange={(e) => update({ target_words_per_chapter: Number(e.target.value) })} />
            </Field>
          </div>
        )}
        <p className="text-sm text-muted">Total estimé : {formatNumber(form.target_chapter_count * form.target_words_per_chapter)} mots</p>
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="font-semibold">Ouvrage de référence (facultatif)</h2>
          <p className="mt-1 text-sm text-muted">Sans ouvrage, l'IA propose un style à partir de tes idées. Tu pourras le modifier à l'étape suivante.</p>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 accent-[var(--color-accent)]" checked={terms} disabled={terms} onChange={(e) => acceptTerms(e.target.checked)} />
          <span>Je certifie disposer des droits nécessaires sur le fichier de référence, utilisé uniquement pour l'analyse de style puis supprimé.</span>
        </label>
        <label className={cn('flex flex-col items-center gap-2 rounded-md border-2 border-dashed border-line p-6 text-center', terms ? 'cursor-pointer hover:bg-accent-soft/40' : 'opacity-50')}>
          <FileUp className="text-muted" />
          <span className="text-sm">{uploaded || 'Choisir un fichier PDF, DOCX, EPUB ou TXT (20 Mo maximum)'}</span>
          <input type="file" className="sr-only" disabled={!terms || busy} accept=".pdf,.docx,.epub,.txt" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        {project.reference_meta && (
          <p className="text-xs text-muted">
            Déjà analysé : {formatNumber(project.reference_meta.word_count)} mots. Le fichier a été supprimé.
          </p>
        )}
      </Card>

      <ModelSettings project={project} />

      <Card>
        <Field label="Tes idées brutes" hint="Personnages, intrigue, ambiance, fin envisagée : tout ce que tu as en tête.">
          <Textarea className="min-h-40" value={form.raw_ideas} onChange={(e) => update({ raw_ideas: e.target.value })} />
        </Field>
      </Card>

      <ErrorNote error={error} />
      <div className="flex justify-end">
        <Button
          disabled={!canAnalyze || busy || running}
          onClick={() =>
            void run(async () => {
              await flushAllAutosaves();
              await api.analyze(project.id);
            })
          }
        >
          <Sparkles size={16} /> {running ? 'Analyse en cours…' : "Lancer l'analyse"}
        </Button>
      </div>
    </div>
  );
}
