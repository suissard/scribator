import { Database, Sparkles } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { getMockMode, setMockMode, subscribeMockMode } from '@/lib/mockState';

export function MockToggle() {
  const isMock = useSyncExternalStore(subscribeMockMode, getMockMode);

  const toggle = () => {
    const next = !isMock;
    setMockMode(next);
    // Recharge pour réinitialiser les connexions / stores proprement
    window.location.reload();
  };

  return (
    <Button
      variant={isMock ? 'secondary' : 'ghost'}
      size="sm"
      onClick={toggle}
      title={isMock ? 'Mode Mock actif (cliquer pour passer en mode Réel)' : 'Mode Réel actif (cliquer pour passer en mode Mock)'}
      className={`h-8 gap-1.5 text-xs font-medium ${
        isMock
          ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 hover:bg-amber-500/25'
          : 'text-muted hover:text-ink'
      }`}
    >
      {isMock ? (
        <>
          <Sparkles size={13} className="text-amber-500" />
          <span>Mode Démo / Mock</span>
        </>
      ) : (
        <>
          <Database size={13} />
          <span>API Réelle</span>
        </>
      )}
    </Button>
  );
}
