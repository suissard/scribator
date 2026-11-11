import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SHUTDOWN_MESSAGE } from '../../src/services/jobs.service.js';
import { createUser, job, scenesOf, startHarness, until, writingProject, type Harness, type TestUser } from './harness.js';

let h: Harness;
let u: TestUser;

beforeAll(async () => {
  h = await startHarness();
  u = await createUser(h);
});
afterAll(() => h.stop());

/** Lance l'écriture lente d'un chapitre et attend que le brouillon commence à arriver. */
async function slowWrite() {
  const { project, chapters } = await writingProject(h, u, 1, 2200, { reformulated_concept: '[[SLOW]]' });
  const chapterId = chapters[0]!.id;
  const r = await u.api('POST', `/chapters/${chapterId}/write`);
  expect(r.status).toBe(202);
  await until(async () => (await scenesOf(h, chapterId)).some((s) => s.status === 'GENERATING' && s.draft));
  return { project, chapterId, jobId: r.body.jobId as string };
}

describe('watchdog', () => {
  it('ne nettoie que le projet du job orphelin, pas celui d’un job vivant', async () => {
    const live = await slowWrite();

    // Un job orphelin, sur un autre projet : RUNNING en base, inconnu en mémoire, trop vieux.
    const { project: other, chapters } = await writingProject(h, u, 1, 2200);
    await h.su.collection('chapters').update(chapters[0]!.id, { status: 'GENERATING' });
    const stuckScene = await h.su.collection('scenes').create({
      chapter: chapters[0]!.id, scene_number: 1, beat: 'b', target_words: 500, content: '', draft: 'brouillon mort', status: 'GENERATING',
    });
    const stuck = await h.su.collection('generation_jobs').create({
      user: u.id, project: other.id, kind: 'CHAPTER', target_id: chapters[0]!.id, status: 'RUNNING', started_at: '2020-01-01 00:00:00.000Z',
    });

    await (h.deps.jobs as unknown as { sweep(): Promise<void> }).sweep();

    expect((await h.su.collection('generation_jobs').getOne(stuck.id)).status).toBe('FAILED');
    expect(await h.su.collection('scenes').getOne(stuckScene.id)).toMatchObject({ status: 'PENDING', draft: '' });
    expect((await h.su.collection('chapters').getOne(chapters[0]!.id)).status).not.toBe('GENERATING');

    // Le job vivant n'a rien vu passer.
    const liveScenes = await scenesOf(h, live.chapterId);
    expect(liveScenes.some((s) => s.status === 'GENERATING' && s.draft)).toBe(true);
    expect(h.deps.jobs.activeJobs.has(live.jobId)).toBe(true);

    await u.api('POST', `/jobs/${live.jobId}/cancel`, { keepPartial: false });
    expect((await job(h, live.jobId)).status).toBe('CANCELLED');
  });
});

describe('arrêt du serveur', () => {
  it('interrompt les jobs en cours, les range et relâche le verrou', async () => {
    const { project, chapterId, jobId } = await slowWrite();

    await h.deps.jobs.shutdown(5000);

    const record = await h.su.collection('generation_jobs').getOne(jobId);
    expect(record).toMatchObject({ status: 'FAILED', error_message: SHUTDOWN_MESSAGE });
    expect(h.deps.jobs.activeJobs.size).toBe(0);
    expect(h.deps.locks.has(project.id)).toBe(false);
    const scenes = await scenesOf(h, chapterId);
    expect(scenes.every((s) => s.status !== 'GENERATING' && !s.draft)).toBe(true);
    expect((await h.su.collection('chapters').getOne(chapterId)).status).not.toBe('GENERATING');
  });

  it('rend la main tout de suite sans job en cours', async () => {
    const started = Date.now();
    await h.deps.jobs.shutdown(5000);
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('panne de PocketBase', () => {
  /** Coupe les appels du serveur vers PocketBase qui correspondent au motif, comme un réseau tombé. */
  function cut(pattern: RegExp) {
    const original = globalThis.fetch;
    return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (pattern.test(url)) return Promise.reject(new TypeError('fetch failed'));
      return original(input, init);
    });
  }

  it('répond 503, pas « session expirée », quand l’authentification ne peut pas être vérifiée', async () => {
    const spy = cut(/auth-refresh/);
    try {
      const r = await u.api('GET', '/me/usage');
      expect(r.status).toBe(503);
      expect(r.body.error).toBe('storage_unavailable');
    } finally {
      spy.mockRestore();
    }
  });

  it('répond 401 pour un jeton refusé', async () => {
    const r = await h.app.inject({ method: 'GET', url: '/api/me/usage', headers: { authorization: 'Bearer faux' } });
    expect(r.statusCode).toBe(401);
  });

  it('répond 503, pas 404, quand la ressource ne peut pas être lue', async () => {
    const { project } = await writingProject(h, u, 1, 1100);
    const spy = cut(/\/collections\/projects\/records\//);
    try {
      const r = await u.api('GET', `/projects/${project.id}/report`);
      expect(r.status).toBe(503);
    } finally {
      spy.mockRestore();
    }
  });

  it('répond toujours 404 pour la ressource d’un autre', async () => {
    const other = await createUser(h);
    const { project } = await writingProject(h, other, 1, 1100);
    expect((await u.api('GET', `/projects/${project.id}/report`)).status).toBe(404);
  });
});

describe('schéma des utilisateurs', () => {
  it('n’a plus le champ `roles`, que chacun pouvait s’attribuer', async () => {
    const users = await h.su.collections.getOne('users');
    const names = users.fields.map((f: { name: string }) => f.name);
    expect(names).toContain('role');
    expect(names).not.toContain('roles');
  });
});
