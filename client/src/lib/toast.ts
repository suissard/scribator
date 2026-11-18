import { create } from 'zustand';

export interface Toast {
  id: number;
  message: string;
  requestId?: string;
}

interface ToastState {
  toasts: Toast[];
  dismiss(id: number): void;
}

const LIFETIME_MS = 8000;
const MAX_VISIBLE = 4;
let nextId = 1;

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/**
 * Signale une erreur sans place dédiée à l'écran (pas de barre de génération pour la porter).
 * Un même message déjà affiché n'est pas empilé une seconde fois.
 */
export function toastError(message: string, requestId?: string): void {
  const { toasts } = useToasts.getState();
  if (toasts.some((t) => t.message === message)) return;
  const id = nextId++;
  const toast: Toast = { id, message, ...(requestId ? { requestId } : {}) };
  useToasts.setState({ toasts: [...toasts, toast].slice(-MAX_VISIBLE) });
  setTimeout(() => useToasts.getState().dismiss(id), LIFETIME_MS);
}
