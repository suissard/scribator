import { AlertCircle, ArrowLeft, Check, Feather, LogOut } from 'lucide-react';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { pb } from '@/api/pocketbase';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { useSaveStatus } from '@/lib/autosaveRegistry';
import { getMockMode, subscribeMockMode } from '@/lib/mockState';
import { useUiMode } from '@/lib/uiMode';
import { LogPanel } from './LogPanel';
import { MockToggle } from './MockToggle';
import { SettingsModal } from './SettingsModal';
import { UsageBadge } from './UsageBadge';

function SaveStatusPill() {
  const status = useSaveStatus();
  if (status === 'idle') return null;
  if (status === 'saving') {
    return (
      <span role="status" className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-0.5 text-xs text-muted">
        <Spinner size={12} />
        <span className="hidden sm:inline">Enregistrement…</span>
      </span>
    );
  }
  if (status === 'saved') {
    return (
      <span role="status" className="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2.5 py-0.5 text-xs font-medium text-ok">
        <Check size={12} />
        <span className="hidden sm:inline">Enregistré</span>
      </span>
    );
  }
  return (
    <span role="status" className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2.5 py-0.5 text-xs font-medium text-danger">
      <AlertCircle size={12} />
      <span className="hidden sm:inline">Non enregistré</span>
    </span>
  );
}

export function AppShell({
  children,
  usageKey,
  projectTitle,
  showSaveStatus = false,
}: {
  children: ReactNode;
  usageKey?: unknown;
  projectTitle?: string;
  showSaveStatus?: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { isSimple } = useUiMode();
  const isMock = useSyncExternalStore(subscribeMockMode, getMockMode);
  const [confirmLogout, setConfirmLogout] = useState(false);

  const isDashboard = location.pathname === '/';

  const logout = () => {
    pb.authStore.clear();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-2 border-b border-line bg-paper/95 px-3 backdrop-blur sm:gap-4 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <Link to="/" className="flex shrink-0 items-center gap-2 font-serif text-xl font-semibold">
            <Feather size={20} className="text-accent" />
            <span className={isDashboard ? undefined : 'hidden sm:inline'}>Scribator</span>
          </Link>
          {!isDashboard && (
            <Button asChild variant="secondary" size="sm" className="shrink-0">
              <Link to="/">
                <ArrowLeft size={15} /> Mes livres
              </Link>
            </Button>
          )}
          {projectTitle && (
            <span
              className="hidden min-w-0 max-w-xs truncate border-l border-line pl-3 font-serif text-base font-semibold text-ink md:inline lg:max-w-md"
              title={projectTitle}
            >
              {projectTitle}
            </span>
          )}
          {showSaveStatus && <SaveStatusPill />}
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
          {isSimple ? (
            isMock && (
              <span className="hidden rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-700 sm:inline">
                Mode démo
              </span>
            )
          ) : (
            <>
              <MockToggle />
              <UsageBadge refreshKey={usageKey} />
              <Link to="/privacy" className="hidden text-xs text-muted hover:text-ink sm:inline">
                Confidentialité
              </Link>
              <LogPanel />
            </>
          )}
          <SettingsModal />
          <span className="h-5 w-px bg-line" aria-hidden="true" />
          <Button
            variant="ghost"
            size={isSimple ? 'sm' : 'icon'}
            aria-label="Se déconnecter"
            title="Se déconnecter"
            onClick={() => (isSimple ? setConfirmLogout(true) : logout())}
          >
            <LogOut size={17} />
            {isSimple && <span className="hidden sm:inline">Se déconnecter</span>}
          </Button>
        </div>
      </header>
      <main className="flex-1">{children}</main>

      <Dialog
        open={confirmLogout}
        onOpenChange={setConfirmLogout}
        title="Se déconnecter de Scribator ?"
        description="Votre travail est enregistré. Vous devrez saisir vos identifiants pour revenir."
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmLogout(false)}>
            Rester connecté
          </Button>
          <Button variant="primary" onClick={logout}>
            Se déconnecter
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
