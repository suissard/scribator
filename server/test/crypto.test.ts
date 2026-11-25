import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, maskApiKey, parseEncryptionKey, sanitizeErrorMessage } from '../src/lib/crypto.js';

describe('crypto — chiffrement AES-256-GCM des clés API', () => {
  const hexKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const masterKey = parseEncryptionKey(hexKey);

  it('accepte une clé hexadécimale 64 caractères ou base64 32 octets et rejette les autres', () => {
    expect(parseEncryptionKey(hexKey)).toHaveLength(32);
    const b64 = randomBytes(32).toString('base64');
    expect(parseEncryptionKey(b64)).toHaveLength(32);

    expect(() => parseEncryptionKey('')).toThrow();
    expect(() => parseEncryptionKey('short-key')).toThrow();
    expect(() => parseEncryptionKey('0'.repeat(63))).toThrow();
    expect(() => parseEncryptionKey(randomBytes(16).toString('base64'))).toThrow();
  });

  it('chiffre avec un IV aléatoire et ne stocke jamais la clé en clair', () => {
    const secret = 'sk-or-v1-super-secret-user-key-9876543210';
    const aad = 'user:usr_123:openrouter_api_key';

    const enc1 = encryptSecret(secret, masterKey, aad);
    const enc2 = encryptSecret(secret, masterKey, aad);

    expect(enc1).not.toBe(enc2);
    expect(enc1.startsWith('v1:')).toBe(true);
    expect(enc1).not.toContain(secret);
    expect(enc1).not.toContain('9876543210');

    expect(decryptSecret(enc1, masterKey, aad)).toBe(secret);
    expect(decryptSecret(enc2, masterKey, aad)).toBe(secret);
  });

  it('refuse le déchiffrement avec une mauvaise clé maître, un autre utilisateur (AAD) ou un payload altéré', () => {
    const secret = 'sk-or-v1-secret-token-abcdef';
    const enc = encryptSecret(secret, masterKey, 'user:alice:openrouter_api_key');

    const otherMaster = randomBytes(32);
    expect(() => decryptSecret(enc, otherMaster, 'user:alice:openrouter_api_key')).toThrow();
    expect(() => decryptSecret(enc, masterKey, 'user:bob:openrouter_api_key')).toThrow();

    const parts = enc.split(':');
    const tamperedCipher = Buffer.from(parts[3]!, 'base64');
    tamperedCipher[0] = tamperedCipher[0]! ^ 0xff;
    parts[3] = tamperedCipher.toString('base64');
    expect(() => decryptSecret(parts.join(':'), masterKey, 'user:alice:openrouter_api_key')).toThrow();
  });

  it('masque correctement les clés API pour affichage', () => {
    expect(maskApiKey('sk-or-v1-1234567890abcdef')).toBe('sk-or-v1-…cdef');
    expect(maskApiKey('sk-or-1234567890wxyz')).toBe('sk-or-…wxyz');
    expect(maskApiKey('custom-api-token-9999')).toBe('…9999');
    expect(maskApiKey('short')).toBe('••••');
  });

  it('expurge toute fuite de clé dans les messages d’erreur', () => {
    const key = 'sk-or-v1-secret123456789';
    expect(sanitizeErrorMessage(`401 failed with ${key}`, key)).toBe('401 failed with [REDACTED]');
    expect(sanitizeErrorMessage('Bad header sk-or-v1-anotherSecretKey123')).toBe('Bad header sk-or-[REDACTED]');
  });
});
