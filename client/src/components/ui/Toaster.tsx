import { AlertCircle, X } from 'lucide-react';
import { useToasts } from '@/lib/toast';

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div aria-live="assertive" className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-4 sm:items-end">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="alert"
          className="pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-md border border-danger/30 bg-card p-3 text-sm text-danger shadow-lg"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="break-words">{t.message}</p>
            {t.requestId && <p className="mt-0.5 text-xs opacity-80">Code : {t.requestId}</p>}
          </div>
          <button type="button" aria-label="Fermer" onClick={() => dismiss(t.id)} className="-m-1 shrink-0 cursor-pointer rounded p-1 hover:bg-danger/10">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
