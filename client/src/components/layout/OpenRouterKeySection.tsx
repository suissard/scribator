import { CheckCircle2, Eye, EyeOff, KeyRound, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { api, type UserKeyStatus, type UserKeyValidation } from '@/api/server';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { Input } from '@/components/ui/field';
import { toastSuccess } from '@/lib/toast';
import { useAction } from '@/lib/useAction';

export const KEY_UPDATED_EVENT = 'scribator-key-updated';

export function OpenRouterKeySection({ open }: { open: boolean }) {
  const [status, setStatus] = useState<UserKeyStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [draftKey, setDraftKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [editing, setEditing] = useState(false);
  const [testResult, setTestResult] = useState<UserKeyValidation | null>(null);
  const { busy, doing, error, clearError, run } = useAction();

  useEffect(() => {
    if (!open) {
      setDraftKey('');
      setShowKey(false);
      setEditing(false);
      setTestResult(null);
      clearError();
      return;
    }
    let alive = true;
    setLoadingStatus(true);
    api
      .getOpenRouterKey()
      .then((s) => {
        if (!alive) return;
        setStatus(s);
        setEditing(!s.configured);
      })
      .catch(() => {
        if (alive) setStatus(null);
      })
      .finally(() => {
        if (alive) setLoadingStatus(false);
      });
    return () => {
      alive = false;
    };
  }, [open, clearError]);

  const notifyUpdated = () => {
    window.dispatchEvent(new CustomEvent(KEY_UPDATED_EVENT));
  };

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = draftKey.trim();
    if (!trimmed) return;
    setTestResult(null);
    void run(async () => {
      const next = await api.setOpenRouterKey(trimmed);
      setDraftKey('');
      setShowKey(false);
      setStatus(next);
      setEditing(false);
      notifyUpdated();
      toastSuccess('Clé OpenRouter vérifiée et enregistrée (chiffrée).');
    }, 'save');
  };

  const handleTest = () => {
    setTestResult(null);
    void run(async () => {
      const res = await api.testOpenRouterKey();
      setTestResult(res);
      toastSuccess('Clé OpenRouter valide.');
    }, 'test');
  };

  const handleDelete = () => {
    setTestResult(null);
    void run(async () => {
      const next = await api.deleteOpenRouterKey();
      setDraftKey('');
      setStatus(next);
      setEditing(true);
      notifyUpdated();
      toastSuccess('Clé OpenRouter personnelle supprimée.');
    }, 'delete');
  };

  return (
    <div className="space-y-3 border-t border-line pt-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <KeyRound size={17} className="text-accent" />
          Clé API OpenRouter personnelle
        </h3>
        {status?.configured && (
          <span className="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2.5 py-0.5 text-xs font-medium text-ok">
            <CheckCircle2 size={12} /> Active
          </span>
        )}
      </div>

      <p className="text-sm text-muted">
        Utilisez votre propre compte{' '}
        <a
          href="https://openrouter.ai/keys"
          target="_blank"
          rel="noopener noreferrer"
          className="text-ink underline underline-offset-4 hover:text-accent"
        >
          OpenRouter
        </a>{' '}
        pour payer directement vos générations sans plafond mensuel côté serveur.
      </p>

      {loadingStatus ? (
        <p className="text-xs text-muted">Chargement…</p>
      ) : (
        <>
          {status?.configured && !editing && (
            <div className="space-y-3 rounded-lg border border-line bg-surface/60 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="text-xs text-muted">Clé enregistrée (non relisible)</div>
                  <code className="font-mono text-sm font-medium text-ink">{status.hint}</code>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    loading={doing === 'test'}
                    onClick={handleTest}
                  >
                    Tester
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      clearError();
                      setTestResult(null);
                      setEditing(true);
                    }}
                  >
                    Remplacer
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    disabled={busy}
                    loading={doing === 'delete'}
                    onClick={handleDelete}
                  >
                    <Trash2 size={14} /> Supprimer
                  </Button>
                </div>
              </div>

              {testResult && (
                <p className="text-xs text-ok">
                  Clé valide auprès d'OpenRouter
                  {testResult.label ? ` (« ${testResult.label} »)` : ''}
                  {testResult.limit_remaining !== null ? ` · crédit restant sur la clé : ${testResult.limit_remaining.toFixed(2)} $` : ''}.
                </p>
              )}
            </div>
          )}

          {(!status?.configured || editing) && (
            <form onSubmit={handleSave} className="space-y-3 rounded-lg border border-line bg-surface/40 p-3.5">
              {status && !status.configured && !status.server_fallback_available && (
                <p className="text-xs font-medium text-stale">
                  Aucune clé serveur partagée n'est configurée : renseignez votre clé OpenRouter pour pouvoir générer du texte.
                </p>
              )}
              {status && !status.configured && status.server_fallback_available && (
                <p className="text-xs text-muted">
                  Aucune clé personnelle enregistrée : la clé partagée du serveur est utilisée par défaut (soumise au budget mensuel).
                </p>
              )}

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showKey ? 'text' : 'password'}
                    value={draftKey}
                    onChange={(e) => setDraftKey(e.target.value)}
                    placeholder="sk-or-v1-..."
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Clé API OpenRouter"
                    disabled={busy}
                    className="pr-10 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    aria-label={showKey ? 'Masquer la clé' : 'Afficher la clé'}
                    className="absolute top-1/2 right-2.5 -translate-y-1/2 cursor-pointer text-muted hover:text-ink"
                  >
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <Button type="submit" variant="primary" disabled={busy || !draftKey.trim()} loading={doing === 'save'}>
                  Vérifier et enregistrer
                </Button>
                {status?.configured && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setDraftKey('');
                      clearError();
                      setEditing(false);
                    }}
                  >
                    Annuler
                  </Button>
                )}
              </div>
            </form>
          )}

          <p className="flex items-start gap-1.5 text-xs text-muted">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-ok" />
            <span>
              Votre clé est vérifiée auprès d'OpenRouter (sans coût) puis chiffrée en AES-256-GCM avant d'être stockée. Elle n'est jamais enregistrée en clair ni renvoyée au navigateur.
            </span>
          </p>
        </>
      )}

      <ErrorNote error={error} />
    </div>
  );
}
