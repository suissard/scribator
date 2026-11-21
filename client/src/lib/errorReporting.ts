import { log } from './logger';
import { toastError } from './toast';

const UNEXPECTED = 'Une erreur inattendue est survenue. Si le problème persiste, rechargez la page.';
/** Bruit des navigateurs, sans conséquence pour l'auteur. */
const IGNORED = /ResizeObserver loop/;

export function reportError(message: string, stack?: string, request_id?: string): void {
  log.error(message, request_id ? { request_id } : undefined, stack);
}

export function installGlobalHandlers(): void {
  window.addEventListener('error', (e) => {
    reportError(e.message, e.error instanceof Error ? e.error.stack : undefined);
    if (!IGNORED.test(e.message)) toastError(UNEXPECTED);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r: unknown = e.reason;
    const message = r instanceof Error ? r.message : String(r);
    reportError(message, r instanceof Error ? r.stack : undefined);
    if (!IGNORED.test(message)) toastError(UNEXPECTED);
  });
}
