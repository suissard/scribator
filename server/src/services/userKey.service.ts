import type PocketBase from 'pocketbase';
import type { Env } from '../config/env.js';
import { decryptSecret, encryptSecret, maskApiKey, parseEncryptionKey } from '../lib/crypto.js';
import { AppError, badRequest, MissingApiKeyError } from '../lib/errors.js';
import { isPbRejection } from '../lib/pb.js';

export interface UserKeyStatus {
  configured: boolean;
  hint: string | null;
  updated_at: string | null;
  server_fallback_available: boolean;
}

export interface UserKeyValidation {
  ok: true;
  label: string | null;
  limit_remaining: number | null;
  is_free_tier: boolean | null;
}

export interface ResolvedApiKey {
  apiKey: string;
  source: 'user' | 'server';
}

interface UserSecretRecord {
  id: string;
  user: string;
  openrouter_key_enc: string;
  openrouter_key_hint: string;
  updated: string;
}

const KEY_MIN_LENGTH = 8;
const KEY_MAX_LENGTH = 512;
const VERIFY_TIMEOUT_MS = 10_000;

const aadFor = (userId: string) => `user:${userId}:openrouter_api_key`;

function assertValidKeyFormat(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length < KEY_MIN_LENGTH || trimmed.length > KEY_MAX_LENGTH) {
    throw badRequest('Format de clé OpenRouter invalide.');
  }
  if (/[\s\x00-\x1f\x7f]/.test(trimmed)) {
    throw badRequest('La clé OpenRouter ne doit pas contenir d’espaces ni de caractères de contrôle.');
  }
  return trimmed;
}

export class UserKeyService {
  private readonly masterKey: Buffer;
  readonly serverFallbackAvailable: boolean;

  constructor(
    private readonly pb: PocketBase,
    private readonly env: Env,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.masterKey = parseEncryptionKey(env.API_KEY_ENCRYPTION_KEY);
    this.serverFallbackAvailable = env.OPENROUTER_API_KEY.trim().length > 0;
  }

  private async findRecord(userId: string, fields?: string): Promise<UserSecretRecord | null> {
    try {
      return await this.pb.collection('user_secrets').getFirstListItem<UserSecretRecord>(
        this.pb.filter('user = {:u}', { u: userId }),
        fields ? { fields } : undefined,
      );
    } catch (e) {
      if (isPbRejection(e, [404])) return null;
      throw e;
    }
  }

  async hasPersonalKey(userId: string): Promise<boolean> {
    const rec = await this.findRecord(userId, 'id,openrouter_key_enc');
    return Boolean(rec?.openrouter_key_enc);
  }

  async getStatus(userId: string): Promise<UserKeyStatus> {
    const rec = await this.findRecord(userId, 'id,openrouter_key_hint,updated');
    const configured = Boolean(rec?.openrouter_key_hint);
    return {
      configured,
      hint: configured ? rec!.openrouter_key_hint : null,
      updated_at: configured ? rec!.updated : null,
      server_fallback_available: this.serverFallbackAvailable,
    };
  }

  /**
   * Déchiffre la clé personnelle à la volée (jamais conservée en clair en base ni en cache global).
   * Repli sur `OPENROUTER_API_KEY` si configurée sur le serveur.
   */
  async resolveApiKey(userId: string): Promise<ResolvedApiKey> {
    const rec = await this.findRecord(userId, 'id,openrouter_key_enc');
    if (rec?.openrouter_key_enc) {
      try {
        const apiKey = decryptSecret(rec.openrouter_key_enc, this.masterKey, aadFor(userId));
        return { apiKey, source: 'user' };
      } catch {
        throw new AppError(
          500,
          'key_decrypt_failed',
          'Impossible de déchiffrer ta clé OpenRouter. Enregistre-la à nouveau dans les paramètres.',
        );
      }
    }
    if (this.serverFallbackAvailable) {
      return { apiKey: this.env.OPENROUTER_API_KEY.trim(), source: 'server' };
    }
    throw new MissingApiKeyError();
  }

  /** Vérifie la clé auprès d'OpenRouter (`GET /key`, sans aucun coût). */
  async validateWithOpenRouter(apiKey: string): Promise<UserKeyValidation> {
    const base = this.env.OPENROUTER_BASE_URL.replace(/\/+$/, '');
    let res: Response;
    try {
      res = await this.fetchFn(`${base}/key`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'X-OpenRouter-Title': 'Scribator',
        },
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      });
    } catch {
      throw new AppError(
        502,
        'openrouter_unreachable',
        "OpenRouter est injoignable pour vérifier ta clé. Réessaie dans un instant.",
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw badRequest('Clé OpenRouter invalide ou révoquée. Vérifie ta clé sur openrouter.ai/keys.');
    }
    if (!res.ok) {
      throw new AppError(
        502,
        'openrouter_check_failed',
        "Impossible de vérifier la clé auprès d'OpenRouter. Réessaie dans un instant.",
      );
    }
    const payload = (await res.json().catch(() => null)) as {
      data?: { label?: unknown; limit_remaining?: unknown; is_free_tier?: unknown };
    } | null;
    const data = payload?.data;
    return {
      ok: true,
      label: typeof data?.label === 'string' && data.label.trim() ? data.label.trim() : null,
      limit_remaining: typeof data?.limit_remaining === 'number' && Number.isFinite(data.limit_remaining) ? data.limit_remaining : null,
      is_free_tier: typeof data?.is_free_tier === 'boolean' ? data.is_free_tier : null,
    };
  }

  async saveKey(userId: string, rawKey: string): Promise<UserKeyStatus> {
    const trimmed = assertValidKeyFormat(rawKey);
    await this.validateWithOpenRouter(trimmed);
    const enc = encryptSecret(trimmed, this.masterKey, aadFor(userId));
    const hint = maskApiKey(trimmed);

    const existing = await this.findRecord(userId, 'id');
    const saved = existing
      ? await this.pb.collection('user_secrets').update<UserSecretRecord>(existing.id, {
          openrouter_key_enc: enc,
          openrouter_key_hint: hint,
        })
      : await this.pb.collection('user_secrets').create<UserSecretRecord>({
          user: userId,
          openrouter_key_enc: enc,
          openrouter_key_hint: hint,
        });

    return {
      configured: true,
      hint: saved.openrouter_key_hint,
      updated_at: saved.updated,
      server_fallback_available: this.serverFallbackAvailable,
    };
  }

  async testStoredKey(userId: string): Promise<UserKeyValidation> {
    const rec = await this.findRecord(userId, 'id,openrouter_key_enc');
    if (!rec?.openrouter_key_enc) {
      throw badRequest('Aucune clé OpenRouter personnelle enregistrée.');
    }
    let apiKey: string;
    try {
      apiKey = decryptSecret(rec.openrouter_key_enc, this.masterKey, aadFor(userId));
    } catch {
      throw new AppError(
        500,
        'key_decrypt_failed',
        'Impossible de déchiffrer ta clé OpenRouter. Enregistre-la à nouveau dans les paramètres.',
      );
    }
    return this.validateWithOpenRouter(apiKey);
  }

  async deleteKey(userId: string): Promise<UserKeyStatus> {
    const existing = await this.findRecord(userId, 'id');
    if (existing) {
      await this.pb.collection('user_secrets').delete(existing.id);
    }
    return {
      configured: false,
      hint: null,
      updated_at: null,
      server_fallback_available: this.serverFallbackAvailable,
    };
  }
}
