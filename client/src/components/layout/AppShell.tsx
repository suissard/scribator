import { BookOpen, Feather, LogOut } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { pb } from '@/api/pocketbase';
import { Button } from '@/components/ui/button';
import { useUiMode } from '@/lib/uiMode';
import { LogPanel } from './LogPanel';
import { MockToggle } from './MockToggle';
import { SettingsModal } from './SettingsModal';
import { UsageBadge } from './UsageBadge';

export function AppShell({ children, usageKey }: { children: ReactNode; usageKey?: unknown }) {
  const navigate = useNavigate();
  const { isSimple } = useUiMode();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-line bg-paper/95 px-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 font-serif text-xl font-semibold">
            <Feather size={20} className="text-accent" /> Scribator
          </Link>
          {isSimple && (
            <Button asChild variant="secondary" size="md" className="hidden sm:inline-flex">
              <Link to="/">
                <BookOpen size={18} /> Mes livres
              </Link>
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <MockToggle />
          {!isSimple && <UsageBadge refreshKey={usageKey} />}
          {!isSimple && (
            <Link to="/privacy" className="hidden text-xs text-muted hover:text-ink sm:inline">
              Confidentialité
            </Link>
          )}
          {!isSimple && <LogPanel />}
          <SettingsModal />
          <Button
            variant="ghost"
            size={isSimple ? 'md' : 'icon'}
            aria-label="Se déconnecter"
            title="Se déconnecter"
            onClick={() => {
              pb.authStore.clear();
              navigate('/login');
            }}
          >
            <LogOut size={18} />
            {isSimple && <span className="hidden sm:inline">Quitter</span>}
          </Button>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
