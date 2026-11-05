import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}

export function Dialog({ open, onOpenChange, title, description, children, wide }: Props) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <D.Content
          aria-describedby={undefined}
          className={`fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg bg-card p-6 shadow-xl ${wide ? 'max-w-3xl' : 'max-w-md'}`}
        >
          <D.Title className="pr-8 text-lg font-semibold">{title}</D.Title>
          {description && <D.Description className="mt-1 text-sm text-muted">{description}</D.Description>}
          <D.Close className="absolute right-4 top-4 cursor-pointer text-muted hover:text-ink" aria-label="Fermer">
            <X size={18} />
          </D.Close>
          <div className="mt-4">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
