import { describe, expect, it } from 'vitest';
import type PocketBase from 'pocketbase';
import { ClientResponseError } from 'pocketbase';
import { loadEnv } from '../src/config/env.js';
import { MissingApiKeyError } from '../src/lib/errors.js';
import { UserKeyService } from '../src/services/userKey.service.js';

interface StoredRow {
  id: string;
  user: string;
  openrouter_key_enc: string;
  openrouter_key_hint: string;
  updated: string;
}

function createFakePb() {
  const rows = new Map<string, StoredRow>();
  let seq = 1;
  const pb = {
    filter: (_tpl: string, params: Record<string, string>) => params.u!,
    collection: (name: string) => {
      if (name !== 'user_secrets') throw new Error(`Unexpected collection ${name}`);
      return {
        getFirstListItem: async (userId: string) => {
          const found = [...rows.values()].find((r) => r.user === userId);
          if (!found) throw new ClientResponseError({ status: 404 });
          return { ...found };
        },
        create: async (data: Omit<StoredRow, 'id' | 'updated'>) => {
          const rec: StoredRow = { ...data, id: `sec_${seq++}`, updated: new Date().toISOString() };
          rows.set(rec.id, rec);
          return { ...rec };
        },
        update: async (id: string, patch: Partial<StoredRow>) => {
          const cur = rows.get(id);
          if (!cur) throw new ClientResponseError({ status: 404 });
          const next = { ...cur, ...patch, updated: new Date().toISOString() };
          rows.set(id, next);
          return { ...next };
        },
        delete: async (id: string) => {
          rows.delete(id);
        },
      };
    },
  };
  return { pb: pb as unknown as PocketBase, rows };
}

const fakeOpenRouterFetch: typeof fetch = async (_input, init) => {
  const headers = init?.headers as Record<string, string> | undefined;
  const auth = headers?.Authorization ?? headers?.authorization ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token || token.startsWith('sk-invalid')) {
    return new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response(
    JSON.stringify({ data: { label: 'Clé simulée', limit_remaining: 42.5, is_free_tier: false } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
};

describe('UserKeyService — clé OpenRouter par utilisateur', () => {
  const encKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  const makeEnv = (serverKey: string) =>
    loadEnv({
      NODE_ENV: 'test',
      POCKETBASE_URL: 'http://127.0.0.1:8090',
      PB_SUPERUSER_EMAIL: 'su@test.local',
      PB_SUPERUSER_PASSWORD: 'pw',
      API_KEY_ENCRYPTION_KEY: encKey,
      OPENROUTER_API_KEY: serverKey,
      OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
      AI_MODEL_CREATIVE: 'simu/redaction',
      AI_MODEL_FAST: 'simu/rapide',
    });

  it('valide la clé auprès d’OpenRouter, la chiffre en base (AES-256-GCM + AAD) et gère le repli serveur', async () => {
    const { pb, rows } = createFakePb();
    const env = makeEnv('sk-server-fallback');
    const service = new UserKeyService(pb, env, fakeOpenRouterFetch);

    // Rejette une clé invalide sans rien stocker
    await expect(service.saveKey('usr_1', 'sk-invalid-nope')).rejects.toThrow(/invalide/i);
    expect(rows.size).toBe(0);

    // Enregistre une clé valide -> stockée uniquement chiffrée
    const personalKey = 'sk-or-v1-personal-user-key-4321';
    const saved = await service.saveKey('usr_1', personalKey);
    expect(saved.configured).toBe(true);
    expect(saved.hint).toBe('sk-or-v1-…4321');
    expect(saved.server_fallback_available).toBe(true);

    const [stored] = [...rows.values()];
    expect(stored!.openrouter_key_enc).toMatch(/^v1:/);
    expect(JSON.stringify(stored)).not.toContain(personalKey);

    // Résolution pour usr_1 -> renvoie la clé personnelle déchiffrée avec source = 'user'
    expect(await service.resolveApiKey('usr_1')).toEqual({ apiKey: personalKey, source: 'user' });
    expect(await service.hasPersonalKey('usr_1')).toBe(true);

    // Un chiffré copié sur un autre utilisateur échoue au déchiffrement (AAD)
    rows.set('sec_stolen', { ...stored!, id: 'sec_stolen', user: 'usr_attacker' });
    await expect(service.resolveApiKey('usr_attacker')).rejects.toThrow(/déchiffrer/i);
    rows.delete('sec_stolen');

    // Test de la clé stockée
    const check = await service.testStoredKey('usr_1');
    expect(check).toMatchObject({ ok: true, label: 'Clé simulée', limit_remaining: 42.5 });

    // Remplacement de la clé (update sans doublon)
    const rotatedKey = 'sk-or-v1-rotated-user-key-9999';
    const updated = await service.saveKey('usr_1', rotatedKey);
    expect(rows.size).toBe(1);
    expect(updated.hint).toBe('sk-or-v1-…9999');
    expect(await service.resolveApiKey('usr_1')).toEqual({ apiKey: rotatedKey, source: 'user' });

    // Suppression -> repli sur clé serveur
    await service.deleteKey('usr_1');
    expect(rows.size).toBe(0);
    expect(await service.hasPersonalKey('usr_1')).toBe(false);
    expect(await service.resolveApiKey('usr_1')).toEqual({ apiKey: 'sk-server-fallback', source: 'server' });
  });

  it('lève MissingApiKeyError en mode BYOK strict sans clé serveur ni clé utilisateur', async () => {
    const { pb } = createFakePb();
    const service = new UserKeyService(pb, makeEnv(''), fakeOpenRouterFetch);
    expect(service.serverFallbackAvailable).toBe(false);
    await expect(service.resolveApiKey('usr_no_key')).rejects.toBeInstanceOf(MissingApiKeyError);
  });
});
