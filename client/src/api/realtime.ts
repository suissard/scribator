import type { RecordModel, RecordSubscription } from 'pocketbase';
import { getMockMode } from '@/lib/mockState';
import { pb } from './pocketbase';

type Handler<T> = (e: RecordSubscription<T & RecordModel>) => void;

/** Renvoie une fonction de désabonnement utilisable directement dans un useEffect. */
export function subscribe<T>(collection: string, filter: string, handler: Handler<T>): () => void {
  if (getMockMode()) {
    // Écoute les CustomEvents mock si émis dans la fenêtre
    const onMockUpdate = (e: Event) => {
      const custom = e as CustomEvent<{ id?: string; record?: any }>;
      const id = custom.detail?.id;
      if (!id) return;
      void pb
        .collection(collection)
        .getOne(id)
        .then((record) => {
          handler({ action: 'update', record: record as unknown as T & RecordModel });
        })
        .catch(() => {});
    };

    const eventName = `mock-${collection.replace(/s$/, '')}-updated`;
    window.addEventListener(eventName, onMockUpdate);
    return () => {
      window.removeEventListener(eventName, onMockUpdate);
    };
  }

  let stopped = false;
  let unsubscribe: (() => Promise<void>) | undefined;
  void pb
    .collection(collection)
    .subscribe<T & RecordModel>('*', handler, { filter })
    .then((un) => {
      if (stopped) void un();
      else unsubscribe = un;
    });
  return () => {
    stopped = true;
    void unsubscribe?.();
  };
}

/**
 * Filtre anti-écho (§6) : tout ce que ce client a envoyé récemment est mémorisé. L'événement Realtime
 * qui renvoie une ancienne frappe ne doit ni écraser une frappe plus récente ni faire sauter le curseur.
 */
export function createEchoGuard(max = 50) {
  const recent: string[] = [];
  return {
    sent(value: string) {
      recent.push(value);
      if (recent.length > max) recent.shift();
    },
    isEcho: (incoming: string) => recent.includes(incoming),
  };
}
