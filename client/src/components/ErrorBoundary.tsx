import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '@/lib/errorReporting';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error.message, `${error.stack ?? ''}\n${info.componentStack ?? ''}`);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="mx-auto mt-24 max-w-md text-center">
        <h1 className="text-xl font-semibold">Quelque chose s'est mal passé</h1>
        <p className="mt-2 text-sm text-muted">Ton texte est sauvegardé. Recharge la page pour reprendre.</p>
        <button className="mt-4 cursor-pointer text-sm font-medium text-accent underline" onClick={() => location.reload()}>
          Recharger
        </button>
      </div>
    );
  }
}
