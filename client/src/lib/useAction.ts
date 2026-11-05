import { useCallback, useState } from 'react';
import { ApiError } from '@/api/server';
import { reportError } from './errorReporting';

export interface ActionError {
  message: string;
  requestId?: string;
}

/** Exécute une action en gérant l'état occupé et une erreur lisible, jamais une pile d'appels. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);

  const run = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      if (e instanceof ApiError) {
        setError({ message: e.message, ...(e.requestId ? { requestId: e.requestId } : {}) });
      } else {
        const message = e instanceof Error ? e.message : String(e);
        reportError(message, e instanceof Error ? e.stack : undefined);
        const status = (e as { status?: number }).status;
        setError({ message: status === 400 || status === 404 ? "Cette modification n'a pas été acceptée." : 'Une erreur est survenue.' });
      }
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, error, run, clearError: useCallback(() => setError(null), []) };
}
