import { useSyncExternalStore } from 'react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** Toutes les sauvegardes en attente de l'écran : validation et régénération les vident avant d'appeler le serveur. */
const flushers = new Set<() => Promise<void>>();

let currentStatus: SaveStatus = 'idle';
let activeSaves = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const statusListeners = new Set<() => void>();

function emitStatus() {
  statusListeners.forEach((l) => l());
}

export function notifySaving(): void {
  clearTimeout(idleTimer);
  activeSaves += 1;
  if (currentStatus !== 'saving') {
    currentStatus = 'saving';
    emitStatus();
  }
}

export function notifySaved(): void {
  clearTimeout(idleTimer);
  activeSaves = Math.max(0, activeSaves - 1);
  if (activeSaves === 0) {
    currentStatus = 'saved';
    emitStatus();
    idleTimer = setTimeout(() => {
      if (activeSaves === 0 && currentStatus === 'saved') {
        currentStatus = 'idle';
        emitStatus();
      }
    }, 4000);
  }
}

export function notifySaveError(): void {
  clearTimeout(idleTimer);
  activeSaves = Math.max(0, activeSaves - 1);
  currentStatus = 'error';
  emitStatus();
}

export function resetSaveStatus(): void {
  clearTimeout(idleTimer);
  activeSaves = 0;
  if (currentStatus !== 'idle') {
    currentStatus = 'idle';
    emitStatus();
  }
}

export function useSaveStatus(): SaveStatus {
  return useSyncExternalStore(
    (listener) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    () => currentStatus,
  );
}

export function registerFlush(flush: () => Promise<void>): () => void {
  flushers.add(flush);
  return () => flushers.delete(flush);
}

export async function flushAllAutosaves(): Promise<void> {
  await Promise.all([...flushers].map((f) => f()));
}
