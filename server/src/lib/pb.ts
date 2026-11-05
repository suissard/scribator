import PocketBase, { ClientResponseError } from 'pocketbase';
import type { Env } from '../config/env.js';

/** Client superuser : seul autorisé à écrire les champs protégés, après vérification de propriété. */
export async function createSuperuserClient(env: Env): Promise<PocketBase> {
  const pb = new PocketBase(env.POCKETBASE_URL);
  pb.autoCancellation(false);
  try {
    await pb.collection('_superusers').authWithPassword(env.PB_SUPERUSER_EMAIL, env.PB_SUPERUSER_PASSWORD, {
      autoRefreshThreshold: 30 * 60,
    });
  } catch (e) {
    const reason =
      e instanceof ClientResponseError && e.status === 400
        ? `identifiants refusés pour ${env.PB_SUPERUSER_EMAIL} : crée ce compte avec « pocketbase superuser upsert » ou corrige PB_SUPERUSER_EMAIL et PB_SUPERUSER_PASSWORD`
        : `PocketBase injoignable sur ${env.POCKETBASE_URL}`;
    throw new Error(`Connexion superuser impossible, ${reason}.`, { cause: e });
  }
  return pb;
}

export function createUserClient(env: Env, token: string): PocketBase {
  const pb = new PocketBase(env.POCKETBASE_URL);
  pb.autoCancellation(false);
  pb.authStore.save(token, null);
  return pb;
}
