import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { pb } from '@/api/pocketbase';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { useAction } from '@/lib/useAction';

export function Privacy() {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const { busy, error, run } = useAction();
  const id = pb.authStore.record?.id;
  return (
    <AppShell>
      <article className="mx-auto max-w-2xl space-y-4 p-4 text-sm leading-6 sm:p-6">
        <h1 className="font-serif text-2xl font-semibold">Confidentialité</h1>
        <h2 className="pt-2 font-semibold">Données collectées</h2>
        <p>Ton adresse e-mail, ton nom, les textes de tes livres, le fichier de référence le temps de son analyse, et le journal de tes appels à l'IA (coût, nombre de tokens).</p>
        <h2 className="pt-2 font-semibold">Transmission au fournisseur d'IA</h2>
        <p>Pour produire le texte, tes idées, ton concept, ta Bible, tes chapitres et des extraits de ton fichier de référence sont envoyés à OpenRouter, qui les transmet au fournisseur du modèle d'IA utilisé. Les fournisseurs susceptibles de stocker ces données sont exclus. Les extraits ne servent qu'à l'analyse de style et ne sont jamais réinjectés dans les prompts d'écriture.</p>
        <h2 className="pt-2 font-semibold">Conservation</h2>
        <p>Le fichier de référence est supprimé dès que l'analyse a réussi. Le texte complet des prompts est purgé du journal après 30 jours. Tes livres sont conservés jusqu'à ce que tu les supprimes.</p>
        <h2 className="pt-2 font-semibold">Hébergement</h2>
        <p>Les données sont hébergées dans l'Union européenne.</p>
        {id && (
          <>
            <h2 className="pt-2 font-semibold">Supprimer mon compte</h2>
            <p>Tous tes livres, chapitres, versions et journaux seront définitivement supprimés.</p>
            <Button variant="danger" onClick={() => setConfirming(true)}>Supprimer mon compte</Button>
          </>
        )}
      </article>
      <Dialog open={confirming} onOpenChange={setConfirming} title="Supprimer ton compte ?" description="Cette action est définitive.">
        <ErrorNote error={error} />
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirming(false)}>Annuler</Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await pb.collection('users').delete(id!);
                pb.authStore.clear();
                navigate('/login');
              })
            }
          >
            Tout supprimer
          </Button>
        </div>
      </Dialog>
    </AppShell>
  );
}
