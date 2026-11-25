import { ArrowRight, BookOpen, Plus, Trash2 } from 'lucide-react';
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
import { toastSuccess } from '@/lib/toast';
import type { Project, ProjectStatus } from '@/lib/types';
import { useUiMode } from '@/lib/uiMode';
import { useAction } from '@/lib/useAction';
import { cn } from '@/lib/utils';

const LABELS: Record<ProjectStatus, string> = {
  STEP_1_INPUT: 'Étape 1 : Vos idées',
  STEP_2_CONCEPT_REVIEW: 'Étape 2 : Résumé à relire',
  STEP_3_OUTLINE_REVIEW: 'Étape 3 : Chapitres à relire',
  STEP_5_WRITING: 'Étape 4 : Écriture du livre',
  COMPLETED: 'Livre terminé',
};

const STEP_NUM: Record<ProjectStatus, number> = {
  STEP_1_INPUT: 1,
  STEP_2_CONCEPT_REVIEW: 2,
  STEP_3_OUTLINE_REVIEW: 3,
  STEP_5_WRITING: 4,
  COMPLETED: 4,
};

function formatUpdated(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `Modifié le ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

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
        user: pb.authStore.record?.id,
        title,
        language: 'fr',
        length_preset: 'ROMAN',
        target_chapter_count: 5,
        target_words_per_chapter: 3000,
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
            variant="primary"
            size={isSimple ? 'lg' : 'md'}
            onClick={() => setCreating(true)}
          >
            <Plus size={isSimple ? 20 : 16} /> Nouveau livre
          </Button>
        </div>
        <ErrorNote error={error} />

        {projects?.length === 0 && (
          <Card className="space-y-4 py-12 text-center">
            <BookOpen size={40} className="mx-auto text-muted" />
            <div className="space-y-1">
              <p className="text-lg font-medium text-ink">Vous n'avez pas encore de livre.</p>
              <p className="text-sm text-muted">Commencez un nouveau roman ou écrivez la suite d'un livre existant.</p>
            </div>
            <Button variant="primary" size={isSimple ? 'lg' : 'md'} onClick={() => setCreating(true)}>
              <Plus size={18} /> Créer mon premier livre
            </Button>
          </Card>
        )}

        <ul className={isSimple ? 'grid gap-4' : 'grid gap-3 sm:grid-cols-2'}>
          {projects?.map((p) => {
            const step = STEP_NUM[p.status];
            const completed = p.status === 'COMPLETED';
            const updatedLabel = formatUpdated(p.updated);
            return (
              <li key={p.id}>
                <Card className="flex flex-wrap items-center justify-between gap-4 p-5 transition-colors hover:border-accent/50">
                  <Link to={`/projects/${p.id}`} className="min-w-0 flex-1 space-y-2">
                    <span className="block truncate font-serif text-xl font-bold sm:text-2xl">{p.title}</span>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={cn(completed ? 'bg-ok-soft text-ok' : undefined, isSimple ? 'text-sm' : undefined)}>
                        {LABELS[p.status]}
                      </Badge>
                      <span className="text-xs tabular-nums text-muted">Étape {step}/4</span>
                      {p.genre && <span className="text-xs text-muted">· {p.genre}</span>}
                    </div>
                    {updatedLabel && <span className="block text-xs text-muted">{updatedLabel}</span>}
                  </Link>

                  <div className="flex shrink-0 items-center gap-2">
                    <Button asChild variant="secondary" size={isSimple ? 'md' : 'sm'}>
                      <Link to={`/projects/${p.id}`}>
                        {completed ? 'Consulter' : 'Continuer'} <ArrowRight size={15} />
                      </Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted hover:bg-danger/10 hover:text-danger"
                      aria-label={`Supprimer ${p.title}`}
                      title={`Supprimer ${p.title}`}
                      onClick={() => setToDelete(p)}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      </div>

      <Dialog open={creating} onOpenChange={setCreating} title="Commencer un nouveau livre">
        <form onSubmit={create} className="space-y-4">
          <Field label="Comment s'appelle votre nouveau livre ?" hint="Vous pourrez modifier ce titre à tout moment.">
            <Input autoFocus required className="h-12 text-lg" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          {isSimple && (
            <VoiceDictationButton
              compact
              label="Dicter le titre au micro"
              value={title}
              onChange={setTitle}
            />
          )}
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
              Annuler
            </Button>
            <Button type="submit" variant="primary" size={isSimple ? 'lg' : 'md'} loading={busy}>
              Créer et commencer
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={toDelete !== null}
        onOpenChange={() => setToDelete(null)}
        title="Supprimer ce livre ?"
        description={`« ${toDelete?.title ?? ''} » et tout son contenu seront définitivement supprimés.`}
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setToDelete(null)}>
            Annuler
          </Button>
          <Button
            variant="dangerSolid"
            loading={busy}
            onClick={() =>
              void run(async () => {
                await pb.collection('projects').delete(toDelete!.id);
                setProjects((list) => list?.filter((p) => p.id !== toDelete!.id) ?? null);
                setToDelete(null);
                toastSuccess('Livre supprimé.');
              })
            }
          >
            Supprimer définitivement
          </Button>
        </div>
      </Dialog>
    </AppShell>
  );
}
