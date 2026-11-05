/** Debounce asynchrone avec `flush()` (§10.2) : flush envoie la dernière valeur et attend sa sauvegarde. */
export interface AutoSave<T> {
  (value: T): void;
  flush(): Promise<void>;
  cancel(): void;
}

export function debounce<T>(fn: (value: T) => Promise<unknown>, waitMs: number, onError?: (e: unknown) => void): AutoSave<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { value: T } | undefined;
  let chain: Promise<unknown> = Promise.resolve();

  const run = () => {
    timer = undefined;
    if (!pending) return chain;
    const { value } = pending;
    pending = undefined;
    // Sauvegardes en série : une réponse lente ne peut pas écraser une frappe plus récente.
    chain = chain.then(() => fn(value)).catch((e: unknown) => onError?.(e));
    return chain;
  };

  const save = ((value: T) => {
    pending = { value };
    clearTimeout(timer);
    timer = setTimeout(run, waitMs);
  }) as AutoSave<T>;

  save.flush = async () => {
    clearTimeout(timer);
    await run();
  };
  save.cancel = () => {
    clearTimeout(timer);
    pending = undefined;
  };
  return save;
}
