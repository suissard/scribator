import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  FileUp,
  PenLine,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { pb } from '@/api/pocketbase';
import { api } from '@/api/server';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { StreamingViewer } from '@/components/editor/StreamingViewer';
import { maxStep } from '@/components/layout/StepIndicator';
import { AiFeedbackCard } from '@/components/steps/AiFeedbackCard';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { Field, Input, Textarea } from '@/components/ui/field';
import { SpeakButton, VoiceDictationButton } from '@/components/ui/VoiceTools';
import { flushAllAutosaves } from '@/lib/autosaveRegistry';
import { canWriteAll } from '@/lib/bookWork';
import { toastError, toastSuccess } from '@/lib/toast';
import { STATUS_ORDER, type Chapter, type ChapterStatus, type Project, type Scene } from '@/lib/types';
import { useAction } from '@/lib/useAction';
import { useAutoSave } from '@/lib/useAutoSave';
import { cn, formatNumber } from '@/lib/utils';
import { useProjectStore, type StepView } from '@/store/useProjectStore';

const MAX_BYTES = 20 * 1024 * 1024;

const SIMPLE_STEPS: Array<{ view: StepView; label: string }> = [
  { view: 1, label: '1. Mon projet' },
  { view: 2, label: '2. Le résumé' },
  { view: 3, label: '3. Les chapitres' },
  { view: 4, label: '4. Mon livre' },
];

const DEFAULT_CHAPTERS = 5;
const MIN_CHAPTERS = 1;
const MAX_CHAPTERS = 60;

const CHAPTER_STATUS_INFO: Record<ChapterStatus, { label: string; className: string }> = {
  PENDING: { label: 'À rédiger', className: 'bg-surface text-muted' },
  PLANNED: { label: 'À rédiger', className: 'bg-surface text-muted' },
  GENERATING: { label: 'Écriture en cours…', className: 'bg-accent-soft text-accent' },
  REVIEW: { label: 'Prêt à relire', className: 'bg-accent-soft text-accent' },
  APPROVED: { label: 'Terminé et validé', className: 'bg-ok-soft text-ok' },
  STALE: { label: 'À actualiser', className: 'bg-stale/15 text-stale' },
  ERROR: { label: "Erreur d'écriture", className: 'bg-danger-soft text-danger' },
};

function clampChapters(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_CHAPTERS;
  return Math.min(MAX_CHAPTERS, Math.max(MIN_CHAPTERS, Math.round(n)));
}

