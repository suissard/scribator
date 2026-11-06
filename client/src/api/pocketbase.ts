import PocketBase from 'pocketbase';
import { log } from '@/lib/logger';

export const pb = new PocketBase(import.meta.env.VITE_POCKETBASE_URL ?? 'http://127.0.0.1:8090');
pb.autoCancellation(false);

/* Les écritures directes (auto-save, dépôt de fichier) ne passent pas par le serveur Node :
 * sans ce relevé, leurs échecs seraient invisibles. Le chemin seul : ni filtre, ni corps. */
pb.afterSend = (response, data) => {
  if (response.status >= 400) {
    const { pathname } = new URL(response.url);
    log.warn(`PocketBase ${pathname} : ${response.status}`, {
      status: response.status,
      message: (data as { message?: string } | null)?.message,
    });
  }
  return data;
};
