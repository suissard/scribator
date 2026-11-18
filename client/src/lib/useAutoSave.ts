import { useEffect, useMemo, useRef } from 'react';
import { registerFlush } from './autosaveRegistry';
import { debounce, type AutoSave } from './debounce';
import { reportError } from './errorReporting';
import { toastError } from './toast';

/** Auto-save à 1 000 ms, enregistré auprès du registre de flush et vidé au démontage. */
export function useAutoSave<T>(save: (value: T) => Promise<unknown>): AutoSave<T> {
  const latest = useRef(save);
  latest.current = save;
  const auto = useMemo(
    () => debounce<T>((v) => latest.current(v), 1000, (e) => {
        reportError(`Échec de l'auto-save : ${String(e)}`);
        toastError("Ta dernière modification n'a pas pu être enregistrée. Vérifie ta connexion puis réessaie.");
      }),
    [],
  );
  useEffect(() => {
    const unregister = registerFlush(auto.flush);
    return () => {
      unregister();
      void auto.flush();
    };
  }, [auto]);
  return auto;
}
