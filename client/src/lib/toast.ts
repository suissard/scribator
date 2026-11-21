import { create } from 'zustand';

export type ToastTone = 'error' | 'success' | 'info';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  requestId?: string;
}

interface ToastState {
  toasts: Toast[];
  dismiss(id: number): void;
}

const ERROR_LIFETIME_MS = 8000;
const SUCCESS_LIFETIME_MS = 4000;
const MAX_VISIBLE = 4;
let nextId = 1;

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

function pushToast(message: string, tone: ToastTone, lifetimeMs: number, requestId?: string): void {
  const { toasts } = useToasts.getState();
  if (toasts.some((t) => t.message === message && t.tone === tone)) return;
  const id = nextId++;
  const toast: Toast = { id, message, tone, ...(requestId ? { requestId } : {}) };
  useToasts.setState({ toasts: [...toasts, toast].slice(-MAX_VISIBLE) });
  setTimeout(() => useToasts.getState().dismiss(id), lifetimeMs);
}

/**
 * Signale une erreur sans place dédiée à l'écran (pas de barre de génération pour la porter).
 * Un même message déjà affiché n'est pas empilé une seconde fois.
 */
export function toastError(message: string, requestId?: string): void {
  pushToast(message, 'error', ERROR_LIFETIME_MS, requestId);
}

/** Confirme brièvement qu'une action (sauvegarde, validation, export) a bien abouti. */
export function toastSuccess(message: string): void {
  pushToast(message, 'success', SUCCESS_LIFETIME_MS);
}
