import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser, startHarness, type Harness } from './harness.js';

describe('clés OpenRouter personnelles (BYOK chiffré)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  }, 30_000);

  afterAll(async () => {
    await h?.stop();
  });

  it('refuse une clé invalide avant enregistrement et ne stocke jamais en clair', async () => {
    const user = await createUser(h, { role: 'admin', monthly_budget_usd: 0 });

    // 1. Clé rejetée par OpenRouter (/key -> 401)
    const bad = await user.api('PUT', '/me/openrouter-key', { apiKey: 'sk-invalid-key-123456' });
    expect(bad.status).toBe(400);

    // Aucune entrée en base
    const empty = await h.su.collection('user_secrets').getFullList({
      filter: h.su.filter('user = {:u}', { u: user.id }),
    });
    expect(empty).toHaveLength(0);

    // 2. Clé valide enregistrée
    const personalKey = 'sk-or-v1-my-super-secret-personal-key-9876';
    const saved = await user.api('PUT', '/me/openrouter-key', { apiKey: personalKey });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      configured: true,
      hint: 'sk-or-v1-…9876',
      server_fallback_available: true,
    });
    expect(JSON.stringify(saved.body)).not.toContain(personalKey);

    // 3. En base PocketBase : chiffré AES-256-GCM, jamais en clair
    const rows = await h.su.collection('user_secrets').getFullList({
      filter: h.su.filter('user = {:u}', { u: user.id }),
    });
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!.openrouter_key_enc)).toMatch(/^v1:/);
    expect(JSON.stringify(rows[0])).not.toContain(personalKey);

    // 4. Règles PocketBase : aucun accès direct depuis le client utilisateur
    await expect(user.pb.collection('user_secrets').getFullList()).rejects.toThrow();

    // 5. GET statut : jamais de clé en clair
    const status = await user.api('GET', '/me/openrouter-key');
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ configured: true, hint: 'sk-or-v1-…9876' });
    expect(JSON.stringify(status.body)).not.toContain(personalKey);

    // 6. Test de la clé stockée
    const tested = await user.api('POST', '/me/openrouter-key/test', {});
    expect(tested.status).toBe(200);
    expect(tested.body).toMatchObject({ ok: true, label: 'Clé simulée', limit_remaining: 42.5 });

    // 7. Appel IA : utilise la clé personnelle et lève le plafond monthly_budget_usd (0 $)
    const beforeAuth = h.mock.authHeaders.length;
    const aiRes = await user.api('POST', '/admin/ai-test', {});
    expect(aiRes.status).toBe(200);
    expect(h.mock.authHeaders.slice(beforeAuth)).toContain(`Bearer ${personalKey}`);

    const usage = await user.api('GET', '/me/usage');
    expect(usage.status).toBe(200);
    expect(usage.body).toMatchObject({ using_own_key: true, server_fallback_available: true });

    // 8. Suppression : repli sur clé serveur, donc budget à 0 $ à nouveau bloquant
    const del = await user.api('DELETE', '/me/openrouter-key');
    expect(del.status).toBe(200);
    expect(del.body).toMatchObject({ configured: false, hint: null });

    const blocked = await user.api('POST', '/admin/ai-test', {});
    expect(blocked.status).toBe(402);
  });

  it('fonctionne en mode BYOK strict sans OPENROUTER_API_KEY côté serveur', async () => {
    const byok = await startHarness({ OPENROUTER_API_KEY: '' });
    try {
      const user = await createUser(byok, { role: 'admin', monthly_budget_usd: 10 });

      const status = await user.api('GET', '/me/openrouter-key');
      expect(status.status).toBe(200);
      expect(status.body).toMatchObject({ configured: false, server_fallback_available: false });

      // Sans clé personnelle ni clé serveur -> erreur explicite missing_api_key
      const missing = await user.api('POST', '/admin/ai-test', {});
      expect(missing.status).toBe(400);
      expect(missing.body).toMatchObject({ error: 'missing_api_key' });

      // Une fois la clé personnelle enregistrée, tout fonctionne
      const key = 'sk-or-v1-byok-only-user-key-5555';
      const save = await user.api('PUT', '/me/openrouter-key', { apiKey: key });
      expect(save.status).toBe(200);

      const ok = await user.api('POST', '/admin/ai-test', {});
      expect(ok.status).toBe(200);
      expect(byok.mock.authHeaders).toContain(`Bearer ${key}`);
    } finally {
      await byok.stop();
    }
  }, 30_000);
});
