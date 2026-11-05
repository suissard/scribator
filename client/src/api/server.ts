import type { ModelOption } from '@/lib/types';
import { pb } from './pocketbase';

export const apiUrl: string = import.meta.env.VITE_API_SERVER_URL ?? 'http://127.0.0.1:3001/api';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

async function request(method: string, path: string, body?: unknown): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${pb.authStore.token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError('Le serveur est injoignable. Vérifie ta connexion.', 0);
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { message?: string; request_id?: string } | null;
    throw new ApiError(data?.message ?? 'Une erreur est survenue.', res.status, data?.request_id ?? res.headers.get('x-request-id') ?? undefined);
  }
  return res;
}

const json = async <T>(method: string, path: string, body?: unknown) => (await (await request(method, path, body)).json()) as T;

export interface Usage { spent_usd: number; budget_usd: number }

export const api = {
  models: () => json<{ default_model: string; models: ModelOption[] }>('GET', '/models'),
  setModel: (id: string, model: string) => json('PATCH', `/projects/${id}/model`, { model }),
  analyze: (id: string, feedback?: string) => json<{ jobId: string }>('POST', `/projects/${id}/analyze`, { feedback }),
  outline: (id: string, userFeedback?: string) => json('POST', `/projects/${id}/outline`, { userFeedback }),
  sample: (id: string) => json<{ jobId: string }>('POST', `/projects/${id}/sample`, {}),
  approveSample: (id: string) => json('POST', `/projects/${id}/sample/approve`, {}),
  patchStyle: (id: string, style: unknown) => json('PATCH', `/projects/${id}/style`, style),
  patchBible: (id: string, bible: unknown) => json('PATCH', `/projects/${id}/bible`, bible),
  addChapter: (id: string, title: string) => json('POST', `/projects/${id}/chapters`, { title }),
  deleteChapter: (id: string) => json('DELETE', `/chapters/${id}`),
  reorder: (projectId: string, orderedIds: string[]) => json('POST', '/chapters/reorder', { projectId, orderedIds }),
  planScenes: (id: string) => json('POST', `/chapters/${id}/plan-scenes`, {}),
  writeChapter: (id: string) => json<{ jobId: string }>('POST', `/chapters/${id}/write`, {}),
  approveChapter: (id: string) => json('POST', `/chapters/${id}/approve`, {}),
  reopenChapter: (id: string) => json('POST', `/chapters/${id}/reopen`, {}),
  refreshMemory: (id: string) => json('POST', `/chapters/${id}/refresh-memory`, {}),
  ignoreStale: (id: string) => json('POST', `/chapters/${id}/ignore-stale`, {}),
  regenerateScene: (id: string, instructions?: string) => json<{ jobId: string }>('POST', `/scenes/${id}/regenerate`, { instructions }),
  cancelJob: (id: string, keepPartial: boolean) => json('POST', `/jobs/${id}/cancel`, { keepPartial }),
  acceptChange: (id: string) => json('POST', `/pending-changes/${id}/accept`, {}),
  rejectChange: (id: string) => json('POST', `/pending-changes/${id}/reject`, {}),
  restoreVersion: (id: string) => json('POST', `/versions/${id}/restore`, {}),
  usage: () => json<Usage>('GET', '/me/usage'),
  acceptTerms: () => json('POST', '/me/accept-terms', {}),
  async exportBook(id: string, format: 'md' | 'docx' | 'epub', aiNotice: boolean): Promise<void> {
    const res = await request('GET', `/projects/${id}/export?format=${format}&aiNotice=${aiNotice}`);
    const name = res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? `livre.${format}`;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  },
};
