import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Download,
  FileUp,
  PenLine,
  RefreshCw,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { pb } from '@/api/pocketbase';
import { api } from '@/api/server';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { StreamingViewer } from '@/components/editor/StreamingViewer';
import { maxStep } from '@/components/layout/StepIndicator';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { Input, Textarea } from '@/components/ui/field';
import { SpeakButton, VoiceDictationButton } from '@/components/ui/VoiceTools';
import { flushAllAutosaves } from '@/lib/autosaveRegistry';
import type { Chapter, Project, Scene } from '@/lib/types';
import { useAction } from '@/lib/useAction';
import { toastError } from '@/lib/toast';
import { useAutoSave } from '@/lib/useAutoSave';
import { cn } from '@/lib/utils';
import { useProjectStore, type StepView } from '@/store/useProjectStore';

const MAX_BYTES = 20 * 1024 * 1024;

const SIMPLE_STEPS: Array<{ view: StepView; label: string }> = [
  { view: 1, label: '1. Mon projet' },
  { view: 2, label: '2. Le résumé' },
  { view: 3, label: '3. Les chapitres' },
  { view: 4, label: '4. Premières pages' },
  { view: 5, label: '5. Mon livre' },
];

const DEFAULT_CHAPTERS = 5;
const MIN_CHAPTERS = 1;
const MAX_CHAPTERS = 60;

function clampChapters(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_CHAPTERS;
  return Math.min(MAX_CHAPTERS, Math.max(MIN_CHAPTERS, Math.round(n)));
}

