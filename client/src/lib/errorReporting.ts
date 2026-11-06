import { log } from './logger';

export function reportError(message: string, stack?: string, request_id?: string): void {
  log.error(message, request_id ? { request_id } : undefined, stack);
}

export function installGlobalHandlers(): void {
  window.addEventListener('error', (e) => reportError(e.message, e.error instanceof Error ? e.error.stack : undefined));
  window.addEventListener('unhandledrejection', (e) => {
    const r: unknown = e.reason;
    reportError(r instanceof Error ? r.message : String(r), r instanceof Error ? r.stack : undefined);
  });
}
