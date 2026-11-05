import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import PocketBase from 'pocketbase';
import { startMock, type MockServer } from '../../scripts/mock-openrouter.js';
import { buildApp } from '../../src/app.js';
import { loadEnv, type Env } from '../../src/config/env.js';
import type { Deps } from '../../src/deps.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const bin = path.join(root, 'pocketbase/pocketbase');
const SU = { email: 'su@test.local', password: 'superuser-test-1' };

export interface Harness {
  pbUrl: string;
  su: PocketBase;
  mock: MockServer;
  app: FastifyInstance;
  deps: Deps;
  env: Env;
  stop(): Promise<void>;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function until<T>(fn: () => Promise<T | undefined | false | null>, timeoutMs = 15000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('Délai dépassé dans until()');
    await sleep(25);
  }
}

export async function startHarness(over: Partial<Record<string, string>> = {}): Promise<Harness> {
  const dir = mkdtempSync(path.join(tmpdir(), 'scribator-pb-'));
  const args = [`--dir=${dir}`, `--migrationsDir=${root}/pocketbase/pb_migrations`, `--hooksDir=${root}/pocketbase/pb_hooks`];
  execFileSync(bin, ['superuser', 'upsert', SU.email, SU.password, ...args], { stdio: 'ignore' });
  const port = 19000 + Math.floor(Math.random() * 900);
  const pbUrl = `http://127.0.0.1:${port}`;
  const proc: ChildProcess = spawn(bin, ['serve', `--http=127.0.0.1:${port}`, '--hooksWatch=false', ...args], { stdio: 'ignore' });
  await until(() => fetch(`${pbUrl}/api/health`).then((r) => r.ok).catch(() => false));

  const mock = await startMock();
  const cleanup = async () => {
    await mock.close();
    proc.kill();
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    const env = loadEnv({
      NODE_ENV: 'test',
      POCKETBASE_URL: pbUrl,
      PB_SUPERUSER_EMAIL: SU.email,
      PB_SUPERUSER_PASSWORD: SU.password,
      OPENROUTER_API_KEY: 'mock',
      OPENROUTER_BASE_URL: mock.url,
      AI_MODEL_REFUSAL_FALLBACK: '',
      DRAFT_TICK_MS: '20',
      LOG_PROMPTS: 'true',
      ...over,
    });
    const { app, deps } = await buildApp(env);
    await app.ready();
    const su = new PocketBase(pbUrl);
    su.autoCancellation(false);
    await su.collection('_superusers').authWithPassword(SU.email, SU.password);
    return {
      pbUrl, su, mock, app, deps, env,
      async stop() {
        await app.close();
        await cleanup();
      },
    };
  } catch (e) {
    await cleanup(); // un démarrage refusé ne doit pas laisser de PocketBase orphelin
    throw e;
  }
}

let counter = 0;

export async function createUser(h: Harness, over: Record<string, unknown> = {}) {
  const email = `user${++counter}@test.local`;
  const password = 'password-test-1';
  const record = await h.su.collection('users').create({
    email, password, passwordConfirm: password, accepted_terms_at: new Date().toISOString(), ...over,
  });
  const pb = new PocketBase(h.pbUrl);
  pb.autoCancellation(false);
  await pb.collection('users').authWithPassword(email, password);
  const api = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => {
    const res = await h.app.inject({
      method, url: `/api${url}`,
      headers: { authorization: `Bearer ${pb.authStore.token}` },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
    return { status: res.statusCode, body: res.headers['content-type']?.toString().includes('json') ? res.json() : res.body, raw: res };
  };
  return { id: record.id, pb, api };
}

export type TestUser = Awaited<ReturnType<typeof createUser>>;

export const STYLE = {
  tone: 'sec', pacing: 'vif', vocabulary_level: 'simple', narrative_pov: 'je', tense: 'passé',
  sentence_structure: 'courte', dialogue_style: 'rare', stylistic_rules: ['r'], forbidden_tropes: ['t'], forbidden_phrases: ['p'],
};
export const BIBLE = {
  characters: [{ id: 'char_a', name: 'Ana', role: 'principal', traits: 'vive', current_status: 'libre' }],
  locations: [], world_rules: [], timeline_events: [],
};

/** Projet déjà à l'étape d'écriture, avec n chapitres, pour tester le studio sans rejouer l'analyse. */
export async function writingProject(h: Harness, u: TestUser, chapters = 3, words = 2200, over: Record<string, unknown> = {}) {
  const project = await h.su.collection('projects').create({
    user: u.id, title: 'Le Phare', language: 'fr', genre: 'noir', audience: 'adulte', status: 'STEP_5_WRITING',
    length_preset: 'CUSTOM', target_chapter_count: chapters, target_words_per_chapter: words,
    style_matrix: STYLE, story_bible: BIBLE, reformulated_concept: 'Un concept.', sample_text: 'Échantillon de référence.', ...over,
  });
  const list = [];
  for (let i = 1; i <= chapters; i++) {
    list.push(await h.su.collection('chapters').create({
      project: project.id, chapter_number: i, title: `Chapitre ${i}`, brief_summary: `Résumé ${i}`,
      key_events: ['e'], target_words: words, status: 'PENDING',
    }));
  }
  return { project, chapters: list };
}

export async function job(h: Harness, id: string) {
  return until(async () => {
    const j = await h.su.collection('generation_jobs').getOne(id);
    return j.status !== 'RUNNING' && !h.deps.jobs.activeJobs.has(id) ? j : false;
  });
}

export async function writeChapter(h: Harness, u: TestUser, chapterId: string) {
  const r = await u.api('POST', `/chapters/${chapterId}/write`);
  if (r.status !== 202) throw new Error(`write: ${r.status} ${JSON.stringify(r.body)}`);
  return job(h, r.body.jobId);
}

export async function approveChapter(u: TestUser, chapterId: string) {
  const r = await u.api('POST', `/chapters/${chapterId}/approve`);
  if (r.status !== 200) throw new Error(`approve: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

export const scenesOf = (h: Harness, chapterId: string) =>
  h.su.collection('scenes').getFullList({ filter: `chapter = "${chapterId}"`, sort: 'scene_number' });
