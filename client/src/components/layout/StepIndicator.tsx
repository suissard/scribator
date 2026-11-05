import { Check } from 'lucide-react';
import { STATUS_ORDER, type ProjectStatus } from '@/lib/types';
import { cn } from '@/lib/utils';
import type { StepView } from '@/store/useProjectStore';

const STEPS: Array<{ view: StepView; label: string }> = [
  { view: 1, label: 'Paramètres' },
  { view: 2, label: 'Concept' },
  { view: 3, label: 'Trame' },
  { view: 4, label: 'Échantillon' },
  { view: 5, label: 'Studio' },
  { view: 6, label: 'Export' },
];

export const maxStep = (status: ProjectStatus) => (STATUS_ORDER.indexOf(status) + 1) as StepView;

export function StepIndicator({ status, active, onSelect }: { status: ProjectStatus; active: StepView; onSelect(step: StepView): void }) {
  const unlocked = maxStep(status);
  return (
    <nav aria-label="Étapes du projet" className="flex gap-1 overflow-x-auto border-b border-line bg-card px-4 py-2">
      {STEPS.map(({ view, label }) => {
        // L'export reste accessible dès qu'il y a un studio : on peut exporter un livre inachevé.
        const enabled = view <= unlocked || (view === 6 && unlocked >= 5);
        return (
          <button
            key={view}
            type="button"
            disabled={!enabled}
            aria-current={view === active ? 'step' : undefined}
            onClick={() => onSelect(view)}
            className={cn(
              'flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:text-muted/50',
              view === active ? 'bg-accent-soft font-medium text-accent' : enabled && 'hover:bg-accent-soft/60',
            )}
          >
            {view < unlocked ? <Check size={14} /> : <span className="w-3.5 text-center text-xs">{view}</span>}
            {label}
          </button>
        );
      })}
    </nav>
  );
}
