import { Check, Settings } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useUiMode, type FontScale, type UiMode } from '@/lib/uiMode';
import { cn } from '@/lib/utils';
import { MockToggle } from './MockToggle';

const MODES: Array<{ id: UiMode; title: string; desc: string }> = [
  {
    id: 'simple',
    title: 'Mode Simple et Accessible (Par défaut)',
    desc: 'Conçu pour une utilisation facile : grands boutons, dictée à la voix au microphone, écoute du texte à haute voix, aucun terme technique.',
  },
  {
    id: 'expert',
    title: 'Mode Studio Complet (Avancé)',
    desc: 'Affiche toutes les options techniques : réglage fin du style littéraire, Bible complète des personnages, découpage scène par scène et choix du modèle IA.',
  },
];

const SCALES: Array<{ id: FontScale; label: string }> = [
  { id: 'normal', label: 'Normale' },
  { id: 'large', label: 'Grande (recommandé)' },
  { id: 'xlarge', label: 'Très grande' },
];

export function SettingsModal() {
  const [open, setOpen] = useState(false);
  const { mode, fontScale, setMode, setFontScale, isSimple } = useUiMode();

  return (
    <>
      <Button
        variant="ghost"
        size={isSimple ? 'md' : 'sm'}
        onClick={() => setOpen(true)}
        aria-label="Ouvrir les paramètres d'affichage"
        className={cn(isSimple && 'px-3 text-base font-medium text-ink')}
      >
        <Settings size={isSimple ? 18 : 15} />
        <span className={isSimple ? undefined : 'hidden md:inline'}>Paramètres</span>
      </Button>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Paramètres d'affichage et de confort"
        description="Adaptez l'application selon vos besoins visuels ou votre habitude de l'informatique."
        wide
      >
        <div className="space-y-6">
          <div className="space-y-3">
            <h3 className="text-base font-semibold">Choix de l'interface</h3>
            <div className="grid gap-3">
              {MODES.map((m) => {
                const active = mode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setMode(m.id)}
                    className={cn(
                      'flex w-full cursor-pointer items-start justify-between gap-4 rounded-lg border-2 p-4 text-left transition-colors',
                      active ? 'border-accent bg-accent-soft' : 'border-line bg-card hover:bg-accent-soft/40',
                    )}
                  >
                    <div className="space-y-1">
                      <span className="block text-base font-semibold">{m.title}</span>
                      <span className="block text-sm text-muted">{m.desc}</span>
                    </div>
                    {active && <Check size={22} className="mt-1 shrink-0 text-accent" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-base font-semibold">Taille des caractères</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              {SCALES.map((s) => {
                const active = fontScale === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setFontScale(s.id)}
                    className={cn(
                      'cursor-pointer rounded-lg border-2 px-4 py-3 text-center font-medium transition-colors',
                      active ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-card hover:bg-accent-soft/40',
                    )}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <Link
                to="/privacy"
                onClick={() => setOpen(false)}
                className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
              >
                Confidentialité et compte
              </Link>
              <MockToggle />
            </div>
            <Button variant="primary" size="lg" onClick={() => setOpen(false)}>
              Fermer
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
