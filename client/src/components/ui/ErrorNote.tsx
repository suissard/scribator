import { AlertCircle } from 'lucide-react';
import type { ActionError } from '@/lib/useAction';

export function ErrorNote({ error }: { error: ActionError | string | null }) {
  if (!error) return null;
  const { message, requestId } = typeof error === 'string' ? { message: error, requestId: undefined } : error;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <div>
        <p>{message}</p>
        {requestId && <p className="mt-0.5 text-xs opacity-80">Code : {requestId}</p>}
      </div>
    </div>
  );
}
