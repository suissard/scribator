/**
 * Écrit périodiquement le tampon de streaming en base (§5.3, §5.6).
 * N'écrit que si le texte a changé : aucune écriture SQLite pendant la phase de réflexion.
 * Les écritures sont sérialisées et `stop()` attend la dernière, sinon un tick en vol
 * pourrait écraser le `draft = ""` final.
 */
export class DraftWriter {
  private buffer = '';
  private lastWritten = '';
  private timer: NodeJS.Timeout | undefined;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly write: (text: string) => Promise<unknown>,
    tickMs: number,
    private readonly onError: (e: unknown) => void = () => {},
  ) {
    this.timer = setInterval(() => this.flushTick(), tickMs);
  }

  get text(): string {
    return this.buffer;
  }

  set(text: string): void {
    this.buffer = text;
  }

  private flushTick(): void {
    if (this.buffer === this.lastWritten) return;
    const snapshot = this.buffer;
    this.lastWritten = snapshot;
    this.chain = this.chain.then(() => this.write(snapshot).then(() => undefined, this.onError));
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    await this.chain;
  }
}
