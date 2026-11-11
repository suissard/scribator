import { Feather, LogOut } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { pb } from '@/api/pocketbase';
import { Button } from '@/components/ui/button';
import { LogPanel } from './LogPanel';
import { MockToggle } from './MockToggle';
import { UsageBadge } from './UsageBadge';

export function AppShell({ children, usageKey }: { children: ReactNode; usageKey?: unknown }) {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-line bg-paper/95 px-4 backdrop-blur">
        <Link to="/" className="flex items-center gap-2 font-serif text-lg font-semibold">
          <Feather size={18} className="text-accent" /> Scribator
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <MockToggle />
          <UsageBadge refreshKey={usageKey} />
          <Link to="/privacy" className="hidden text-xs text-muted hover:text-ink sm:inline">
            Confidentialité
          </Link>
          <LogPanel />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Se déconnecter"
            title="Se déconnecter"
            onClick={() => {
              pb.authStore.clear();
              navigate('/login');
            }}
          >
            <LogOut size={16} />
          </Button>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