export function SimpleStepper({
  status,
  active,
  onSelect,
}: {
  status: Project['status'];
  active: StepView;
  onSelect(s: StepView): void;
}) {
  const unlocked = maxStep(status);
  const currentView = active >= 4 ? 4 : active;
  return (
    <nav aria-label="Étapes de votre livre" className="border-b border-line bg-card px-4 py-2.5">
      <div className="mx-auto flex max-w-4xl flex-nowrap gap-2 overflow-x-auto">
        {SIMPLE_STEPS.map(({ view, label }) => {
          const enabled = view <= unlocked;
          const isCurrent = view === currentView;
          const done = view < unlocked && !isCurrent;
          return (
            <button
              key={view}
              type="button"
              disabled={!enabled}
              aria-current={isCurrent ? 'step' : undefined}
              onClick={() => onSelect(view)}
              className={cn(
                'flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border-2 px-3.5 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 sm:text-base',
                isCurrent
                  ? 'border-accent bg-accent-soft font-bold text-accent'
                  : done
                    ? 'border-ok/30 bg-paper text-ink hover:border-accent/60 hover:bg-accent-soft/60'
                    : enabled
                      ? 'border-line bg-paper text-ink hover:border-accent/60 hover:bg-accent-soft/60'
                      : 'border-line bg-paper text-muted',
              )}
            >
              {done && <Check size={16} className="text-ok" aria-hidden="true" />}
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
  const setStep = useProjectStore((s) => s.setStep);
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
  const [showRef, setShowRef] = useState(Boolean(project.reference_file || project.reference_meta));
  const [confirmReanalyze, setConfirmReanalyze] = useState(false);
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
      toastSuccess('Ancien livre enregistré.');
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
  const approxPages = Math.max(1, Math.round((form.target_chapter_count * form.target_words_per_chapter) / 250));

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <Card className="space-y-4 p-6">
        <div className="space-y-1">
          <h1 className="font-serif text-2xl font-bold">1. Racontez votre histoire</h1>
          <p className="text-base text-muted">
            Expliquez librement ce que vous voulez raconter dans ce livre : vos personnages, le cadre, les grands événements et comment l'histoire se termine.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <VoiceDictationButton
            label="Parler dans le micro"
            value={form.raw_ideas}
            onChange={(next) => update({ raw_ideas: next })}
          />
          {form.raw_ideas.trim() && <SpeakButton compact text={form.raw_ideas} label="Relire mes idées" />}
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
        <div className="space-y-1">
          <h2 className="font-serif text-xl font-bold">2. Longueur du livre</h2>
          <p className="text-base text-muted">
            Choisissez le nombre de chapitres souhaité (entre {MIN_CHAPTERS} et {MAX_CHAPTERS}). Par défaut : {DEFAULT_CHAPTERS} chapitres.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            aria-label="Un chapitre de moins"
            className="min-h-12 w-12 text-xl font-bold"
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
            className="h-12 w-24 text-center text-xl font-bold"
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
            className="min-h-12 w-12 text-xl font-bold"
            disabled={Number(chaptersInput) >= MAX_CHAPTERS}
            onClick={() => setChapters(clampChapters((Number(chaptersInput) || DEFAULT_CHAPTERS) + 1))}
          >
            +
          </Button>
          <span className="text-base font-medium text-ink">
            {form.target_chapter_count > 1 ? 'chapitres' : 'chapitre'}{' '}
            <span className="text-muted">(environ {formatNumber(approxPages)} pages)</span>
          </span>
        </div>
      </Card>

      <Card className="p-5">
        <button
          type="button"
          aria-expanded={showRef}
          onClick={() => setShowRef((v) => !v)}
          className="flex w-full cursor-pointer items-center justify-between gap-3 text-left"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-serif text-lg font-bold">C'est la suite d'un livre existant ? (facultatif)</span>
            {uploaded && <Badge className="bg-ok-soft text-ok">Ancien livre enregistré ✓</Badge>}
          </div>
          {showRef ? <ChevronUp size={20} className="shrink-0 text-muted" /> : <ChevronDown size={20} className="shrink-0 text-muted" />}
        </button>

        {showRef && (
          <div className="mt-4 space-y-3 border-t border-line pt-4">
            <p className="text-base text-muted">
              Si vous avez déjà écrit un livre (PDF, Word, EPUB ou Texte), déposez-le ici : l'application retrouvera votre style d'écriture, vos personnages et votre histoire.
            </p>
            <label
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed p-6 text-center transition-colors',
                uploaded ? 'border-ok bg-ok-soft/60 text-ok' : 'border-accent/45 bg-accent-soft/40 hover:bg-accent-soft',
              )}
            >
              <FileUp size={30} className={uploaded ? 'text-ok' : 'text-accent'} />
              <span className="text-base font-semibold">
                {uploaded || 'Cliquez ici pour choisir votre ancien livre (PDF, Word, EPUB ou Texte)'}
              </span>
              <span className="text-xs text-muted">
                {uploaded
                  ? 'Cliquez à nouveau sur cette zone pour remplacer le fichier. Il est supprimé après analyse.'
                  : "En déposant ce fichier, vous confirmez en être l'auteur. Il est supprimé automatiquement après l'analyse."}
              </span>
              <input
                type="file"
                className="sr-only"
                disabled={busy || running}
                accept=".pdf,.docx,.epub,.txt"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </label>
          </div>
        )}
      </Card>

      <Card className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-serif text-lg font-bold">Titre du livre</h2>
          <VoiceDictationButton
            compact
            label="Dicter le titre"
            value={form.title}
            onChange={(next) => update({ title: next })}
          />
        </div>
        <Input
          aria-label="Titre du livre"
          className="h-12 text-lg font-medium"
          value={form.title}
          onChange={(e) => update({ title: e.target.value })}
        />
      </Card>

      <ErrorNote error={error} />

      <div className="space-y-3 pt-1">
        {!canAnalyze && (
          <p className="text-sm text-muted">
            {!form.title.trim()
              ? 'Indiquez un titre pour votre livre ci-dessus afin de continuer.'
              : 'Racontez quelques idées ci-dessus (ou déposez votre ancien livre) pour passer à la suite.'}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {alreadyAnalyzed ? (
            <>
              <Button
                variant="secondary"
                size="lg"
                disabled={!canAnalyze || busy || running}
                onClick={() => setConfirmReanalyze(true)}
              >
                <RefreshCw size={18} /> Relancer l'analyse
              </Button>
              <Button variant="primary" size="xl" className="w-full sm:w-auto" onClick={() => setStep(2)}>
                Voir le résumé <ArrowRight size={20} />
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              size="xl"
              disabled={!canAnalyze || busy || running}
              loading={running}
              className="ml-auto w-full sm:w-auto"
              onClick={launchAnalysis}
            >
              {!running && <Sparkles size={20} />}
              {running ? 'Préparation du résumé…' : 'Préparer le résumé'}
              {!running && <ArrowRight size={20} />}
            </Button>
          )}
        </div>
      </div>

      <Dialog
        open={confirmReanalyze}
        onOpenChange={setConfirmReanalyze}
        title="Relancer l'analyse de votre histoire ?"
        description="Le résumé actuel et la liste des personnages seront remplacés par une nouvelle proposition."
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

function SimpleStep2({ project }: { project: Project }) {
  const setStep = useProjectStore((s) => s.setStep);
  const [feedback, setFeedback] = useState('');
  const { busy, doing, error, run } = useAction();
  const save = useAutoSave<string>((reformulated_concept) => pb.collection('projects').update(project.id, { reformulated_concept }));
  const job = useProjectStore((s) => s.activeJob);
  const running = job !== null;
  const outlining = job?.kind === 'OUTLINE';
  const earlyStage = STATUS_ORDER.indexOf(project.status) <= 1;
  const refMemory = project.reference_meta?.story_memory;
  const characters = project.story_bible?.characters ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      {refMemory && (
        <Card className="space-y-3 border-2 border-accent/25 bg-accent-soft/40 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-serif text-lg font-bold">Ce que nous avons retenu de votre ancien livre</h2>
            <SpeakButton compact text={`${refMemory.summary}. ${refMemory.ending_state}`} label="Écouter ce rappel" />
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
          <h1 className="font-serif text-2xl font-bold">Le résumé de votre histoire</h1>
          <SpeakButton compact text={project.reformulated_concept} label="Écouter le résumé" />
        </div>
        <p className="text-sm text-muted">
          Vous pouvez cliquer directement dans le texte ci-dessous pour le corriger, ou demander un correctif à l'IA juste en dessous.
        </p>
        <div className="rounded-lg border border-line bg-paper p-4">
          <RichTextEditor value={project.reformulated_concept} onChange={save} ariaLabel="Résumé de votre histoire" />
        </div>
      </Card>

      {earlyStage && (
        <AiFeedbackCard
          simple
          voice
          title="Demander des correctifs à l'IA sur ce résumé"
          description="Dictez au micro ou écrivez vos indications : l'IA ajustera le résumé et les personnages selon vos demandes."
          placeholder="Par exemple : « Change la fin », « Ajoute le personnage de mon frère Paul »…"
          actionLabel="Appliquer mes correctifs"
          loadingLabel="Correction du résumé…"
          ariaLabel="Vos consignes pour modifier le résumé"
          value={feedback}
          onChange={setFeedback}
          disabled={busy || running}
          loading={doing === 'analyze' || job?.kind === 'ANALYZE'}
          onSubmit={() =>
            void run(async () => {
              await flushAllAutosaves();
              await api.analyze(project.id, feedback.trim());
              setFeedback('');
            }, 'analyze')
          }
        />
      )}

      <ErrorNote error={error} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="lg" onClick={() => setStep(1)}>
          <ArrowLeft size={18} /> Retour
        </Button>

        <Button
          variant="success"
          size="xl"
          disabled={busy || running}
          loading={doing === 'outline'}
          className="w-full sm:w-auto"
          onClick={() =>
            void run(async () => {
              await flushAllAutosaves();
              await api.outline(project.id);
            }, 'outline')
          }
        >
          {doing !== 'outline' && !outlining && <Check size={20} />}
          {doing === 'outline' || outlining ? 'Création des chapitres…' : 'Créer les chapitres'}
          {doing !== 'outline' && !outlining && <ArrowRight size={20} />}
        </Button>
      </div>

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
    </div>
  );
}

function SimpleChapterItem({
  chapter,
  index,
  total,
  locked,
  onMove,
  onDelete,
}: {
  chapter: Chapter;
  index: number;
  total: number;
  locked: boolean;
  onMove(dir: -1 | 1): void;
  onDelete(): void;
}) {
  const [form, setForm] = useState({ title: chapter.title, brief_summary: chapter.brief_summary });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = useAutoSave<Partial<Chapter>>((data) => pb.collection('chapters').update(chapter.id, data));
  const pending = chapter.status === 'PENDING';

  useEffect(() => {
    setForm({ title: chapter.title, brief_summary: chapter.brief_summary });
  }, [chapter.title, chapter.brief_summary]);

  const update = (patch: Partial<typeof form>) => {
    const next = { ...form, ...patch };
    setForm(next);
    save({ ...next, user_edited_outline: true });
  };

  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-serif text-xl font-bold text-accent">Chapitre {chapter.chapter_number}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {pending && (
            <>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Monter le chapitre ${chapter.chapter_number}`}
                title="Monter"
                disabled={locked || index === 0}
                onClick={() => onMove(-1)}
              >
                <ArrowUp size={16} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Descendre le chapitre ${chapter.chapter_number}`}
                title="Descendre"
                disabled={locked || index >= total - 1}
                onClick={() => onMove(1)}
              >
                <ArrowDown size={16} />
              </Button>
            </>
          )}
          <VoiceDictationButton
            compact
            label="Dicter"
            value={form.brief_summary}
            onChange={(next) => update({ brief_summary: next })}
          />
          {pending && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Supprimer le chapitre ${chapter.chapter_number}`}
              title="Supprimer ce chapitre"
              className="text-muted hover:bg-danger/10 hover:text-danger"
              disabled={locked}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={16} />
            </Button>
          )}
        </div>
      </div>
      <Field label="Titre du chapitre">
        <Input
          className="h-11 text-base font-semibold"
          value={form.title}
          onChange={(e) => update({ title: e.target.value })}
        />
      </Field>
      <Field label="Ce qui se passe dans ce chapitre">
        <Textarea
          className="min-h-24 text-base leading-relaxed"
          value={form.brief_summary}
          onChange={(e) => update({ brief_summary: e.target.value })}
        />
      </Field>

      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Supprimer le Chapitre ${chapter.chapter_number} ?`}
        description={`« ${form.title || 'Sans titre'} » sera retiré du plan de votre livre.`}
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
            Annuler
          </Button>
          <Button
            variant="dangerSolid"
            onClick={() => {
              setConfirmDelete(false);
              onDelete();
            }}
          >
            Supprimer
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}

function SimpleStep3({ project }: { project: Project }) {
  const chapters = useProjectStore((s) => s.chapters);
  const loadChapters = useProjectStore((s) => s.loadChapters);
  const setStep = useProjectStore((s) => s.setStep);
  const setActiveChapter = useProjectStore((s) => s.setActiveChapter);
  const job = useProjectStore((s) => s.activeJob);
  const [feedback, setFeedback] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const { busy, doing, error, run } = useAction();

  const fullOutlineText = chapters.map((c) => `Chapitre ${c.chapter_number}, ${c.title}. ${c.brief_summary}`).join('\n\n');
  const pendingIds = chapters.filter((c) => c.status === 'PENDING').map((c) => c.id);

  const moveChapter = (chapterId: string, dir: -1 | 1) => {
    const from = pendingIds.indexOf(chapterId);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= pendingIds.length) return;
    const next = [...pendingIds];
    [next[from], next[to]] = [next[to], next[from]];
    void run(async () => {
      await flushAllAutosaves();
      await api.reorder(project.id, next);
      await loadChapters();
    });
  };

  const deleteChapter = (chapterId: string) => {
    void run(async () => {
      await flushAllAutosaves();
      await api.deleteChapter(chapterId);
      await loadChapters();
      toastSuccess('Chapitre retiré du plan.');
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <Card className="space-y-2 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-serif text-2xl font-bold">Le plan de vos {chapters.length} chapitres</h1>
          <SpeakButton compact text={fullOutlineText} label="Écouter le plan" />
        </div>
        <p className="text-base text-muted">
          Voici le découpage de votre livre. Vous pouvez retoucher directement un chapitre, changer l'ordre avec les flèches, ou demander un ajustement général.
        </p>
      </Card>

      <div className="space-y-4">
        {chapters.map((c, idx) => (
          <SimpleChapterItem
            key={c.id}
            chapter={c}
            index={idx}
            total={chapters.length}
            locked={busy || job !== null}
            onMove={(dir) => moveChapter(c.id, dir)}
            onDelete={() => deleteChapter(c.id)}
          />
        ))}
      </div>

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newTitle.trim()) return;
          void run(async () => {
            await flushAllAutosaves();
            await api.addChapter(project.id, newTitle.trim());
            setNewTitle('');
            await loadChapters();
            toastSuccess('Chapitre ajouté.');
          });
        }}
      >
        <Input
          aria-label="Titre du nouveau chapitre"
          className="min-w-48 flex-1"
          placeholder="Titre d'un nouveau chapitre à ajouter…"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
        />
        <Button type="submit" variant="secondary" disabled={busy || !newTitle.trim()}>
          <Plus size={16} /> Ajouter un chapitre
        </Button>
      </form>

      <AiFeedbackCard
        simple
        voice
        title="Demander des correctifs à l'IA sur le plan"
        description="Dictez au micro ou écrivez vos ajustements. Les chapitres que vous avez déjà retouchés seront conservés."
        placeholder="Par exemple : « Ajoute un chapitre sur son enfance au village », « Rends la fin plus joyeuse »…"
        actionLabel="Appliquer mes correctifs au plan"
        loadingLabel="Correction du plan…"
        ariaLabel="Consignes pour modifier le plan"
        value={feedback}
        onChange={setFeedback}
        disabled={busy || job !== null}
        loading={doing === 'outline' || job?.kind === 'OUTLINE'}
        onSubmit={() =>
          void run(async () => {
            await flushAllAutosaves();
            await api.outline(project.id, feedback.trim());
            setFeedback('');
          }, 'outline')
        }
      />

      <ErrorNote error={error} />

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card/95 p-3 shadow-md backdrop-blur">
        <Button variant="ghost" size="lg" onClick={() => setStep(2)}>
          <ArrowLeft size={18} /> Résumé
        </Button>

        {project.status === 'STEP_3_OUTLINE_REVIEW' ? (
          <Button
            variant="primary"
            size="xl"
            disabled={busy || job !== null || chapters.length === 0}
            className="w-full sm:w-auto"
            onClick={() =>
              void run(async () => {
                await flushAllAutosaves();
                const first = chapters[0];
                if (!first) return;
                await api.writeChapter(first.id);
                setActiveChapter(first.id);
                setStep(4);
              })
            }
          >
            Écrire le premier chapitre <ArrowRight size={20} />
          </Button>
        ) : (
          <Button variant="primary" size="xl" className="w-full sm:w-auto" onClick={() => setStep(4)}>
            Continuer vers mon livre <ArrowRight size={20} />
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold text-muted">Partie {scene.scene_number}</span>
          {scene.content.trim() && <SpeakButton compact text={scene.content} label={`Écouter partie ${scene.scene_number}`} />}
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
  const [confirmRewrite, setConfirmRewrite] = useState(false);
  const [confirmWriteAll, setConfirmWriteAll] = useState(false);

  useEffect(() => {
    if (activeId && chapters.some((c) => c.id === activeId)) return;
    const next = chapters.find((c) => c.status !== 'APPROVED') ?? chapters[0];
    if (next) setActive(next.id);
  }, [activeId, chapters, setActive]);

  useEffect(() => {
    setDictatedChange('');
  }, [activeId]);

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
  const reviewCount = chapters.filter((c) => c.status === 'REVIEW').length;
  const approvedCount = chapters.length - remainingChapters;
  const allDone = chapters.length > 0 && remainingChapters === 0;
  const writtenCount = chapters.filter((c) => c.status === 'APPROVED' || c.status === 'REVIEW').length;
  const writeAllUseful = canWriteAll(chapters);
  const progressPct = chapters.length > 0 ? Math.round((approvedCount / chapters.length) * 100) : 0;

  const chapterFullText = scenes
    .map((s) => s.content.trim())
    .filter(Boolean)
    .join('\n\n');
  const hasPendingScenes = scenes.some((s) => s.status === 'PENDING');
  const hasWrittenScene = scenes.some((s) => s.status === 'REVIEW');
  const allReview = scenes.length > 0 && scenes.every((s) => s.status === 'REVIEW');
  const blockedByPrevious = previous && previous.status !== 'APPROVED';

  const exportFile = (format: 'docx' | 'epub') => {
    void run(async () => {
      await flushAllAutosaves();
      await api.exportBook(project.id, format, false);
      toastSuccess('Téléchargement lancé !');
    });
  };

  const rewriteCurrentChapter = (instructions?: string) => {
    if (!chapter) return;
    setConfirmRewrite(false);
    void run(async () => {
      await flushAllAutosaves();
      const note = instructions?.trim() || undefined;
      if (note) setDictatedChange('');
      await api.rewriteChapter(chapter.id, note);
    }, 'rewrite');
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      {allDone && (
        <Card className="space-y-4 border-2 border-ok/40 bg-ok-soft/60 p-6">
          <div className="flex items-start gap-3">
            <BookOpen className="mt-1 shrink-0 text-ok" size={28} />
            <div className="space-y-1">
              <h2 className="font-serif text-2xl font-bold text-ink">
                Félicitations, votre livre « {project.title} » est terminé !
              </h2>
              <p className="text-base text-muted">
                Tous vos chapitres sont validés. Téléchargez votre manuscrit mis en page pour l'imprimer ou le lire sur tablette.
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Button variant="primary" size="lg" disabled={busy} onClick={() => exportFile('docx')}>
              <Download size={20} /> Imprimer / Word (.docx)
            </Button>
            <Button variant="secondary" size="lg" disabled={busy} onClick={() => exportFile('epub')}>
              <Download size={20} /> Liseuse / Tablette (.epub)
            </Button>
          </div>
        </Card>
      )}

      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">
              Progression : {approvedCount} sur {chapters.length} chapitres validés
            </h2>
            <p className="text-xs tabular-nums text-muted">{progressPct} % du livre terminé</p>
          </div>
          {writeAllUseful && !running && (
            <Button
              variant="secondary"
              size="md"
              disabled={busy}
              loading={doing === 'write-all'}
              onClick={() => setConfirmWriteAll(true)}
            >
              <Wand2 size={18} /> Tout écrire automatiquement
            </Button>
          )}
        </div>

        <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface" aria-hidden="true">
          <div className="h-full rounded-full bg-ok transition-[width] duration-300" style={{ width: `${progressPct}%` }} />
        </div>

        <div className="flex flex-wrap gap-2">
          {chapters.map((c) => {
            const isCurrent = c.id === activeId;
            const isDone = c.status === 'APPROVED';
            const isReview = c.status === 'REVIEW';
            const isStale = c.status === 'STALE';
            const isError = c.status === 'ERROR';
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setActive(c.id)}
                className={cn(
                  'flex max-w-56 cursor-pointer items-center gap-2 rounded-lg border-2 px-3.5 py-2 text-left text-sm font-semibold transition-colors',
                  isCurrent
                    ? 'border-accent bg-accent-soft text-accent'
                    : isDone
                      ? 'border-ok/35 bg-ok-soft/60 text-ok hover:bg-ok-soft'
                      : isError
                        ? 'border-danger/40 bg-danger-soft text-danger'
                        : isStale
                          ? 'border-stale/40 bg-stale/10 text-stale'
                          : 'border-line bg-paper text-ink hover:bg-accent-soft/60',
                )}
              >
                <span className="shrink-0">Ch. {c.chapter_number}</span>
                {c.title && <span className="truncate font-normal text-muted">· {c.title}</span>}
                {isDone && <Check size={15} className="shrink-0 text-ok" aria-label="Validé" />}
                {isReview && (
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-accent">
                    <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
                    À relire
                  </span>
                )}
                {isStale && <AlertTriangle size={14} className="shrink-0 text-stale" aria-label="À actualiser" />}
                {isError && <AlertCircle size={14} className="shrink-0 text-danger" aria-label="Erreur" />}
              </button>
            );
          })}
        </div>
      </Card>

      {chapter && (
        <Card className="space-y-5 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
            <div className="min-w-0 flex-1">
              <Badge className={cn('mb-2 text-sm', CHAPTER_STATUS_INFO[chapter.status].className)}>
                {CHAPTER_STATUS_INFO[chapter.status].label}
              </Badge>
              <h1 className="font-serif text-2xl font-bold">
                Chapitre {chapter.chapter_number} : {chapter.title}
              </h1>
              <p className="mt-1 text-base text-muted">{chapter.brief_summary}</p>
            </div>
            {chapterFullText && <SpeakButton compact text={chapterFullText} label="Écouter ce chapitre" />}
          </div>

          <ErrorNote error={error} />

          {chapter.chapter_number === 1 && chapter.status !== 'APPROVED' && (
            <div className="rounded-lg border border-accent/25 bg-accent-soft/40 p-3.5 text-base text-ink">
              Ce premier chapitre sert d'échantillon pour votre livre. Lisez ou écoutez-le et corrigez librement le texte : vos retouches apprennent votre style à l'application pour la suite.
            </div>
          )}

          {blockedByPrevious && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-accent-soft p-4">
              <p className="text-base font-medium text-accent">
                Pour garder une histoire cohérente, validez d'abord le Chapitre {previous.chapter_number}.
              </p>
              <Button variant="secondary" size="md" onClick={() => setActive(previous.id)}>
                <ArrowLeft size={16} /> Aller au Chapitre {previous.chapter_number}
              </Button>
            </div>
          )}

          {!blockedByPrevious &&
            (chapter.status === 'PENDING' || chapter.status === 'PLANNED' || chapter.status === 'ERROR' || hasPendingScenes) && (
              <div className="py-2">
                <Button
                  variant="primary"
                  size="xl"
                  disabled={busy || running}
                  className="w-full sm:w-auto"
                  onClick={() =>
                    void run(async () => {
                      await flushAllAutosaves();
                      await api.writeChapter(chapter.id);
                    }, 'write')
                  }
                >
                  <PenLine size={20} />
                  {hasWrittenScene
                    ? `Reprendre le Chapitre ${chapter.chapter_number}`
                    : `Écrire le Chapitre ${chapter.chapter_number}`}
                </Button>
              </div>
            )}

          <div className="space-y-5">
            {scenes.map((s) => (
              <SimpleSceneItem key={`${s.id}:${s.status}`} scene={s} showPartHeader={scenes.length > 1} />
            ))}
          </div>

          {chapter.status === 'REVIEW' && allReview && (
            <div className="space-y-4 border-t border-line pt-5">
              {!blockedByPrevious && (
                <AiFeedbackCard
                  simple
                  voice
                  title="Demander des correctifs à l'IA sur ce chapitre"
                  description="Dictez au micro ou écrivez ce que vous souhaitez changer : l'IA réécrira ce chapitre en tenant compte de vos demandes."
                  placeholder="Exemple : « Ajoute le souvenir de la maison familiale », « Rends le dialogue plus chaleureux »…"
                  actionLabel="Appliquer mes correctifs"
                  loadingLabel="Réécriture en cours…"
                  ariaLabel="Consignes pour corriger ce chapitre"
                  value={dictatedChange}
                  onChange={setDictatedChange}
                  disabled={busy || running}
                  loading={doing === 'rewrite' || job?.kind === 'CHAPTER'}
                  onSubmit={() => rewriteCurrentChapter(dictatedChange)}
                />
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                {!blockedByPrevious ? (
                  <Button
                    variant="secondary"
                    size="lg"
                    disabled={busy || running}
                    onClick={() => setConfirmRewrite(true)}
                  >
                    <RefreshCw size={18} /> Réécrire tout le chapitre
                  </Button>
                ) : (
                  <span />
                )}

                <Button
                  variant="success"
                  size="xl"
                  disabled={busy || running}
                  loading={doing === 'approve'}
                  className="w-full sm:w-auto"
                  onClick={() =>
                    void run(async () => {
                      await flushAllAutosaves();
                      await api.approveChapter(chapter.id);
                      toastSuccess(`Chapitre ${chapter.chapter_number} validé !`);
                      if (nextChapter) setActive(nextChapter.id);
                    }, 'approve')
                  }
                >
                  {doing !== 'approve' && <Check size={20} />}
                  {doing === 'approve'
                    ? 'Validation en cours…'
                    : nextChapter
                      ? `Valider et passer au Chapitre ${nextChapter.chapter_number}`
                      : 'Valider ce dernier chapitre'}
                </Button>
              </div>
            </div>
          )}

          {chapter.status === 'STALE' && (
            <div className="space-y-3 rounded-xl border border-stale/35 bg-stale/10 p-4">
              <p className="flex items-start gap-2 text-base font-medium text-stale">
                <AlertTriangle size={20} className="mt-0.5 shrink-0" />
                <span>{chapter.stale_reason || 'Un chapitre précédent a changé : la mémoire de ce chapitre doit être actualisée.'}</span>
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="primary"
                  size="lg"
                  disabled={busy || running}
                  loading={doing === 'refresh'}
                  onClick={() =>
                    void run(async () => {
                      await flushAllAutosaves();
                      await api.refreshMemory(chapter.id);
                      toastSuccess('Mémoire du chapitre actualisée.');
                    }, 'refresh')
                  }
                >
                  Actualiser la mémoire
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  disabled={busy || running}
                  onClick={() =>
                    void run(async () => {
                      await flushAllAutosaves();
                      await api.reopenChapter(chapter.id);
                    }, 'reopen')
                  }
                >
                  Modifier ce chapitre
                </Button>
              </div>
            </div>
          )}

          {chapter.status === 'APPROVED' && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <span className="text-sm font-medium text-ok">Chapitre validé (lecture seule)</span>
              <Button
                variant="secondary"
                size="md"
                disabled={busy || running}
                onClick={() =>
                  void run(async () => {
                    await flushAllAutosaves();
                    await api.reopenChapter(chapter.id);
                  }, 'reopen')
                }
              >
                Déverrouiller pour modifier
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <Button
              variant="secondary"
              size="md"
              disabled={!prevChapter}
              onClick={() => prevChapter && setActive(prevChapter.id)}
            >
              <ArrowLeft size={16} /> Chapitre précédent
            </Button>
            {nextChapter && (
              <Button
                variant={chapter.status === 'APPROVED' && nextChapter.status !== 'APPROVED' ? 'primary' : 'secondary'}
                size="md"
                onClick={() => setActive(nextChapter.id)}
              >
                Chapitre suivant <ArrowRight size={16} />
              </Button>
            )}
          </div>
        </Card>
      )}

      {writtenCount > 0 && !allDone && (
        <Card className="space-y-4 p-5">
          <div className="flex items-center gap-2">
            <BookOpen className="text-muted" size={20} />
            <h2 className="font-serif text-xl font-bold">Télécharger un aperçu provisoire</h2>
          </div>
          <p className="text-sm text-muted">
            Vous pouvez déjà télécharger les chapitres rédigés pour les imprimer ou les relire sur tablette.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Button variant="secondary" size="lg" disabled={busy} onClick={() => exportFile('docx')}>
              <Download size={18} /> Imprimer / Word (.docx)
            </Button>
            <Button variant="secondary" size="lg" disabled={busy} onClick={() => exportFile('epub')}>
              <Download size={18} /> Liseuse / Tablette (.epub)
            </Button>
          </div>
        </Card>
      )}

      <Dialog
        open={confirmWriteAll}
        onOpenChange={setConfirmWriteAll}
        title="Écrire tout le reste du livre ?"
        description={
          `${remainingChapters > 1 ? `Les ${remainingChapters} chapitres restants seront rédigés et validés` : 'Le chapitre restant sera rédigé et validé'} automatiquement. ` +
          (reviewCount > 0
            ? `Attention : ${reviewCount > 1 ? `${reviewCount} chapitres en attente de relecture seront refaits` : 'un chapitre en attente de relecture sera refait'}. Les chapitres déjà validés ne changent pas.`
            : "Vous pourrez toujours rouvrir et corriger n'importe quel chapitre ensuite.")
        }
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmWriteAll(false)}>
            Annuler
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setConfirmWriteAll(false);
              void run(async () => {
                await flushAllAutosaves();
                await api.writeAll(project.id);
              }, 'write-all');
            }}
          >
            Tout écrire maintenant
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={confirmRewrite}
        onOpenChange={setConfirmRewrite}
        title={chapter ? `Réécrire tout le Chapitre ${chapter.chapter_number} ?` : 'Réécrire ce chapitre ?'}
        description="Le texte actuel de ce chapitre sera remplacé par une nouvelle version."
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmRewrite(false)}>
            Annuler
          </Button>
          <Button variant="primary" onClick={() => rewriteCurrentChapter()}>
            Réécrire ce chapitre
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

export function SimpleWorkspace({ project }: { project: Project }) {
  const activeStepView = useProjectStore((s) => s.activeStepView);

  return (
    <div>
      {activeStepView === 1 && <SimpleStep1 key={project.id} project={project} />}
      {activeStepView === 2 && <SimpleStep2 project={project} />}
      {activeStepView === 3 && <SimpleStep3 project={project} />}
      {(activeStepView === 4 || activeStepView === 5) && <SimpleStep5Book project={project} />}
    </div>
  );
}
