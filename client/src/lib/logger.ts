import { apiUrl } from './config';

/**
 * Journal du navigateur (§8) : console, panneau « Journal » à copier, et remontée vers les logs serveur
 * pour les avertissements et les erreurs. Jamais de corps de requête, de jeton ni de texte d'auteur ici.
 */
export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  time: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

const MAX_ENTRIES = 300;

let entries: LogEntry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function forward(entry: LogEntry, stack?: string): void {
  void fetch(`${apiUrl}/client-errors`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      level: entry.level,
      message: entry.message.slice(0, 2000),
      stack: stack?.slice(0, 10_000),
      route: location.pathname,
      context: entry.context,
      request_id: entry.context?.request_id,
    }),
  }).catch(() => {});
}

function write(level: LogLevel, message: string, context?: Record<string, unknown>, stack?: string): void {
  const entry: LogEntry = { id: nextId++, time: new Date().toISOString(), level, message, ...(context ? { context } : {}) };
  entries = [...entries.slice(-(MAX_ENTRIES - 1)), entry];
  listeners.forEach((l) => l());
  console[level](`[scribator] ${message}`, context ?? '');
  if (level !== 'info') forward(entry, stack);
}

export const log = {
  info: (message: string, context?: Record<string, unknown>) => write('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => write('warn', message, context),
  error: (message: string, context?: Record<string, unknown>, stack?: string) => write('error', message, context, stack),
};

export const logStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  snapshot: () => entries,
};

export const formatLogs = (list: LogEntry[]) =>
  list
    .map((e) => `${e.time} ${e.level.toUpperCase()} ${e.message}${e.context ? ` ${JSON.stringify(e.context)}` : ''}`)
    .join('\n');
