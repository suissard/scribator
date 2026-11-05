import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser, scenesOf, startHarness, until, writingProject, type Harness, type TestUser } from './harness.js';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/* Le vrai processus serveur, tué par SIGKILL pendant que le flux IA est ouvert. */
function startServer(h: Harness, port: number): ChildProcess {
  return spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: serverDir,
    stdio: 'ignore',
    detached: true, // groupe de processus : npx et node sont tués ensemble
    env: {
      ...process.env, NODE_ENV: 'test', PORT: String(port), POCKETBASE_URL: h.env.POCKETBASE_URL,
      PB_SUPERUSER_EMAIL: h.env.PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD: h.env.PB_SUPERUSER_PASSWORD,
      OPENROUTER_API_KEY: 'mock', OPENROUTER_BASE_URL: h.mock.url, DRAFT_TICK_MS: '20',
    },
  });
}

const killGroup = (p: ChildProcess) => process.kill(-p.pid!, 'SIGKILL');
const up = (port: number) => until(() => fetch(`http://127.0.0.1:${port}/api/health`).then((r) => r.ok).catch(() => false), 30000);

let h: Harness;
let u: TestUser;

beforeAll(async () => {
  h = await startHarness();
  u = await createUser(h);
});
afterAll(() => h.stop());

describe('crash réel du serveur', () => {
  it('aucune scène ne reste en GENERATING après kill -9 puis redémarrage', async () => {
    const port = 19950;
    const base = `http://127.0.0.1:${port}/api`;
    const { chapters, project } = await writingProject(h, u, 1, 2200, { reformulated_concept: '[[SLOW]]' });
    const chapterId = chapters[0]!.id;
    const headers = { authorization: `Bearer ${u.pb.authStore.token}`, 'content-type': 'application/json' };

    const first = startServer(h, port);
    await up(port);
    const res = await fetch(`${base}/chapters/${chapterId}/write`, { method: 'POST', headers, body: '{}' });
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: string };
    await until(async () => (await scenesOf(h, chapterId)).some((s) => s.status === 'GENERATING' && s.draft));

    killGroup(first);
    const frozen = await scenesOf(h, chapterId);
    expect(frozen.some((s) => s.status === 'GENERATING')).toBe(true);

    const second = startServer(h, port);
    try {
      await up(port);
      await until(async () => (await h.su.collection('generation_jobs').getOne(jobId)).status === 'FAILED');
      const job = await h.su.collection('generation_jobs').getOne(jobId);
      expect(job.error_message).toBe('Serveur redémarré');
      const scenes = await scenesOf(h, chapterId);
      expect(scenes.every((s) => s.status === 'PENDING' && s.draft === '')).toBe(true);
      expect((await h.su.collection('chapters').getOne(chapterId)).status).toBe('PLANNED');

      await h.su.collection('projects').update(project.id, { reformulated_concept: 'normal' });
      const retry = await fetch(`${base}/chapters/${chapterId}/write`, { method: 'POST', headers, body: '{}' });
      expect(retry.status).toBe(202); // le verrou n'a pas survécu au crash
    } finally {
      killGroup(second);
    }
  });
});
