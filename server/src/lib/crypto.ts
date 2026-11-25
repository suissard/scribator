import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

/**
 * Parse la clé maître AES-256 depuis l'environnement :
 * 64 caractères hexadécimaux (32 octets) ou chaîne base64 décodant exactement 32 octets.
 */
export function parseEncryptionKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  if (/^[A-Za-z0-9+/]+=*$/.test(trimmed)) {
    const buf = Buffer.from(trimmed, 'base64');
    if (buf.length === KEY_BYTES && buf.toString('base64') === trimmed) {
      return buf;
    }
  }
  throw new Error(
    'API_KEY_ENCRYPTION_KEY doit faire exactement 32 octets (64 caractères hexadécimaux ou base64). ' +
      'Génère-la avec : node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
  );
}

/**
 * Chiffre un secret avec AES-256-GCM.
 * `aad` (Additional Authenticated Data) lie le chiffré à un contexte (ex. userId) :
 * un texte chiffré copié sur un autre utilisateur échoue au déchiffrement.
 */
export function encryptSecret(plaintext: string, masterKey: Buffer, aad: string): string {
  if (masterKey.length !== KEY_BYTES) {
    throw new Error('Clé de chiffrement invalide (32 octets requis).');
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv, { authTagLength: AUTH_TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

/** Déchiffre un secret produit par `encryptSecret` et vérifie son authenticité (GCM + AAD). */
export function decryptSecret(payload: string, masterKey: Buffer, aad: string): string {
  if (masterKey.length !== KEY_BYTES) {
    throw new Error('Clé de chiffrement invalide (32 octets requis).');
  }
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Format de secret chiffré non reconnu.');
  }
  const iv = Buffer.from(parts[1]!, 'base64');
  const tag = Buffer.from(parts[2]!, 'base64');
  const ciphertext = Buffer.from(parts[3]!, 'base64');
  if (iv.length !== IV_BYTES || tag.length !== AUTH_TAG_BYTES || ciphertext.length === 0) {
    throw new Error('Paramètres de chiffrement invalides.');
  }
  const decipher = createDecipheriv(ALGORITHM, masterKey, iv, { authTagLength: AUTH_TAG_BYTES });
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

/** Indice visuel non sensible pour l'interface (ne contient jamais la clé complète). */
export function maskApiKey(key: string): string {
  const t = key.trim();
  if (t.startsWith('sk-or-v1-') && t.length >= 16) return `sk-or-v1-…${t.slice(-4)}`;
  if (t.startsWith('sk-or-') && t.length >= 12) return `sk-or-…${t.slice(-4)}`;
  if (t.length >= 8) return `…${t.slice(-4)}`;
  return '••••';
}

/** Retire toute fuite éventuelle d'une clé API dans un message d'erreur avant journalisation. */
export function sanitizeErrorMessage(message: string, secret?: string): string {
  let out = message;
  if (secret && secret.length >= 6) {
    out = out.split(secret).join('[REDACTED]');
  }
  return out.replace(/sk-or-[A-Za-z0-9_-]{8,}/g, 'sk-or-[REDACTED]');
}
