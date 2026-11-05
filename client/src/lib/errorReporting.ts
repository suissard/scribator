import { apiUrl } from '@/api/server';

export function reportError(message: string, stack?: string, request_id?: string): void {
  void fetch(`${apiUrl}/client-errors`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: message.slice(0, 2000), stack: stack?.slice(0, 10_000), route: location.pathname, request_id }),
  }).catch(() => {});
}

export function installGlobalHandlers(): void {
  window.addEventListener('error', (e) => reportError(e.message, e.error instanceof Error ? e.error.stack : undefined));
  window.addEventListener('unhandledrejection', (e) => {
    const r: unknown = e.reason;
    reportError(r instanceof Error ? r.message : String(r), r instanceof Error ? r.stack : undefined);
  });
}
