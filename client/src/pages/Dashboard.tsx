import { BookOpen, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { pb } from '@/api/pocketbase';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { Field, Input } from '@/components/ui/field';
import { VoiceDictationButton } from '@/components/ui/VoiceTools';
import type { Project, ProjectStatus } from '@/lib/types';
import { useUiMode } from '@/lib/uiMode';
import { useAction } from '@/lib/useAction';

const LABELS: Record<ProjectStatus, string> = {
  STEP_1_INPUT: 'Étape 1 : Vos idées',
  STEP_2_CONCEPT_REVIEW: 'Étape 2 : Résumé à relire',
  STEP_3_OUTLINE_REVIEW: 'Étape 3 : Chapitres à relire',
  STEP_4_SAMPLE_REVIEW: 'Étape 4 : Premières pages',
  STEP_5_WRITING: 'Étape 5 : Écriture du livre',
  COMPLETED: 'Livre terminé',
};

export function Dashboard() {
  const navigate = useNavigate();
  const { isSimple } = useUiMode();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<Project | null>(null);
  const [title, setTitle] = useState('');
  const { busy, error, run } = useAction();

  useEffect(() => {
    void run(async () => setProjects(await pb.collection('projects').getFullList<Project>({ sort: '-updated', fields: 'id,title,status,genre,updated' })));
  }, [run]);

  const create = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const p = await pb.collection('projects').create({
        user: pb.authStore.record?.id, title, language: 'fr', length_preset: 'ROMAN', target_chapter_count: 12, target_words_per_chapter: 3000,
      });
      navigate(`/projects/${p.id}`);
    });
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="font-serif text-3xl font-bold">Mes livres</h1>
          <Button
            onClick={() => setCreating(true)}
            className={isSimple ? 'h-14 px-6 text-lg font-bold' : undefined}
          >
            <Plus size={isSimple ? 22 : 16} /> Écrire un nouveau livre (ou une suite)
          </Button>
        </div>
        <ErrorNote error={error} />
        {projects?.length === 0 && (
          <Card className="py-12 text-center">
            <BookOpen size={36} className="mx-auto text-muted" />
            <p className="mt-3 text-lg text-muted">Vous n'avez pas encore de livre. Cliquez sur « Écrire un nouveau livre » pour commencer.</p>
          </Card>
        )}
        <ul className={isSimple ? 'grid gap-4' : 'grid gap-3 sm:grid-cols-2'}>
          {projects?.map((p) => (
            <li key={p.id}>
              <Card className="flex items-center justify-between gap-4 p-5 hover:border-accent">
                <Link to={`/projects/${p.id}`} className="min-w-0 flex-1 space-y-2">
                  <span className="block truncate font-serif text-2xl font-bold">{p.title}</span>
                  <Badge className="text-sm">{LABELS[p.status]}</Badge>
                </Link>
                {isSimple ? (
                  <Button asChild className="h-12 px-6 text-base font-bold">
                    <Link to={`/projects/${p.id}`}>Ouvrir mon livre</Link>
                  </Button>
                ) : (
                  <Button variant="ghost" size="icon" aria-label={`Supprimer ${p.title}`} onClick={() => setToDelete(p)}>
                    <Trash2 size={14} />
                  </Button>
                )}
              </Card>
            </li>
          ))}
        </ul>
      </div>

      <Dialog open={creating} onOpenChange={setCreating} title="Commencer un nouveau livre">
        <form onSubmit={create} className="space-y-4">
          <Field label="Comment s'appelle votre nouveau livre ? (vous pourrez le changer plus tard)">
            <Input autoFocus required className="h-12 text-lg" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          {isSimple && (
            <VoiceDictationButton
              label="Dicter le titre au micro"
              onTranscript={(spoken) => setTitle((prev) => (prev.trim() ? `${prev.trim()} ${spoken}` : spoken))}
            />
          )}
          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={busy} className="h-12 px-6 text-base font-bold">
              Continuer
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={toDelete !== null} onOpenChange={() => setToDelete(null)} title="Supprimer ce livre ?" description={`« ${toDelete?.title ?? ''} » et tout son contenu seront définitivement supprimés.`}>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setToDelete(null)}>Annuler</Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await pb.collection('projects').delete(toDelete!.id);
                setProjects((list) => list?.filter((p) => p.id !== toDelete!.id) ?? null);
                setToDelete(null);
              })
            }
          >
            Supprimer
          </Button>
        </div>
      </Dialog>
    </AppShell>
  );
}
