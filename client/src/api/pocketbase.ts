import PocketBase from 'pocketbase';
import { log } from '@/lib/logger';
import { getMockMode } from '@/lib/mockState';
import { mockPb } from './mockPocketbase';

const realPb = new PocketBase(import.meta.env.VITE_POCKETBASE_URL ?? 'http://127.0.0.1:8090');
realPb.autoCancellation(false);

/* Les écritures directes (auto-save, dépôt de fichier) ne passent pas par le serveur Node :
 * sans ce relevé, leurs échecs seraient invisibles. Le chemin seul : ni filtre, ni corps. */
realPb.afterSend = (response, data) => {
  if (response.status >= 400) {
    const { pathname } = new URL(response.url);
    log.warn(`PocketBase ${pathname} : ${response.status}`, {
      status: response.status,
      message: (data as { message?: string } | null)?.message,
    });
  }
  return data;
};

// Proxy PB qui bascule dynamiquement selon mockState
export const pb = new Proxy(realPb, {
  get(target, prop, receiver) {
    if (getMockMode()) {
      const mockVal = Reflect.get(mockPb, prop);
      if (mockVal !== undefined) return mockVal;
    }
    return Reflect.get(target, prop, receiver);
  },
}) as unknown as PocketBase;
