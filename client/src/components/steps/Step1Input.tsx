import { ArrowRight, FileUp, RefreshCw, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { pb } from '@/api/pocketbase';
import { api } from '@/api/server';
import { ModelSettings } from '@/components/ModelSettings';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { Field, Input, Textarea } from '@/components/ui/field';
import { flushAllAutosaves } from '@/lib/autosaveRegistry';
import { toastSuccess } from '@/lib/toast';
import { LENGTH_PRESETS, type LengthPreset, type Project } from '@/lib/types';
import { useAction } from '@/lib/useAction';
import { useAutoSave } from '@/lib/useAutoSave';
import { cn, formatNumber } from '@/lib/utils';
import { useProjectStore } from '@/store/useProjectStore';

const MAX_BYTES = 20 * 1024 * 1024;

const LANGUAGES = [
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'Anglais' },
  { code: 'es', label: 'Espagnol' },
  { code: 'de', label: 'Allemand' },
  { code: 'it', label: 'Italien' },
  { code: 'pt', label: 'Portugais' },
];

export function Step1Input({ project }: { project: Project }) {
  const job = useProjectStore((s) => s.activeJob);
  const setProject = useProjectStore((s) => s.setProject);
  const setStep = useProjectStore((s) => s.setStep);
  const [form, setForm] = useState(() => ({
    title: project.title,
    language: project.language || 'fr',
    genre: project.genre,
    audience: project.audience,
    length_preset: project.length_preset || 'ROMAN',
    target_chapter_count: project.target_chapter_count || 5,
    target_words_per_chapter: project.target_words_per_chapter || 3500,
    raw_ideas: project.raw_ideas,
  }));
  const [terms, setTerms] = useState(Boolean(pb.authStore.record?.accepted_terms_at));
  const [uploaded, setUploaded] = useState(project.reference_file ? 'Fichier déposé' : '');
  const [confirmReanalyze, setConfirmReanalyze] = useState(false);
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
      if (file.size > MAX_BYTES) throw new Error('Fichier trop lourd (maximum 20 Mo).');
      const data = new FormData();
      data.append('reference_file', file);
      setProject(await pb.collection('projects').update<Project>(project.id, data));
      setUploaded(file.name);
      toastSuccess('Fichier de référence enregistré.');
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

  const launchAnalysis = () => {
    setConfirmReanalyze(false);
    void run(async () => {
      await flushAllAutosaves();
      await api.analyze(project.id);
    });
  };

  const canAnalyze = Boolean(form.title.trim() && (form.raw_ideas.trim() || uploaded));
  const alreadyAnalyzed = project.status !== 'STEP_1_INPUT';
  const totalWords = form.target_chapter_count * form.target_words_per_chapter;
  const approxPages = Math.max(1, Math.round(totalWords / 250));
  const hasCustomLanguage = form.language && !LANGUAGES.some((l) => l.code === form.language);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <Card className="space-y-4">
        <Field label="Titre">
          <Input value={form.title} onChange={(e) => update({ title: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Langue du livre">
            <select
              aria-label="Langue du livre"
              className="h-10 w-full rounded-md border border-line bg-card px-3 text-sm focus:outline-2 focus:outline-accent"
              value={form.language}
              onChange={(e) => update({ language: e.target.value })}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
              {hasCustomLanguage && <option value={form.language}>{form.language}</option>}
            </select>
          </Field>
          <Field label="Genre">
            <Input value={form.genre} onChange={(e) => update({ genre: e.target.value })} placeholder="thriller, fantasy…" />
          </Field>
          <Field label="Public">
            <Input value={form.audience} onChange={(e) => update({ audience: e.target.value })} placeholder="adulte, young adult…" />
          </Field>
        </div>
      </Card>

      <Card>
        <Field
          label="Vos idées brutes"
          hint="Personnages, intrigue, ambiance, fin envisagée : tout ce que vous avez en tête."
        >
          <Textarea className="min-h-44" value={form.raw_ideas} onChange={(e) => update({ raw_ideas: e.target.value })} />
        </Field>
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
                'cursor-pointer rounded-md border p-3 text-left transition-colors',
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
              'cursor-pointer rounded-md border p-3 text-left transition-colors sm:col-span-2',
              form.length_preset === 'CUSTOM' ? 'border-accent bg-accent-soft' : 'border-line hover:bg-accent-soft/40',
            )}
          >
            <span className="block text-sm font-medium">Personnalisé</span>
          </button>
        </div>
        {form.length_preset === 'CUSTOM' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Chapitres : ${form.target_chapter_count}`}>
              <input
                type="range"
                min={1}
                max={60}
                className="w-full accent-[var(--color-accent)]"
                value={form.target_chapter_count}
                onChange={(e) => update({ target_chapter_count: Number(e.target.value) })}
              />
            </Field>
            <Field label={`Mots par chapitre : ${formatNumber(form.target_words_per_chapter)}`}>
              <input
                type="range"
                min={500}
                max={8000}
                step={100}
                className="w-full accent-[var(--color-accent)]"
                value={form.target_words_per_chapter}
                onChange={(e) => update({ target_words_per_chapter: Number(e.target.value) })}
              />
            </Field>
          </div>
        )}
        <p className="text-sm text-muted">
          Total estimé : <strong className="font-medium text-ink">{formatNumber(totalWords)} mots</strong> (environ {formatNumber(approxPages)} pages)
        </p>
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="font-semibold">Ouvrage de référence ou Tome précédent (facultatif)</h2>
          <p className="mt-1 text-sm text-muted">
            Déposez un livre (PDF, DOCX, EPUB ou TXT) : l'IA en extrait le style d'écriture ainsi que l'histoire, la situation finale et les personnages pour préparer la suite. Sans ouvrage, l'IA propose un style à partir de vos idées.
          </p>
        </div>
        <label
          className={cn(
            'flex items-start gap-2.5 rounded-md border p-3 text-sm transition-colors',
            terms ? 'border-line bg-paper' : 'border-accent/40 bg-accent-soft/40',
          )}
        >
          <input
            type="checkbox"
            className="mt-0.5 accent-[var(--color-accent)]"
            checked={terms}
            disabled={terms}
            onChange={(e) => acceptTerms(e.target.checked)}
          />
          <span>
            Je certifie disposer des droits nécessaires sur le fichier de référence, utilisé uniquement pour l'analyse puis supprimé.
            {!terms && <span className="mt-0.5 block text-xs text-accent">Cochez cette case pour activer le dépôt de fichier ci-dessous.</span>}
          </span>
        </label>
        <label
          className={cn(
            'flex flex-col items-center gap-2 rounded-md border-2 border-dashed border-line p-6 text-center transition-colors',
            terms ? 'cursor-pointer hover:bg-accent-soft/40' : 'cursor-not-allowed opacity-50',
          )}
        >
          <FileUp className="text-muted" />
          <span className="text-sm">{uploaded || 'Choisir un fichier PDF, DOCX, EPUB ou TXT (20 Mo maximum)'}</span>
          <input type="file" className="sr-only" disabled={!terms || busy} accept=".pdf,.docx,.epub,.txt" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        {project.reference_meta && (
          <div className="space-y-1 rounded-md bg-paper p-3 text-xs text-muted">
            <p>
              Déjà analysé : {formatNumber(project.reference_meta.word_count)} mots. Le fichier source a été supprimé après extraction.
            </p>
            {project.reference_meta.story_memory && (
              <p>
                <strong>Personnages retrouvés :</strong>{' '}
                {project.reference_meta.story_memory.characters.map((c) => c.name).join(', ') || 'aucun'}
              </p>
            )}
          </div>
        )}
      </Card>

      <ModelSettings project={project} />

      <ErrorNote error={error} />

      <div className="space-y-2">
        {!canAnalyze && (
          <p className="text-sm text-muted">
            Renseignez un titre et au moins quelques idées (ou déposez un ouvrage de référence) pour lancer l'analyse.
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {alreadyAnalyzed ? (
            <>
              <Button variant="secondary" disabled={!canAnalyze || busy || running} onClick={() => setConfirmReanalyze(true)}>
                <RefreshCw size={15} /> Relancer l'analyse
              </Button>
              <Button variant="primary" onClick={() => setStep(2)}>
                Voir le concept <ArrowRight size={16} />
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              className="ml-auto"
              disabled={!canAnalyze || busy || running}
              loading={running}
              onClick={launchAnalysis}
            >
              {!running && <Sparkles size={16} />}
              {running ? 'Analyse en cours…' : "Lancer l'analyse"}
            </Button>
          )}
        </div>
      </div>

      <Dialog
        open={confirmReanalyze}
        onOpenChange={setConfirmReanalyze}
        title="Relancer l'analyse ?"
        description="Le concept, le style et la Bible actuels seront remplacés par une nouvelle analyse."
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmReanalyze(false)}>
            Annuler
          </Button>
          <Button variant="primary" onClick={launchAnalysis}>
            Relancer l'analyse
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
