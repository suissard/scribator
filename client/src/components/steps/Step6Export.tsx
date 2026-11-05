import { Download } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/api/server';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { flushAllAutosaves } from '@/lib/autosaveRegistry';
import type { Project } from '@/lib/types';
import { useAction } from '@/lib/useAction';
import { useProjectStore } from '@/store/useProjectStore';

const FORMATS = [
  { id: 'docx', label: 'Word (DOCX)' },
  { id: 'epub', label: 'Livre numérique (EPUB)' },
  { id: 'md', label: 'Markdown' },
] as const;

export function Step6Export({ project }: { project: Project }) {
  const chapters = useProjectStore((s) => s.chapters);
  const [notice, setNotice] = useState(false);
  const { busy, error, run } = useAction();
  const done = chapters.filter((c) => c.status === 'APPROVED').length;
  return (
    <div className="mx-auto max-w-xl space-y-4 p-4 sm:p-6">
      <Card className="space-y-4">
        <h2 className="font-semibold">Exporter « {project.title} »</h2>
        <p className="text-sm text-muted">{done} chapitres validés sur {chapters.length}.</p>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 accent-[var(--color-accent)]" checked={notice} onChange={(e) => setNotice(e.target.checked)} />
          <span>Ajouter la page « Écrit avec l'assistance d'une IA », que certaines plateformes de publication exigent.</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {FORMATS.map((f) => (
            <Button
              key={f.id}
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await flushAllAutosaves();
                  await api.exportBook(project.id, f.id, notice);
                })
              }
            >
              <Download size={14} /> {f.label}
            </Button>
          ))}
        </div>
        <ErrorNote error={error} />
      </Card>
    </div>
  );
}
