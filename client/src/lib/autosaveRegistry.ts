/** Toutes les sauvegardes en attente de l'écran : validation et régénération les vident avant d'appeler le serveur. */
const flushers = new Set<() => Promise<void>>();

export function registerFlush(flush: () => Promise<void>): () => void {
  flushers.add(flush);
  return () => flushers.delete(flush);
}

export async function flushAllAutosaves(): Promise<void> {
  await Promise.all([...flushers].map((f) => f()));
}
