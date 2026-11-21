import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useToasts } from '@/lib/toast';
import { cn } from '@/lib/utils';

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-4 sm:items-end">
      {toasts.map((t) => {
        const isError = t.tone === 'error';
        const isSuccess = t.tone === 'success';
        const Icon = isError ? AlertCircle : isSuccess ? CheckCircle2 : Info;
        return (
          <div
            key={t.id}
            role={isError ? 'alert' : 'status'}
            aria-live={isError ? 'assertive' : 'polite'}
            className={cn(
              'pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-md border bg-card p-3 text-sm shadow-lg',
              isError && 'border-danger/30 text-danger',
              isSuccess && 'border-ok/35 text-ok',
              !isError && !isSuccess && 'border-line text-ink',
            )}
          >
            <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="break-words">{t.message}</p>
              {t.requestId && <p className="mt-0.5 text-xs opacity-80">Code : {t.requestId}</p>}
            </div>
            <button
              type="button"
              aria-label="Fermer"
              onClick={() => dismiss(t.id)}
              className={cn(
                '-m-1 shrink-0 cursor-pointer rounded p-1',
                isError ? 'hover:bg-danger/10' : isSuccess ? 'hover:bg-ok/10' : 'hover:bg-accent-soft/60',
              )}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
