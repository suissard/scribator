import { AlertTriangle, ArrowLeft, Download } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/api/server';
import { GenerationReport } from '@/components/review/GenerationReport';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { flushAllAutosaves } from '@/lib/autosaveRegistry';
import { toastSuccess } from '@/lib/toast';
import type { Project } from '@/lib/types';
import { useAction } from '@/lib/useAction';
import { useProjectStore } from '@/store/useProjectStore';

const FORMATS = [
  { id: 'docx', label: 'Word (DOCX)', desc: 'Pour imprimer ou retoucher le texte', primary: true },
  { id: 'epub', label: 'Livre numérique (EPUB)', desc: 'Pour liseuses Kindle, Kobo et tablettes', primary: false },
  { id: 'md', label: 'Markdown (.md)', desc: 'Texte brut avec mise en forme légère', primary: false },
] as const;

export function Step6Export({ project }: { project: Project }) {
  const chapters = useProjectStore((s) => s.chapters);
  const jobId = useProjectStore((s) => s.activeJob?.id);
  const setStep = useProjectStore((s) => s.setStep);
  const [notice, setNotice] = useState(false);
  const { busy, error, run } = useAction();
  const done = chapters.filter((c) => c.status === 'APPROVED').length;
  const partial = done > 0 && done < chapters.length;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <Card className="space-y-4">
        <div className="space-y-1">
          <h2 className="font-semibold">Exporter « {project.title} »</h2>
          <p className="text-sm text-muted">
            {done} chapitres validés sur {chapters.length}.
          </p>
        </div>

        {done === 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-stale/35 bg-stale/10 p-3 text-sm text-stale">
            <span className="flex items-center gap-2">
              <AlertTriangle size={16} className="shrink-0" />
              Aucun chapitre n'est encore validé. Validez au moins un chapitre dans le Studio avant d'exporter.
            </span>
            <Button variant="secondary" size="sm" onClick={() => setStep(4)}>
              <ArrowLeft size={14} /> Retour au Studio
            </Button>
          </div>
        )}

        {partial && (
          <p className="rounded-md bg-surface p-3 text-sm text-muted">
            Export partiel : seuls les {done} chapitres validés sur {chapters.length} seront inclus dans le fichier.
          </p>
        )}

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 accent-[var(--color-accent)]"
            checked={notice}
            onChange={(e) => setNotice(e.target.checked)}
          />
          <span>Ajouter la page « Écrit avec l'assistance d'une IA », que certaines plateformes de publication exigent.</span>
        </label>

        <div className="grid gap-3 sm:grid-cols-3">
          {FORMATS.map((f) => (
            <div key={f.id} className="flex flex-col gap-1.5">
              <Button
                variant={f.primary ? 'primary' : 'secondary'}
                size="md"
                className="w-full"
                disabled={busy || done === 0}
                onClick={() =>
                  void run(async () => {
                    await flushAllAutosaves();
                    await api.exportBook(project.id, f.id, notice);
                    toastSuccess(`Téléchargement ${f.id.toUpperCase()} lancé !`);
                  })
                }
              >
                <Download size={15} /> {f.label}
              </Button>
              <span className="text-center text-xs text-muted">{f.desc}</span>
            </div>
          ))}
        </div>

        <ErrorNote error={error} />
      </Card>
      <GenerationReport projectId={project.id} refreshKey={`${project.status}:${jobId ?? ''}`} />
    </div>
  );
}