function SimpleStepper({ status, active, onSelect }: { status: Project['status']; active: StepView; onSelect(s: StepView): void }) {
  const unlocked = maxStep(status);
  const currentView = active === 6 ? 5 : active;
  return (
    <nav aria-label="Étapes de votre livre" className="border-b border-line bg-card px-4 py-3">
      <div className="mx-auto flex max-w-4xl flex-wrap gap-2">
        {SIMPLE_STEPS.map(({ view, label }) => {
          const enabled = view <= unlocked;
          const isCurrent = view === currentView;
          return (
            <button
              key={view}
              type="button"
              disabled={!enabled}
              aria-current={isCurrent ? 'step' : undefined}
              onClick={() => onSelect(view)}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-lg border-2 px-4 py-2.5 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                isCurrent
                  ? 'border-accent bg-accent text-white'
                  : enabled
                    ? 'border-line bg-paper text-ink hover:border-accent/60 hover:bg-accent-soft'
                    : 'border-line bg-paper text-muted',
              )}
            >
              {view < unlocked && !isCurrent && <Check size={18} className="text-ok" />}
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function SimpleStep1({ project }: { project: Project }) {
  const job = useProjectStore((s) => s.activeJob);
  const setProject = useProjectStore((s) => s.setProject);
  const [form, setForm] = useState(() => ({
    title: project.title ?? '',
    language: project.language || 'fr',
    genre: project.genre,
    length_preset: project.length_preset || 'ROMAN',
    target_chapter_count: project.target_chapter_count || DEFAULT_CHAPTERS,
    target_words_per_chapter: project.target_words_per_chapter || 3000,
    raw_ideas: project.raw_ideas ?? '',
  }));
  const [uploaded, setUploaded] = useState(
    project.reference_file ? 'Votre ancien livre est bien enregistré' : project.reference_meta ? 'Le style de votre ancien livre a été mémorisé' : '',
  );
  const { busy, error, run } = useAction();
  const save = useAutoSave<typeof form>((data) => pb.collection('projects').update(project.id, data));
  const running = job?.kind === 'ANALYZE';

  const update = (patch: Partial<typeof form>) => {
    const next = { ...form, ...patch };
    setForm(next);
    save(next);
  };

  const [chaptersInput, setChaptersInput] = useState(String(form.target_chapter_count));
  const setChapters = (n: number) => {
    setChaptersInput(String(n));
    if (n !== form.target_chapter_count || form.length_preset !== 'CUSTOM') update({ length_preset: 'CUSTOM', target_chapter_count: n });
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    void run(async () => {
      if (file.size > MAX_BYTES) throw new Error('Ce fichier est trop volumineux (maximum 20 Mo).');
      if (!pb.authStore.record?.accepted_terms_at) {
        await api.acceptTerms();
        await pb.collection('users').authRefresh();
      }
      const data = new FormData();
      data.append('reference_file', file);
      setProject(await pb.collection('projects').update<Project>(project.id, data));
      setUploaded(`Livre fourni : ${file.name}`);
    });
  };

  const canAnalyze = form.title.trim() && (form.raw_ideas.trim() || uploaded);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <Card className="space-y-4 p-6">
        <h1 className="font-serif text-2xl font-bold">1. Le titre de votre nouveau livre</h1>
        <p className="text-base text-muted">Vous pourrez le changer à tout moment.</p>
        <Input
          aria-label="Titre du livre"
          className="h-14 text-lg font-medium"
          value={form.title}
          onChange={(e) => update({ title: e.target.value })}
        />
        <VoiceDictationButton
          label="Dicter le titre au micro"
          value={form.title}
          onChange={(next) => update({ title: next })}
        />
      </Card>

      <Card className="space-y-4 p-6">
        <h2 className="font-serif text-2xl font-bold">2. Votre ancien livre (si vous en avez un)</h2>
        <p className="text-base text-muted">
          Si vous avez déjà écrit un livre par le passé (par exemple au format PDF ou Word), déposez-le ici : l'application va retrouver votre style d'écriture, vos personnages et votre histoire pour écrire la suite.
        </p>
        <label
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-3 border-dashed p-8 text-center transition-colors',
            uploaded ? 'border-ok bg-ok/10 text-ok' : 'border-accent/50 bg-accent-soft/40 hover:bg-accent-soft',
          )}
        >
          <FileUp size={36} className={uploaded ? 'text-ok' : 'text-accent'} />
          <span className="text-lg font-semibold">
            {uploaded || 'Cliquez ici pour choisir votre ancien livre (PDF, Word, EPUB ou Texte)'}
          </span>
          <span className="text-sm text-muted">
            En déposant ce fichier, vous confirmez en être l'auteur. Il est supprimé automatiquement dès que l'analyse est terminée.
          </span>
          <input
            type="file"
            className="sr-only"
            disabled={busy || running}
            accept=".pdf,.docx,.epub,.txt"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
      </Card>

      <Card className="space-y-4 p-6">
        <h2 className="font-serif text-2xl font-bold">3. Racontez les grandes lignes de la suite</h2>
        <p className="text-base text-muted">
          Expliquez librement ce que vous voulez raconter dans ce nouveau livre : que deviennent vos personnages, où se passe l'histoire, et comment elle se termine. Vous pouvez parler au micro ou écrire au clavier.
        </p>
        <div className="flex flex-wrap gap-3">
          <VoiceDictationButton
            label="Parler dans le micro pour raconter l'histoire"
            value={form.raw_ideas}
            onChange={(next) => update({ raw_ideas: next })}
          />
          {form.raw_ideas.trim() && <SpeakButton text={form.raw_ideas} label="Relire mes idées à voix haute" />}
        </div>
        <Textarea
          aria-label="Vos idées pour le livre"
          className="min-h-48 text-lg leading-relaxed"
          placeholder="Cliquez sur « Parler dans le micro » ci-dessus ou écrivez vos idées ici…"
          value={form.raw_ideas}
          onChange={(e) => update({ raw_ideas: e.target.value })}
        />
      </Card>

      <Card className="space-y-4 p-6">
        <h2 className="font-serif text-xl font-bold">Combien de chapitres pour ce livre ?</h2>
        <p className="text-base text-muted">
          Indiquez le nombre de chapitres souhaité (entre {MIN_CHAPTERS} et {MAX_CHAPTERS}). Par défaut : {DEFAULT_CHAPTERS} chapitres.
        </p>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            aria-label="Un chapitre de moins"
            className="h-14 w-14 text-2xl font-bold"
            disabled={chaptersInput !== '' && Number(chaptersInput) <= MIN_CHAPTERS}
            onClick={() => setChapters(clampChapters((Number(chaptersInput) || DEFAULT_CHAPTERS) - 1))}
          >
            −
          </Button>
          <Input
            aria-label="Nombre de chapitres"
            type="number"
            inputMode="numeric"
            min={MIN_CHAPTERS}
            max={MAX_CHAPTERS}
            step={1}
            className="h-14 w-28 text-center text-2xl font-bold"
            value={chaptersInput}
            onChange={(e) => {
              const raw = e.target.value;
              setChaptersInput(raw);
              const n = Number(raw);
              if (raw !== '' && Number.isInteger(n) && n >= MIN_CHAPTERS && n <= MAX_CHAPTERS) {
                update({ length_preset: 'CUSTOM', target_chapter_count: n });
              }
            }}
            onBlur={() => setChapters(clampChapters(chaptersInput === '' ? DEFAULT_CHAPTERS : Number(chaptersInput)))}
          />
          <Button
            type="button"
            variant="secondary"
            aria-label="Un chapitre de plus"
            className="h-14 w-14 text-2xl font-bold"
            disabled={Number(chaptersInput) >= MAX_CHAPTERS}
            onClick={() => setChapters(clampChapters((Number(chaptersInput) || DEFAULT_CHAPTERS) + 1))}
          >
            +
          </Button>
          <span className="text-lg">chapitres</span>
        </div>
      </Card>

      <ErrorNote error={error} />

      <div className="flex justify-end pt-2">
        <Button
          disabled={!canAnalyze || busy || running}
          className="h-16 w-full px-8 text-xl font-bold sm:w-auto"
          onClick={() =>
            void run(async () => {
              await flushAllAutosaves();
              await api.analyze(project.id);
            })
          }
        >
          <Sparkles size={24} />
          {running ? 'Préparation de votre histoire en cours…' : 'Étape suivante : Préparer le résumé de mon histoire'}
        </Button>
      </div>
    </div>
  );
}

function SimpleStep2({ project }: { project: Project }) {
  const [feedback, setFeedback] = useState('');
  const { busy, doing, error, run } = useAction();
  const save = useAutoSave<string>((reformulated_concept) => pb.collection('projects').update(project.id, { reformulated_concept }));
  const job = useProjectStore((s) => s.activeJob);
  const running = job !== null;
  const refMemory = project.reference_meta?.story_memory;
  const characters = project.story_bible?.characters ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      {refMemory && (
        <Card className="space-y-3 border-2 border-accent/30 bg-accent-soft/40 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-serif text-xl font-bold">Ce que nous avons retenu de votre ancien livre</h2>
            <SpeakButton text={`${refMemory.summary}. ${refMemory.ending_state}`} label="Écouter ce rappel" />
          </div>
          <p className="text-base leading-relaxed">{refMemory.summary}</p>
          {refMemory.ending_state && (
            <p className="text-base leading-relaxed">
              <strong>Fin de votre premier livre :</strong> {refMemory.ending_state}
            </p>
          )}
        </Card>
      )}

      <Card className="space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-serif text-2xl font-bold">Le résumé de votre nouvelle histoire</h1>
          <SpeakButton text={project.reformulated_concept} label="Écouter le résumé" />
        </div>
        <p className="text-base text-muted">
          Voici le fil conducteur préparé à partir de votre ancien livre et de vos idées. Vous pouvez le corriger directement dans le texte ci-dessous, ou demander une modification au micro plus bas.
        </p>
        <div className="rounded-lg border border-line bg-paper p-4">
          <RichTextEditor value={project.reformulated_concept} onChange={save} ariaLabel="Résumé de votre histoire" />
        </div>
      </Card>

      {characters.length > 0 && (
        <Card className="space-y-3 p-6">
          <h2 className="font-serif text-xl font-bold">Les personnages de votre histoire</h2>
          <ul className="space-y-2 text-base">
            {characters.map((c) => (
              <li key={c.id} className="rounded-lg border border-line bg-paper p-3">
                <strong className="font-semibold">{c.name}</strong> ({c.role}) — {c.traits}.{' '}
                <span className="text-muted">Situation : {c.current_status}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="space-y-4 p-6">
        <h2 className="font-serif text-xl font-bold">Vous voulez modifier quelque chose ?</h2>
        <p className="text-base text-muted">
          Dites au micro ou écrivez ce qu'il faut changer (par exemple : « Change la fin », « Ajoute le personnage de mon frère Paul »).
        </p>
        <VoiceDictationButton
          label="Dicter ma demande au micro"
          value={feedback}
          onChange={setFeedback}
        />
        <Textarea
          aria-label="Vos consignes pour modifier le résumé"
          className="min-h-24 text-base"
          placeholder="Écrivez ou dictez ici ce que vous souhaitez changer…"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
        />
        <Button
          variant="secondary"
          disabled={busy || running || !feedback.trim()}
          className="h-12 px-6 text-base font-semibold"
          onClick={() =>
            void run(async () => {
              await flushAllAutosaves();
              await api.analyze(project.id, feedback.trim());
              setFeedback('');
            })
          }
        >
          <RefreshCw size={18} /> Refaire le résumé avec mes indications
        </Button>
      </Card>

      <ErrorNote error={error} />

      <div className="flex justify-end pt-2">
        <Button
          disabled={busy || running}
          loading={doing === 'outline'}
          className="h-16 w-full px-8 text-xl font-bold sm:w-auto"
          onClick={() =>
            void run(async () => {
              await flushAllAutosaves();
              await api.outline(project.id);
            }, 'outline')
          }
        >
          {doing === 'outline' ? 'Création des chapitres en cours…' : 'Ce résumé me convient : Créer le plan des chapitres'}
          <ArrowRight size={22} />
        </Button>
      </div>
    </div>
  );
}

function SimpleChapterItem({ chapter }: { chapter: Chapter }) {
  const [form, setForm] = useState({ title: chapter.title, brief_summary: chapter.brief_summary });
  const save = useAutoSave<Partial<Chapter>>((data) => pb.collection('chapters').update(chapter.id, data));

  const update = (patch: Partial<typeof form>) => {
    const next = { ...form, ...patch };
    setForm(next);
    save({ ...next, user_edited_outline: true });
  };

  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-serif text-xl font-bold text-accent">Chapitre {chapter.chapter_number}</span>
        <VoiceDictationButton
          label="Dicter la suite de ce chapitre"
          value={form.brief_summary}
          onChange={(next) => update({ brief_summary: next })}
        />
      </div>
      <Input
        aria-label={`Titre du chapitre ${chapter.chapter_number}`}
        className="h-12 text-lg font-semibold"
        value={form.title}
        onChange={(e) => update({ title: e.target.value })}
      />
      <Textarea
        aria-label={`Résumé du chapitre ${chapter.chapter_number}`}
        className="min-h-24 text-base leading-relaxed"
        value={form.brief_summary}
        onChange={(e) => update({ brief_summary: e.target.value })}
      />
    </Card>
  );
}

function SimpleStep3({ project }: { project: Project }) {
  const chapters = useProjectStore((s) => s.chapters);
  const loadChapters = useProjectStore((s) => s.loadChapters);
  const job = useProjectStore((s) => s.activeJob);
  const [feedback, setFeedback] = useState('');
  const { busy, doing, error, run } = useAction();

  const fullOutlineText = chapters.map((c) => `Chapitre ${c.chapter_number}, ${c.title}. ${c.brief_summary}`).join('\n\n');

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <Card className="space-y-3 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-serif text-2xl font-bold">Le plan de vos {chapters.length} chapitres</h1>
          <SpeakButton text={fullOutlineText} label="Écouter tout le plan" />
        </div>
        <p className="text-base text-muted">
          Voici le découpage de votre livre chapitre par chapitre. Vous pouvez retoucher directement un chapitre ou demander un changement général en bas de la page.
        </p>
      </Card>

      <div className="space-y-4">
        {chapters.map((c) => (
          <SimpleChapterItem key={c.id} chapter={c} />
        ))}
      </div>

      <Card className="space-y-4 p-6">
        <h2 className="font-serif text-xl font-bold">Demander une modification du plan</h2>
        <VoiceDictationButton
          label="Dicter ma demande au micro"
          value={feedback}
          onChange={setFeedback}
        />
        <Textarea
          aria-label="Consignes pour modifier le plan"
          placeholder="Par exemple : « Ajoute un chapitre sur son enfance au village »…"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
        />
        <Button
          variant="secondary"
          disabled={busy || !feedback.trim()}
          loading={doing === 'outline'}
          className="h-12 px-6 text-base font-semibold"
          onClick={() =>
            void run(async () => {
              await flushAllAutosaves();
              await api.outline(project.id, feedback.trim());
              setFeedback('');
              await loadChapters();
            }, 'outline')
          }
        >
          <RefreshCw size={18} /> Refaire le plan avec mes indications
        </Button>
      </Card>

      <ErrorNote error={error} />

      <div className="flex justify-end pt-2">
        <Button
          disabled={busy || job !== null || chapters.length === 0}
          className="h-16 w-full px-8 text-xl font-bold sm:w-auto"
          onClick={() =>
            void run(async () => {
              await flushAllAutosaves();
              await api.sample(project.id);
            })
          }
        >
          Ce plan me convient : Écrire les premières pages <ArrowRight size={22} />
        </Button>
      </div>
    </div>
  );
}

function SimpleStep4({ project }: { project: Project }) {
  const job = useProjectStore((s) => s.activeJob);
  const { busy, doing, error, run } = useAction();
  const save = useAutoSave<string>((sample_text) => pb.collection('projects').update(project.id, { sample_text }));
  const generating = job?.kind === 'SAMPLE';
  const canApprove = project.status === 'STEP_4_SAMPLE_REVIEW';

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <Card className="space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-serif text-2xl font-bold">Vos premières pages</h1>
          {!generating && <SpeakButton text={project.sample_text} label="Écouter ces pages" />}
        </div>
        <p className="text-base text-muted">
          Lisez ou écoutez ce début du premier chapitre pour vérifier que le ton et le style d'écriture vous plaisent. Vous pouvez corriger le texte librement.
        </p>
        <div className="rounded-lg border border-line bg-paper p-5">
          {generating ? (
            <StreamingViewer text={project.sample_draft} label="première scène" />
          ) : (
            <RichTextEditor value={project.sample_text} onChange={save} ariaLabel="Texte des premières pages" />
          )}
        </div>
      </Card>

      <ErrorNote error={error} />

      <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
        <Button
          variant="secondary"
          disabled={busy || generating}
          className="h-14 px-6 text-base font-semibold"
          onClick={() =>
            void run(async () => {
              await flushAllAutosaves();
              await api.sample(project.id);
            })
          }
        >
          <RefreshCw size={18} /> Proposer un autre début
        </Button>

        {canApprove && (
          <Button
            disabled={busy || generating}
            loading={doing === 'approve'}
            className="h-16 flex-1 px-8 text-xl font-bold sm:flex-initial"
            onClick={() =>
              void run(async () => {
                await flushAllAutosaves();
                await api.approveSample(project.id);
              }, 'approve')
            }
          >
            <Check size={22} /> {doing === 'approve' ? 'Validation…' : 'Ce style me convient : Écrire la suite du livre'}
          </Button>
        )}
      </div>
    </div>
  );
}

function SimpleSceneItem({ scene, showPartHeader }: { scene: Scene; showPartHeader: boolean }) {
  const saveContent = useAutoSave<string>((content) => pb.collection('scenes').update(scene.id, { content }));
  return (
    <div className="space-y-3 rounded-xl border border-line bg-paper p-5">
      {showPartHeader && (
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-muted">Partie {scene.scene_number}</span>
          {scene.content.trim() && <SpeakButton text={scene.content} label={`Écouter la partie ${scene.scene_number}`} />}
        </div>
      )}
      {scene.status === 'GENERATING' && <StreamingViewer text={scene.draft} />}
      {(scene.status === 'REVIEW' || scene.status === 'APPROVED') && (
        <RichTextEditor
          value={scene.content}
          onChange={scene.status === 'REVIEW' ? saveContent : undefined}
          readOnly={scene.status === 'APPROVED'}
          ariaLabel={`Texte de la partie ${scene.scene_number}`}
        />
      )}
    </div>
  );
}

function SimpleStep5Book({ project }: { project: Project }) {
  const chapters = useProjectStore((s) => s.chapters);
  const scenes = useProjectStore((s) => s.scenes);
  const job = useProjectStore((s) => s.activeJob);
  const activeId = useProjectStore((s) => s.activeChapterId);
  const setActive = useProjectStore((s) => s.setActiveChapter);
  const loadScenes = useProjectStore((s) => s.loadScenes);
  const { busy, doing, error, run } = useAction();
  const [dictatedChange, setDictatedChange] = useState('');

  useEffect(() => {
    if (activeId && chapters.some((c) => c.id === activeId)) return;
    const next = chapters.find((c) => c.status !== 'APPROVED') ?? chapters[0];
    if (next) setActive(next.id);
  }, [activeId, chapters, setActive]);

  useEffect(() => {
    if (activeId) loadScenes(activeId).catch(() => toastError('Impossible de charger les scènes de ce chapitre.'));
  }, [activeId, loadScenes]);

  const index = chapters.findIndex((c) => c.id === activeId);
  const chapter = chapters[index];
  const previous = chapters[index - 1];
  const prevChapter = index > 0 ? chapters[index - 1] : undefined;
  const nextChapter = index >= 0 && index < chapters.length - 1 ? chapters[index + 1] : undefined;

  const running = job !== null;
  const remainingChapters = chapters.filter((c) => c.status !== 'APPROVED').length;
  const writtenCount = chapters.filter((c) => c.status === 'APPROVED' || c.status === 'REVIEW').length;
  const chapterFullText = scenes
    .map((s) => s.content.trim())
    .filter(Boolean)
    .join('\n\n');
  const hasPendingScenes = scenes.some((s) => s.status === 'PENDING');
  const allReview = scenes.length > 0 && scenes.every((s) => s.status === 'REVIEW');
  const blockedByPrevious = previous && previous.status !== 'APPROVED';

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      {remainingChapters > 0 && !running && (
        <Card className="flex flex-wrap items-center justify-between gap-4 border-2 border-accent/40 bg-accent-soft/50 p-6">
          <div className="space-y-1">
            <h2 className="font-serif text-xl font-bold">Écrire tout le livre automatiquement</h2>
            <p className="text-base text-muted">
              Il reste {remainingChapters} {remainingChapters > 1 ? 'chapitres' : 'chapitre'} à terminer. L'application peut rédiger toute la suite d'un seul coup.
            </p>
          </div>
          <Button
            disabled={busy}
            loading={doing === 'write-all'}
            className="h-14 px-6 text-lg font-bold"
            onClick={() =>
              void run(async () => {
                await flushAllAutosaves();
                await api.writeAll(project.id);
              }, 'write-all')
            }
          >
            <Wand2 size={20} /> Écrire tout le reste du livre
          </Button>
        </Card>
      )}

      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Choisir un chapitre ({chapters.length - remainingChapters} sur {chapters.length} terminés)</h2>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={!prevChapter}
              onClick={() => prevChapter && setActive(prevChapter.id)}
              className="h-11 px-4 text-base"
            >
              <ArrowLeft size={18} /> Précédent
            </Button>
            <Button
              variant="secondary"
              disabled={!nextChapter}
              onClick={() => nextChapter && setActive(nextChapter.id)}
              className="h-11 px-4 text-base"
            >
              Suivant <ArrowRight size={18} />
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {chapters.map((c) => {
            const isCurrent = c.id === activeId;
            const isDone = c.status === 'APPROVED';
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setActive(c.id)}
                className={cn(
                  'cursor-pointer rounded-lg border-2 px-4 py-2 text-base font-semibold transition-colors',
                  isCurrent
                    ? 'border-accent bg-accent text-white'
                    : isDone
                      ? 'border-ok/40 bg-ok/10 text-ok hover:bg-ok/20'
                      : 'border-line bg-paper text-ink hover:bg-accent-soft',
                )}
              >
                Chapitre {c.chapter_number} {isDone && '✓'}
              </button>
            );
          })}
        </div>
      </Card>

      {chapter && (
        <Card className="space-y-5 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
            <div>
              <Badge className="mb-2 text-sm">
                {chapter.status === 'APPROVED'
                  ? 'Chapitre terminé et validé'
                  : chapter.status === 'REVIEW'
                    ? 'Chapitre prêt à relire'
                    : chapter.status === 'GENERATING'
                      ? 'Écriture en cours…'
                      : 'Chapitre à écrire'}
              </Badge>
              <h1 className="font-serif text-2xl font-bold">
                Chapitre {chapter.chapter_number} : {chapter.title}
              </h1>
              <p className="mt-1 text-base text-muted">{chapter.brief_summary}</p>
            </div>
            {chapterFullText && <SpeakButton text={chapterFullText} label="Écouter ce chapitre" />}
          </div>

          <ErrorNote error={error} />

          {blockedByPrevious && (
            <p className="rounded-lg bg-accent-soft p-4 text-base font-medium text-accent">
              Pour garder une histoire cohérente, validez d'abord le Chapitre {previous.chapter_number}.
            </p>
          )}

          {!blockedByPrevious && (chapter.status === 'PENDING' || chapter.status === 'PLANNED' || chapter.status === 'ERROR' || hasPendingScenes) && (
            <div className="py-4">
              <Button
                disabled={busy || running}
                className="h-16 w-full px-8 text-xl font-bold sm:w-auto"
                onClick={() =>
                  void run(async () => {
                    await flushAllAutosaves();
                    await api.writeChapter(chapter.id);
                  }, 'write')
                }
              >
                <PenLine size={22} /> Rédiger le Chapitre {chapter.chapter_number} maintenant
              </Button>
            </div>
          )}

          <div className="space-y-6">
            {scenes.map((s) => (
              <SimpleSceneItem key={`${s.id}:${s.status}`} scene={s} showPartHeader={scenes.length > 1} />
            ))}
          </div>

          {chapter.status === 'REVIEW' && allReview && (
            <div className="space-y-5 border-t border-line pt-5">
              <div className="flex flex-wrap gap-4">
                <Button
                  disabled={busy || running}
                  loading={doing === 'approve'}
                  className="h-16 flex-1 px-8 text-xl font-bold"
                  onClick={() =>
                    void run(async () => {
                      await flushAllAutosaves();
                      await api.approveChapter(chapter.id);
                      if (nextChapter) setActive(nextChapter.id);
                    }, 'approve')
                  }
                >
                  <Check size={22} />
                  {doing === 'approve'
                    ? 'Validation en cours…'
                    : nextChapter
                      ? `Valider ce chapitre et passer au Chapitre ${nextChapter.chapter_number}`
                      : 'Valider ce dernier chapitre'}
                </Button>
              </div>

              <div className="space-y-3 rounded-xl border border-line bg-paper p-4">
                <h3 className="font-serif text-lg font-bold">Ce chapitre ne vous convient pas tout à fait ?</h3>
                <p className="text-sm text-muted">
                  Dictez au micro ou écrivez ce que vous souhaitez changer dans ce chapitre, puis cliquez sur « Réécrire ce chapitre ».
                </p>
                <VoiceDictationButton
                  label="Dicter mes consignes pour ce chapitre"
                  value={dictatedChange}
                  onChange={setDictatedChange}
                />
                <Textarea
                  aria-label="Consignes pour réécrire ce chapitre"
                  value={dictatedChange}
                  onChange={(e) => setDictatedChange(e.target.value)}
                  placeholder="Exemple : « Ajoute le souvenir de la maison familiale »…"
                />
                <Button
                  variant="secondary"
                  disabled={busy || running}
                  className="h-12 px-5 text-base font-semibold"
                  onClick={() =>
                    void run(async () => {
                      await flushAllAutosaves();
                      if (dictatedChange.trim()) {
                        await pb.collection('chapters').update(chapter.id, {
                          brief_summary: `${chapter.brief_summary}\n\nConsigne de l'auteur : ${dictatedChange.trim()}`,
                        });
                        setDictatedChange('');
                      }
                      await api.rewriteChapter(chapter.id);
                    }, 'rewrite')
                  }
                >
                  <RefreshCw size={18} /> Réécrire ce chapitre
                </Button>
              </div>
            </div>
          )}

          {(chapter.status === 'APPROVED' || chapter.status === 'STALE') && (
            <div className="flex flex-wrap gap-3 border-t border-line pt-4">
              <Button
                variant="secondary"
                disabled={busy || running}
                className="h-12 px-5 text-base font-semibold"
                onClick={() =>
                  void run(async () => {
                    await flushAllAutosaves();
                    await api.reopenChapter(chapter.id);
                  }, 'reopen')
                }
              >
                Déverrouiller ce chapitre pour le modifier
              </Button>
            </div>
          )}
        </Card>
      )}

      {writtenCount > 0 && (
        <Card className="space-y-4 border-2 border-accent/30 p-6">
          <div className="flex items-center gap-2">
            <BookOpen className="text-accent" size={24} />
            <h2 className="font-serif text-2xl font-bold">Récupérer ou imprimer mon livre « {project.title} »</h2>
          </div>
          <p className="text-base text-muted">
            Téléchargez votre manuscrit mis en page pour l'imprimer sur papier ou le lire sur une tablette.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              variant="secondary"
              disabled={busy}
              className="h-14 text-lg font-semibold"
              onClick={() =>
                void run(async () => {
                  await flushAllAutosaves();
                  await api.exportBook(project.id, 'docx', false);
                })
              }
            >
              <Download size={20} /> Télécharger pour Imprimer / Word (.docx)
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              className="h-14 text-lg font-semibold"
              onClick={() =>
                void run(async () => {
                  await flushAllAutosaves();
                  await api.exportBook(project.id, 'epub', false);
                })
              }
            >
              <Download size={20} /> Télécharger pour Liseuse / Tablette (.epub)
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

export function SimpleWorkspace({ project }: { project: Project }) {
  const activeStepView = useProjectStore((s) => s.activeStepView);
  const setStep = useProjectStore((s) => s.setStep);

  return (
    <div>
      <SimpleStepper status={project.status} active={activeStepView} onSelect={setStep} />
      {activeStepView === 1 && <SimpleStep1 key={project.id} project={project} />}
      {activeStepView === 2 && <SimpleStep2 project={project} />}
      {activeStepView === 3 && <SimpleStep3 project={project} />}
      {activeStepView === 4 && <SimpleStep4 project={project} />}
      {(activeStepView === 5 || activeStepView === 6) && <SimpleStep5Book project={project} />}
    </div>
  );
}
