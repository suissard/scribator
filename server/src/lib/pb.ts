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

/**
 * Refus de PocketBase lié à la requête (jeton, droits, identifiant) : ce n'est pas une panne.
 * Un statut 0 (réseau, délai) ou 5xx en est une, et ne doit pas se déguiser en 401 ou 404.
 */
export const isPbRejection = (e: unknown, statuses: number[]) =>
  e instanceof ClientResponseError && statuses.includes(e.status);

export const isPbOutage = (e: unknown) => e instanceof ClientResponseError && (e.status === 0 || e.status >= 500);
