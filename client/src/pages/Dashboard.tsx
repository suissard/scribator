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
import type { Project, ProjectStatus } from '@/lib/types';
import { useAction } from '@/lib/useAction';

const LABELS: Record<ProjectStatus, string> = {
  STEP_1_INPUT: 'Paramètres',
  STEP_2_CONCEPT_REVIEW: 'Concept à valider',
  STEP_3_OUTLINE_REVIEW: 'Trame à valider',
  STEP_4_SAMPLE_REVIEW: 'Échantillon à valider',
  STEP_5_WRITING: 'Écriture',
  COMPLETED: 'Terminé',
};

export function Dashboard() {
  const navigate = useNavigate();
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
        user: pb.authStore.record?.id, title, language: 'fr', length_preset: 'ROMAN', target_chapter_count: 20, target_words_per_chapter: 3500,
      });
      navigate(`/projects/${p.id}`);
    });
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="font-serif text-2xl font-semibold">Mes livres</h1>
          <Button onClick={() => setCreating(true)}><Plus size={16} /> Nouveau livre</Button>
        </div>
        <ErrorNote error={error} />
        {projects?.length === 0 && (
          <Card className="py-12 text-center">
            <BookOpen className="mx-auto text-muted" />
            <p className="mt-2 text-sm text-muted">Aucun livre pour l'instant. Commence par en créer un.</p>
          </Card>
        )}
        <ul className="grid gap-3 sm:grid-cols-2">
          {projects?.map((p) => (
            <li key={p.id}>
              <Card className="flex items-start justify-between gap-2 p-4 hover:border-accent/50">
                <Link to={`/projects/${p.id}`} className="min-w-0 flex-1">
                  <span className="block truncate font-serif text-lg font-semibold">{p.title}</span>
                  <Badge className="mt-2">{LABELS[p.status]}</Badge>
                </Link>
                <Button variant="ghost" size="icon" aria-label={`Supprimer ${p.title}`} onClick={() => setToDelete(p)}>
                  <Trash2 size={14} />
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      </div>

      <Dialog open={creating} onOpenChange={setCreating} title="Nouveau livre">
        <form onSubmit={create} className="space-y-4">
          <Field label="Titre (provisoire)">
            <Input autoFocus required value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <div className="flex justify-end"><Button type="submit" disabled={busy}>Créer</Button></div>
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
