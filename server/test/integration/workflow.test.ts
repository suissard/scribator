import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import PocketBase from 'pocketbase';
import { startMock } from '../../scripts/mock-openrouter.js';
import { ModelCatalog } from '../../src/services/models.service.js';
import { countWords } from '../../src/services/parser.service.js';
import {
  approveChapter, createUser, job, scenesOf, sleep, startHarness, until, writeChapter, writingProject, BIBLE, STYLE,
  type Harness, type TestUser,
} from './harness.js';

let h: Harness;
let u: TestUser;

beforeAll(async () => {
  h = await startHarness();
  u = await createUser(h);
});
afterAll(() => h.stop());

const book = () => Array.from({ length: 4000 }, (_, i) => `Le vent soufflait fort ce soir-là ${i % 7 ? 'sur la falaise' : 'dans la lande'}.`).join('\n\n');

describe('tranche 1 : fondations', () => {
  it('refuse une inscription publique', async () => {
    await expect(new PocketBase(h.pbUrl).collection('users').create({ email: 'x@y.co', password: 'password123', passwordConfirm: 'password123' })).rejects.toMatchObject({ status: 403 });
  });

  it('refuse au navigateur de modifier le statut', async () => {
    const p = await u.pb.collection('projects').create({ user: u.id, title: 'x' });
    expect(p.status).toBe('STEP_1_INPUT');
    await expect(u.pb.collection('projects').update(p.id, { status: 'COMPLETED' })).rejects.toBeTruthy();
    expect((await h.su.collection('projects').getOne(p.id)).status).toBe('STEP_1_INPUT');
  });

  it('isole les utilisateurs', async () => {
    const other = await createUser(h);
    const { project } = await writingProject(h, other, 1);
    expect((await u.api('POST', `/projects/${project.id}/outline`)).status).toBe(404);
    expect((await u.api('GET', `/projects/${project.id}/export?format=md`)).status).toBe(404);
  });

  it('exige une authentification', async () => {
    const r = await h.app.inject({ method: 'GET', url: '/api/me/usage' });
    expect(r.statusCode).toBe(401);
    expect(r.json().request_id).toBe(r.headers['x-request-id']);
  });

  it('journalise un appel IA de test avec tokens et coût', async () => {
    const admin = await createUser(h);
    await h.su.collection('users').update(admin.id, { role: 'admin' });
    expect((await u.api('POST', '/admin/ai-test')).status).toBe(403);
    const r = await admin.api('POST', '/admin/ai-test');
    expect(r.status).toBe(200);
    const [call] = await h.su.collection('ai_calls').getFullList({ filter: `user = "${admin.id}"` });
    expect(call).toMatchObject({ purpose: 'test', status: 'OK', stop_reason: 'stop' });
    expect(call!.input_tokens).toBeGreaterThan(0);
    expect(call!.cost_usd).toBeGreaterThan(0);
    expect(call!.request_id).toBeTruthy();
  });

  it('renvoie une erreur serveur avec un request_id', async () => {
    const r = await u.api('POST', '/chapters/reorder', { nope: true });
    expect(r.status).toBe(400);
    expect(r.body.request_id).toBeTruthy();
  });

  it('répond à /health et accepte les erreurs frontend', async () => {
    expect((await h.app.inject({ url: '/api/health' })).json()).toEqual({ status: 'ok', pocketbase: 'ok' });
    const r = await h.app.inject({ method: 'POST', url: '/api/client-errors', payload: { message: 'boum' } });
    expect(r.statusCode).toBe(200);
    const warn = await h.app.inject({ method: 'POST', url: '/api/client-errors', payload: { level: 'warn', message: 'x', context: { status: 404 } } });
    expect(warn.statusCode).toBe(200);
    const bad = await h.app.inject({ method: 'POST', url: '/api/client-errors', payload: { level: 'info', message: 'x' } });
    expect(bad.statusCode).toBe(400);
  });

  it('limite à 30 requêtes par minute sur les routes IA, par utilisateur', async () => {
    const limited = await createUser(h);
    const { project } = await writingProject(h, limited, 1);
    const codes: number[] = [];
    for (let i = 0; i < 31; i++) codes.push((await limited.api('POST', `/projects/${project.id}/sample/approve`)).status);
    expect(codes.slice(0, 30).every((c) => c === 409)).toBe(true);
    expect(codes[30]).toBe(429);
    const other = await createUser(h);
    const { project: p2 } = await writingProject(h, other, 1);
    expect((await other.api('POST', `/projects/${p2.id}/sample/approve`)).status).toBe(409);
  });
});

describe('tranches 2 et 3 : du fichier à l’échantillon', () => {
  let projectId: string;

  it('analyse un fichier, le supprime et ouvre l’étape 2', async () => {
    const fd = new FormData();
    fd.append('user', u.id);
    fd.append('title', 'Le Phare');
    fd.append('language', 'fr');
    fd.append('genre', 'noir');
    fd.append('audience', 'adulte');
    fd.append('length_preset', 'NOUVELLE');
    fd.append('target_chapter_count', '4');
    fd.append('target_words_per_chapter', '2000');
    fd.append('raw_ideas', 'Une gardienne de phare.');
    fd.append('reference_file', new Blob([book()], { type: 'text/plain' }), 'ref.txt');
    const p = await u.pb.collection('projects').create(fd);
    projectId = p.id;
    const r = await u.api('POST', `/projects/${p.id}/analyze`);
    expect(r.status).toBe(202);
    expect((await job(h, r.body.jobId)).status).toBe('DONE');
    const after = await h.su.collection('projects').getOne(p.id);
    expect(after.status).toBe('STEP_2_CONCEPT_REVIEW');
    expect(after.reference_file).toBe('');
    expect(after.reference_meta.word_count).toBeGreaterThan(20_000);
    expect(after.reference_meta.language).toBe('fr');
    expect(after.style_matrix.tone).toBeTruthy();
    expect(after.story_bible.characters[0].id).toMatch(/^char_/);
    expect(after.reformulated_concept).toContain('Pitch');
  });

  it('ne réinjecte jamais le texte de référence dans les prompts d’écriture', () => {
    const concept = h.mock.requests.findLast((r) => r.response_format?.json_schema?.schema?.properties?.reformulated_concept)!;
    expect(JSON.stringify(concept)).not.toContain('soufflait fort');
  });

  it('fonctionne sans ouvrage de référence, CGU non acceptées comprises', async () => {
    const noTerms = await createUser(h, { accepted_terms_at: '' });
    const p = await noTerms.pb.collection('projects').create({
      user: noTerms.id, title: 'Sans modèle', language: 'fr', genre: 'noir', raw_ideas: 'Une gardienne de phare.',
      target_chapter_count: 3, target_words_per_chapter: 1000,
    });
    const r = await noTerms.api('POST', `/projects/${p.id}/analyze`);
    expect(r.status).toBe(202);
    expect((await job(h, r.body.jobId)).status).toBe('DONE');
    const after = await h.su.collection('projects').getOne(p.id);
    expect(after.status).toBe('STEP_2_CONCEPT_REVIEW');
    expect(after.style_matrix.tone).toBeTruthy();
    expect(after.story_bible.characters).toHaveLength(1);
    expect(after.reference_meta).toBeNull();
    const call = await h.su.collection('ai_calls').getFirstListItem(`project = "${p.id}" && purpose = "style_extract"`);
    expect(call.prompt_version).toBe('style_invent.v1');
    expect(call.model).toBe('simu/redaction');
  });

  it('refuse une analyse sans idées ni ouvrage', async () => {
    const p = await u.pb.collection('projects').create({ user: u.id, title: 'Vide' });
    expect((await u.api('POST', `/projects/${p.id}/analyze`)).status).toBe(400);
  });

  it('expose l’échec lisible d’un fichier trop court', async () => {
    const fd = new FormData();
    fd.append('user', u.id);
    fd.append('title', 'Court');
    fd.append('reference_file', new Blob(['trop court ici']), 'r.txt');
    const p = await u.pb.collection('projects').create(fd);
    const r = await u.api('POST', `/projects/${p.id}/analyze`);
    const j = await job(h, r.body.jobId);
    expect(j.status).toBe('FAILED');
    expect(j.error_message).toMatch(/trop court/);
    expect((await h.su.collection('projects').getOne(p.id)).reference_file).not.toBe('');
  });

  it('refuse l’analyse sans CGU acceptées', async () => {
    const noTerms = await createUser(h, { accepted_terms_at: '' });
    const fd = new FormData();
    fd.append('reference_file', new Blob([book()]), 'r.txt');
    const p = await noTerms.pb.collection('projects').create({ user: noTerms.id, title: 'x' });
    await expect(noTerms.pb.collection('projects').update(p.id, fd)).rejects.toBeTruthy();
    await noTerms.api('POST', '/me/accept-terms');
    await noTerms.pb.collection('users').authRefresh();
    await noTerms.pb.collection('projects').update(p.id, fd);
  });

  it('édite le style et la Bible via l’API, validés par Zod, avec historique', async () => {
    expect((await u.api('PATCH', `/projects/${projectId}/style`, { tone: 12 })).status).toBe(400);
    expect((await u.api('PATCH', `/projects/${projectId}/style`, { tone: 'lumineux' })).status).toBe(200);
    const bible = (await h.su.collection('projects').getOne(projectId)).story_bible;
    expect((await u.api('PATCH', `/projects/${projectId}/bible`, { ...bible, characters: 'non' })).status).toBe(400);
    expect((await u.api('PATCH', `/projects/${projectId}/bible`, bible)).status).toBe(200);
    const v = await h.su.collection('versions').getFullList({ filter: `target_id = "${projectId}" && field = "style_matrix" && reason = "before_patch"` });
    expect(v).toHaveLength(1);
  });

  it('génère la trame et conserve à la regénération un chapitre retouché', async () => {
    expect((await u.api('POST', `/projects/${projectId}/outline`)).status).toBe(200);
    const chapters = () => h.su.collection('chapters').getFullList({ filter: `project = "${projectId}"`, sort: 'chapter_number' });
    let list = await chapters();
    expect(list).toHaveLength(4);
    expect((await h.su.collection('projects').getOne(projectId)).status).toBe('STEP_3_OUTLINE_REVIEW');
    await u.pb.collection('chapters').update(list[1]!.id, { brief_summary: 'Écrit à la main', user_edited_outline: true });
    const untouched = list[0]!.id;
    expect((await u.api('POST', `/projects/${projectId}/outline`, { userFeedback: 'Plus sombre' })).status).toBe(200);
    list = await chapters();
    expect(list).toHaveLength(4);
    expect(list.map((c) => c.chapter_number)).toEqual([1, 2, 3, 4]);
    expect(list.find((c) => c.brief_summary === 'Écrit à la main')).toBeTruthy();
    expect(list.find((c) => c.id === untouched)).toBeUndefined();
  });

  it('ajoute, réordonne et supprime les chapitres PENDING', async () => {
    const list = () => h.su.collection('chapters').getFullList({ filter: `project = "${projectId}"`, sort: 'chapter_number' });
    const added = await u.api('POST', `/projects/${projectId}/chapters`, { title: 'Ajouté' });
    expect(added.status).toBe(200);
    const before = await list();
    expect(before).toHaveLength(5);
    const reversed = before.map((c) => c.id).reverse();
    expect((await u.api('POST', '/chapters/reorder', { projectId, orderedIds: reversed })).status).toBe(200);
    expect((await list())[0]!.title).toBe('Ajouté');
    expect((await u.api('DELETE', `/chapters/${added.body.chapter.id}`)).status).toBe(200);
    const after = await list();
    expect(after.map((c) => c.chapter_number)).toEqual([1, 2, 3, 4]);
  });

  it('écrit l’échantillon par le tampon et le fige', async () => {
    const r = await u.api('POST', `/projects/${projectId}/sample`);
    expect(r.status).toBe(202);
    await job(h, r.body.jobId);
    const p = await h.su.collection('projects').getOne(projectId);
    expect(p.status).toBe('STEP_4_SAMPLE_REVIEW');
    expect(p.sample_draft).toBe('');
    expect(p.sample_text.length).toBeGreaterThan(100);
    expect(p.sample_ai_original).toBe(p.sample_text);
  });

  it('un échantillon reformaté sans changer un mot donne 0 % et aucune suggestion', async () => {
    const p = await h.su.collection('projects').getOne(projectId);
    const tiptap = p.sample_text.replace(/'/g, '’').replace(/ /g, ' ');
    await u.pb.collection('projects').update(projectId, { sample_text: tiptap });
    const { computeDiff } = await import('../../src/services/memory.service.js');
    expect(computeDiff(p.sample_ai_original, tiptap).changedPercent).toBe(0);
  });

  it('une correction de plus de 5 % produit une suggestion avec exemples, sans toucher au style', async () => {
    const p = await h.su.collection('projects').getOne(projectId);
    const words = p.sample_ai_original.split(' ');
    await u.pb.collection('projects').update(projectId, { sample_text: words.slice(0, Math.floor(words.length * 0.8)).join(' ') });
    const r = await u.api('POST', `/projects/${projectId}/sample/approve`);
    expect(r.status).toBe(200);
    expect(r.body.changedPercent).toBeGreaterThan(5);
    const [change] = await h.su.collection('pending_changes').getFullList({ filter: `project = "${projectId}"` });
    expect(change).toMatchObject({ kind: 'STYLE_SUGGESTION', status: 'PENDING' });
    expect(change!.payload.evidence.length).toBeGreaterThan(0);
    const after = await h.su.collection('projects').getOne(projectId);
    expect(after.style_matrix.sentence_structure).toBe(p.style_matrix.sentence_structure);
    expect(after.status).toBe('STEP_5_WRITING');
  });

  it('transforme l’échantillon en scène 1 du chapitre 1 et applique la proposition acceptée', async () => {
    const [first] = await h.su.collection('chapters').getFullList({ filter: `project = "${projectId}"`, sort: 'chapter_number' });
    const scenes = await scenesOf(h, first!.id);
    expect(scenes).toHaveLength(1);
    expect(scenes[0]).toMatchObject({ status: 'REVIEW', scene_number: 1 });
    expect(first!.status).toBe('PLANNED');
    const [change] = await h.su.collection('pending_changes').getFullList({ filter: `project = "${projectId}"` });
    expect((await u.api('POST', `/pending-changes/${change!.id}/accept`)).status).toBe(200);
    expect((await u.api('POST', `/pending-changes/${change!.id}/accept`)).status).toBe(409);
    const p = await h.su.collection('projects').getOne(projectId);
    expect(p.style_matrix.stylistic_rules).toContain('Supprimer les adverbes en -ment');
  });

  it('écrit le chapitre 1 autour de l’échantillon, sans repartir de zéro', async () => {
    const [first] = await h.su.collection('chapters').getFullList({ filter: `project = "${projectId}"`, sort: 'chapter_number' });
    const j = await writeChapter(h, u, first!.id);
    expect(j.status).toBe('DONE');
    const scenes = await scenesOf(h, first!.id);
    expect(scenes.length).toBeGreaterThan(1);
    expect(scenes.every((s) => s.status === 'REVIEW')).toBe(true);
    const total = scenes.reduce((n, s) => n + countWords(s.content), 0);
    expect(Math.abs(total - 2000) / 2000).toBeLessThan(0.15);
  });
});

describe('verrou', () => {
  it('un double clic sur une route job ne lance qu’une exécution', async () => {
    const { project, chapters } = await writingProject(h, u, 1);
    const [a, b] = await Promise.all([
      u.api('POST', `/chapters/${chapters[0]!.id}/write`),
      u.api('POST', `/chapters/${chapters[0]!.id}/write`),
    ]);
    expect([a.status, b.status].sort()).toEqual([202, 409]);
    await job(h, (a.status === 202 ? a : b).body.jobId);
    const jobs = await h.su.collection('generation_jobs').getFullList({ filter: `project = "${project.id}"` });
    expect(jobs).toHaveLength(1);
  });

  it('un double clic sur la route synchrone outline aussi', async () => {
    const { project } = await writingProject(h, u, 2);
    await h.su.collection('projects').update(project.id, { status: 'STEP_2_CONCEPT_REVIEW' });
    const before = h.mock.requests.length;
    const [a, b] = await Promise.all([u.api('POST', `/projects/${project.id}/outline`), u.api('POST', `/projects/${project.id}/outline`)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(h.mock.requests.length).toBe(before + 1);
  });

  it('relâche le verrou après une erreur', async () => {
    const { project } = await writingProject(h, u, 1);
    await h.su.collection('projects').update(project.id, { status: 'STEP_2_CONCEPT_REVIEW', reformulated_concept: '[[REFUSE]]' });
    expect((await u.api('POST', `/projects/${project.id}/outline`)).status).toBe(422);
    await h.su.collection('projects').update(project.id, { reformulated_concept: 'ok' });
    expect((await u.api('POST', `/projects/${project.id}/outline`)).status).toBe(200);
  });

  it('un job en base bloque même sans verrou mémoire', async () => {
    const { project } = await writingProject(h, u, 1);
    await h.su.collection('generation_jobs').create({ user: u.id, project: project.id, kind: 'SAMPLE', status: 'RUNNING', target_id: project.id });
    expect((await u.api('POST', `/projects/${project.id}/sample`)).status).toBe(409);
  });
});

describe('tranche 4 : studio', () => {
  it('atteint la cible de mots et lit le cache dès la 2e scène, Bible comprise', async () => {
    const bigBible = { ...BIBLE, world_rules: Array.from({ length: 50 }, (_, i) => ({ id: `rule_${i}`, rule: `Règle ${i}` })) };
    const { project, chapters } = await writingProject(h, u, 2, 3500, { story_bible: bigBible });
    await writeChapter(h, u, chapters[0]!.id);
    const scenes = await scenesOf(h, chapters[0]!.id);
    expect(scenes).toHaveLength(3);
    const total = scenes.reduce((n, s) => n + countWords(s.content), 0);
    expect(Math.abs(total - 3500) / 3500).toBeLessThan(0.15);
    expect(scenes[0]!.ai_original_content).toBe(scenes[0]!.content);
    expect(scenes[0]!.draft).toBe('');
    const calls = await h.su.collection('ai_calls').getFullList({ filter: `project = "${project.id}" && purpose = "scene_write"`, sort: 'created' });
    expect(calls).toHaveLength(3);
    expect(calls[0]!.prompt_version).toBe('scene_write.v1:full');
    expect(calls[1]!.cache_read_tokens).toBeGreaterThan(0);
    expect(calls[2]!.cache_read_tokens).toBeGreaterThan(0);
  });

  it('envoie à OpenRouter les paramètres attendus', () => {
    const scene = h.mock.requests.findLast((r) => r.stream && r.model === 'simu/redaction')!;
    expect(scene.max_tokens).toBe(16000);
    expect(scene.reasoning).toEqual({ effort: 'medium', exclude: true });
    expect(scene.session_id).toBeTruthy();
    expect(scene.messages[0].role).toBe('system');
    expect(scene.messages[0].content.every((b: any) => b.cache_control?.type === 'ephemeral')).toBe(true);
    const structured = h.mock.requests.findLast((r) => r.response_format)!;
    expect(structured.provider).toEqual({ data_collection: 'deny', require_parameters: true });
    expect(structured.response_format.json_schema.strict).toBe(true);
    for (const r of h.mock.requests) {
      expect(r.provider.data_collection).toBe('deny');
      expect(r).not.toHaveProperty('temperature');
    }
  });

  it('impose l’ordre des chapitres', async () => {
    const { chapters } = await writingProject(h, u, 2);
    expect((await u.api('POST', `/chapters/${chapters[1]!.id}/write`)).status).toBe(409);
  });

  async function slowChapter() {
    const ctx = await writingProject(h, u, 1, 2200, { reformulated_concept: '[[SLOW]]' });
    const chapterId = ctx.chapters[0]!.id;
    const r = await u.api('POST', `/chapters/${chapterId}/write`);
    expect(r.status).toBe(202);
    const generating = await until(async () => {
      const list = await scenesOf(h, chapterId);
      const s = list.find((x) => x.status === 'GENERATING' && x.draft);
      return s ?? false;
    });
    return { ...ctx, chapterId, jobId: r.body.jobId as string, scene: generating };
  }

  it('coupe le flux en moins d’une seconde et jette le début sur demande', async () => {
    const { chapterId, jobId, scene } = await slowChapter();
    const abortedBefore = h.mock.aborted();
    const started = Date.now();
    expect((await u.api('POST', `/jobs/${jobId}/cancel`, { keepPartial: false })).status).toBe(200);
    await until(async () => h.mock.aborted() > abortedBefore);
    expect(Date.now() - started).toBeLessThan(1000);
    expect((await job(h, jobId)).status).toBe('CANCELLED');
    const after = await h.su.collection('scenes').getOne(scene.id);
    expect(after).toMatchObject({ status: 'PENDING', draft: '', content: '' });
    expect((await h.su.collection('chapters').getOne(chapterId)).status).toBe('PLANNED');
  });

  it('garde le début sur demande et laisse reprendre les scènes restantes', async () => {
    const { chapterId, jobId, scene, project } = await slowChapter();
    await u.api('POST', `/jobs/${jobId}/cancel`, { keepPartial: true });
    await job(h, jobId);
    const after = await h.su.collection('scenes').getOne(scene.id);
    expect(after.status).toBe('REVIEW');
    expect(after.content).toBeTruthy();
    expect(after.ai_original_content).toBe(after.content);
    expect((await h.su.collection('chapters').getOne(chapterId)).status).toBe('REVIEW');
    const cost = await h.su.collection('ai_calls').getFirstListItem(`project = "${project.id}" && status = "CANCELLED"`);
    expect(cost.cost_usd).toBeGreaterThan(0); // une annulation reste facturée
    await h.su.collection('projects').update(project.id, { reformulated_concept: 'normal' });
    const r = await u.api('POST', `/chapters/${chapterId}/write`);
    expect(r.status).toBe(202);
    await job(h, r.body.jobId);
    expect((await scenesOf(h, chapterId)).every((s) => s.status === 'REVIEW')).toBe(true);
  });

  it('régénère une scène : archive au succès seulement, avec les instructions', async () => {
    const { chapters } = await writingProject(h, u, 1);
    await writeChapter(h, u, chapters[0]!.id);
    const [scene] = await scenesOf(h, chapters[0]!.id);
    await u.pb.collection('scenes').update(scene!.id, { content: 'Ma version retouchée.' });

    const fail = await u.api('POST', `/scenes/${scene!.id}/regenerate`, { instructions: '[[REFUSE]]' });
    const failed = await job(h, fail.body.jobId);
    expect(failed.status).toBe('FAILED');
    expect(failed.error_message).toMatch(/refusé cette scène/);
    let current = await h.su.collection('scenes').getOne(scene!.id);
    expect(current).toMatchObject({ status: 'REVIEW', content: 'Ma version retouchée.', draft: '' });
    expect(await h.su.collection('versions').getFullList({ filter: `target_id = "${scene!.id}"` })).toHaveLength(0);

    const ok = await u.api('POST', `/scenes/${scene!.id}/regenerate`, { instructions: 'Plus de pluie' });
    await job(h, ok.body.jobId);
    expect(JSON.stringify(h.mock.requests.at(-1))).toContain('Plus de pluie');
    const versions = await h.su.collection('versions').getFullList({ filter: `target_id = "${scene!.id}"` });
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ content: 'Ma version retouchée.', reason: 'before_regenerate' });

    expect((await u.api('POST', `/versions/${versions[0]!.id}/restore`)).status).toBe(200);
    current = await h.su.collection('scenes').getOne(scene!.id);
    expect(current.content).toBe('Ma version retouchée.');
    const all = await h.su.collection('versions').getFullList({ filter: `target_id = "${scene!.id}"` });
    expect(all.map((v) => v.reason).sort()).toEqual(['before_regenerate', 'before_restore']);
  });

  it('un refus sans scène écrite met le chapitre en erreur', async () => {
    const { chapters } = await writingProject(h, u, 1, 1100, { reformulated_concept: '[[REFUSE]] sur la scène' });
    await h.su.collection('scenes').create({ chapter: chapters[0]!.id, scene_number: 1, beat: '[[REFUSE]]', target_words: 1100, status: 'PENDING' });
    const j = await writeChapter(h, u, chapters[0]!.id);
    expect(j.status).toBe('FAILED');
    expect((await h.su.collection('chapters').getOne(chapters[0]!.id)).status).toBe('ERROR');
    expect((await scenesOf(h, chapters[0]!.id))[0]).toMatchObject({ status: 'PENDING', draft: '' });
    const [call] = await h.su.collection('ai_calls').getFullList({ filter: `status = "REFUSED"`, sort: '-created' });
    expect(call!.stop_reason).toBe('content_filter');
  });

  it('une erreur en cours de flux restaure la scène', async () => {
    const { chapters, project } = await writingProject(h, u, 1, 1100, { reformulated_concept: '[[MIDERROR]]' });
    const j = await writeChapter(h, u, chapters[0]!.id);
    expect(j.status).toBe('FAILED');
    expect((await scenesOf(h, chapters[0]!.id))[0]).toMatchObject({ status: 'PENDING', draft: '', content: '' });
    expect(h.deps.locks.has(project.id)).toBe(false);
  });

  it('un 403 de modération est présenté comme un refus', async () => {
    const { chapters } = await writingProject(h, u, 1, 1100, { reformulated_concept: '[[MODERATE]]' });
    const j = await writeChapter(h, u, chapters[0]!.id);
    expect(j.error_message).toMatch(/refusé/);
  });

  it('une réponse vide est une erreur, pas une scène blanche', async () => {
    const { chapters } = await writingProject(h, u, 1, 1100, { reformulated_concept: '[[EMPTY]]' });
    expect((await writeChapter(h, u, chapters[0]!.id)).status).toBe('FAILED');
    expect((await scenesOf(h, chapters[0]!.id))[0]!.status).toBe('PENDING');
  });

  it('retente un refus sur le modèle de repli, en repartant de zéro', async () => {
    const withFallback = await startHarness({ AI_MODEL_REFUSAL_FALLBACK: 'simu/repli' });
    try {
      const user = await createUser(withFallback);
      const { chapters, project } = await writingProject(withFallback, user, 1, 1100, { reformulated_concept: '[[REFUSE_ONCE]]' });
      expect((await writeChapter(withFallback, user, chapters[0]!.id)).status).toBe('DONE');
      expect((await scenesOf(withFallback, chapters[0]!.id))[0]!.content).toContain('phare');
      const calls = await withFallback.su.collection('ai_calls').getFullList({ filter: `project = "${project.id}" && purpose = "scene_write"`, sort: 'created' });
      expect(calls.map((c) => [c.model, c.status])).toEqual([['simu/redaction', 'REFUSED'], ['simu/repli', 'OK']]);
    } finally {
      await withFallback.stop();
    }
  });

  it('adapte la requête à un modèle sans réflexion et à petit contexte', async () => {
    const small = await startHarness({ AI_MODEL_CREATIVE: 'petit/sans-reflexion' });
    try {
      const user = await createUser(small);
      const { chapters } = await writingProject(small, user, 1, 1100);
      await writeChapter(small, user, chapters[0]!.id);
      const request = small.mock.requests.findLast((r) => r.stream)!;
      expect(request).not.toHaveProperty('reasoning');
      expect(request.max_tokens).toBe(8000);
      expect(small.deps.llm.catalog.memoryLimit('petit/sans-reflexion', 100_000)).toBe(16_000);
    } finally {
      await small.stop();
    }
  });

  it('refuse de démarrer avec un modèle inutilisable', async () => {
    await expect(startHarness({ AI_MODEL_FAST: 'vieux/sans-json' })).rejects.toThrow(/sorties structurées/);
    await expect(startHarness({ AI_MODEL_CREATIVE: 'inconnu/modele' })).rejects.toThrow(/inconnu/i);
  });

  it('signale une scène tronquée sans perdre le texte', async () => {
    const { chapters } = await writingProject(h, u, 1, 1100, { reformulated_concept: '[[TRUNCATE]]' });
    await writeChapter(h, u, chapters[0]!.id);
    const [scene] = await scenesOf(h, chapters[0]!.id);
    expect(scene).toMatchObject({ truncated: true, status: 'REVIEW' });
    expect(scene!.content).toBeTruthy();
  });

  it('valide un chapitre : résumé, propositions et déblocage du suivant', async () => {
    const { project, chapters } = await writingProject(h, u, 2);
    await writeChapter(h, u, chapters[0]!.id);
    const scenes = await scenesOf(h, chapters[0]!.id);
    await u.pb.collection('scenes').update(scenes[0]!.id, { content: 'Tout réécrit à la main.' });
    await approveChapter(u, chapters[0]!.id);
    const c = await h.su.collection('chapters').getOne(chapters[0]!.id);
    expect(c.status).toBe('APPROVED');
    expect(c.approved_at).toBeTruthy();
    expect(countWords(c.post_writing_summary)).toBeGreaterThanOrEqual(150);
    const changes = await h.su.collection('pending_changes').getFullList({ filter: `project = "${project.id}"` });
    expect(changes.map((x) => x.kind).sort()).toEqual(['BIBLE_PATCH', 'STYLE_SUGGESTION']);
    expect((await h.su.collection('projects').getOne(project.id)).story_bible.characters).toHaveLength(1); // rien sans accord

    expect((await u.pb.collection('scenes').update(scenes[1]!.id, { content: 'x' }).catch((e) => e.status))).toBe(404);
    await writeChapter(h, u, chapters[1]!.id);
    expect(JSON.stringify(h.mock.requests.at(-1))).toContain('Tout réécrit à la main.'); // mémoire intégrale
    await approveChapter(u, chapters[1]!.id);
    expect((await h.su.collection('projects').getOne(project.id)).status).toBe('COMPLETED');
  });

  it('un échec de résumé laisse le chapitre en relecture', async () => {
    const { chapters } = await writingProject(h, u, 1);
    await writeChapter(h, u, chapters[0]!.id);
    const [scene] = await scenesOf(h, chapters[0]!.id);
    await u.pb.collection('scenes').update(scene!.id, { content: '[[REFUSE]]' });
    expect((await u.api('POST', `/chapters/${chapters[0]!.id}/approve`)).status).toBe(422);
    expect((await h.su.collection('chapters').getOne(chapters[0]!.id)).status).toBe('REVIEW');
    expect((await scenesOf(h, chapters[0]!.id))[0]!.status).toBe('REVIEW');
  });

  it('rouvrir le chapitre 2 alors que le 4 est validé périme le 3 et le 4', async () => {
    const { project, chapters } = await writingProject(h, u, 4, 1100);
    for (const c of chapters) {
      await writeChapter(h, u, c.id);
      await approveChapter(u, c.id);
    }
    expect((await h.su.collection('projects').getOne(project.id)).status).toBe('COMPLETED');
    await h.su.collection('projects').update(project.id, { archived_synopsis: 'Synopsis', synopsis_covers_up_to: 3 });

    expect((await u.api('POST', `/chapters/${chapters[1]!.id}/reopen`)).status).toBe(200);
    const list = await h.su.collection('chapters').getFullList({ filter: `project = "${project.id}"`, sort: 'chapter_number' });
    expect(list.map((c) => c.status)).toEqual(['APPROVED', 'REVIEW', 'STALE', 'STALE']);
    expect(list[2]!.stale_reason).toContain('Chapitre 2');
    const p = await h.su.collection('projects').getOne(project.id);
    expect(p).toMatchObject({ status: 'STEP_5_WRITING', archived_synopsis: '', synopsis_covers_up_to: 1 });
    expect((await scenesOf(h, chapters[1]!.id))[0]!.status).toBe('REVIEW');

    await approveChapter(u, chapters[1]!.id);
    expect((await u.api('POST', `/chapters/${chapters[2]!.id}/refresh-memory`)).status).toBe(200);
    expect((await u.api('POST', `/chapters/${chapters[3]!.id}/ignore-stale`)).status).toBe(200);
    expect((await h.su.collection('projects').getOne(project.id)).status).toBe('COMPLETED');
  });

  it('passe en mode résumés et compresse au-delà de la limite', async () => {
    const small = await startHarness({ MEMORY_FULLTEXT_TOKEN_LIMIT: '100', SUMMARY_COMPRESS_WORDS: '200' });
    try {
      const su = await createUser(small);
      const { project, chapters } = await writingProject(small, su, 4, 1100);
      for (const c of chapters) {
        await writeChapter(small, su, c.id);
        await approveChapter(su, c.id);
      }
      const calls = await small.su.collection('ai_calls').getFullList({ filter: `purpose = "scene_write"`, sort: '-created' });
      expect(calls[0]!.prompt_version).toBe('scene_write.v1:summary');
      const p = await small.su.collection('projects').getOne(project.id);
      expect(p.synopsis_covers_up_to).toBe(2);
      expect(p.archived_synopsis).toBeTruthy();
    } finally {
      await small.stop();
    }
  });

  it('budget dépassé : message clair et aucun appel IA', async () => {
    const poor = await createUser(h, { monthly_budget_usd: 0.000001 });
    const { project, chapters } = await writingProject(h, poor, 1);
    await h.su.collection('ai_calls').create({ user: poor.id, cost_usd: 1, status: 'OK', purpose: 'test' });
    const before = h.mock.requests.length;
    const r = await poor.api('POST', `/chapters/${chapters[0]!.id}/write`);
    expect(r.status).toBe(402);
    expect(r.body.message).toMatch(/Budget mensuel atteint/);
    expect((await poor.api('POST', `/projects/${project.id}/sample`)).status).toBe(402);
    expect(h.mock.requests.length).toBe(before);
    expect((await poor.api('GET', '/me/usage')).body).toMatchObject({ spent_usd: 1 });
  });

  it('supprimer un projet ne remet pas le budget à zéro', async () => {
    const owner = await createUser(h);
    const { project, chapters } = await writingProject(h, owner, 1);
    await writeChapter(h, owner, chapters[0]!.id);
    const before = (await owner.api('GET', '/me/usage')).body.spent_usd;
    expect(before).toBeGreaterThan(0);
    await owner.pb.collection('projects').delete(project.id);
    expect((await owner.api('GET', '/me/usage')).body.spent_usd).toBeCloseTo(before);
  });

  it('conserve 10 versions par champ', async () => {
    const { project } = await writingProject(h, u, 1);
    for (let i = 0; i < 12; i++) await u.api('PATCH', `/projects/${project.id}/style`, { tone: `ton ${i}` });
    const v = await h.su.collection('versions').getFullList({ filter: `target_id = "${project.id}" && field = "style_matrix"` });
    expect(v).toHaveLength(10);
  });
});

describe('modèle de rédaction par livre', () => {
  it('garde l’ordre du catalogue et écarte les routeurs sans prix', async () => {
    const { body } = await u.api('GET', '/models');
    const ids = body.models.map((m: { id: string }) => m.id);
    expect(ids).not.toContain('openrouter/auto');
    expect(ids.indexOf('simu/redaction')).toBeLessThan(ids.indexOf('gratuit/libre:free'));
    expect(ids.indexOf('gratuit/libre:free')).toBeLessThan(ids.indexOf('petit/sans-reflexion'));
    expect(ids).not.toEqual([...ids].sort());
  });

  it('lit le catalogue indiqué, et se rabat sur l’API s’il est injoignable', async () => {
    const log = { warn() {} };
    const fallback = new ModelCatalog();
    await fallback.load(h.mock.url, log, 'http://127.0.0.1:1/models');
    expect(fallback.selectable().length).toBeGreaterThan(0);

    const other = await startMock();
    const fromUrl = new ModelCatalog();
    await fromUrl.load('http://127.0.0.1:1', log, `${other.url}/models`);
    await other.close();
    expect(fromUrl.selectable().length).toBeGreaterThan(0);
  });

  it('liste les modèles utilisables, sans variantes batch', async () => {
    const r = await u.api('GET', '/models');
    expect(r.body.default_model).toBe('simu/redaction');
    const ids = r.body.models.map((m: any) => m.id);
    expect(ids).toContain('gratuit/libre:free');
    expect(ids).not.toContain('vieux/sans-json');
    expect(ids).not.toContain('simu/redaction:batch');
    expect(r.body.models.find((m: any) => m.id === 'gratuit/libre:free').free).toBe(true);
  });

  it('valide le choix côté serveur et l’interdit au navigateur', async () => {
    const { project } = await writingProject(h, u, 1);
    expect((await u.api('PATCH', `/projects/${project.id}/model`, { model: 'vieux/sans-json' })).status).toBe(400);
    expect((await u.api('PATCH', `/projects/${project.id}/model`, { model: 'inconnu/x' })).status).toBe(400);
    await expect(u.pb.collection('projects').update(project.id, { model_creative: 'inconnu/x' })).rejects.toBeTruthy();
    await expect(u.pb.collection('projects').create({ user: u.id, title: 'x', model_creative: 'inconnu/x' })).rejects.toBeTruthy();
    const other = await createUser(h);
    expect((await other.api('PATCH', `/projects/${project.id}/model`, { model: 'gratuit/libre:free' })).status).toBe(404);
  });

  it('rédige avec le modèle du livre, le modèle rapide ne change pas', async () => {
    const { project, chapters } = await writingProject(h, u, 1, 1100);
    expect((await u.api('PATCH', `/projects/${project.id}/model`, { model: 'petit/sans-reflexion' })).status).toBe(200);
    await writeChapter(h, u, chapters[0]!.id);
    const calls = await h.su.collection('ai_calls').getFullList({ filter: `project = "${project.id}"` });
    expect(calls.find((c) => c.purpose === 'scene_write')!.model).toBe('petit/sans-reflexion');
    expect(calls.find((c) => c.purpose === 'scene_plan')!.model).toBe('simu/rapide');
    const request = h.mock.requests.findLast((r) => r.stream)!;
    expect(request.max_tokens).toBe(8000);
    expect(request).not.toHaveProperty('reasoning');
  });

  it('explique le blocage d’un modèle gratuit par la politique de données', async () => {
    const { chapters } = await writingProject(h, u, 1, 1100, { model_creative: 'gratuit/libre:free' });
    await h.su.collection('scenes').create({ chapter: chapters[0]!.id, scene_number: 1, beat: 'b', target_words: 1100, status: 'PENDING' });
    const j = await writeChapter(h, u, chapters[0]!.id);
    expect(j.status).toBe('FAILED');
    expect(j.error_message).toMatch(/réglages de confidentialité/);
    const [call] = await h.su.collection('ai_calls').getFullList({ filter: 'model = "gratuit/libre:free"', sort: '-created' });
    expect(call!.error_message).toContain('data policy'); // le détail brut reste dans le journal
  });

  it('revient au modèle du serveur quand le choix est vidé', async () => {
    const { project, chapters } = await writingProject(h, u, 1, 1100, { model_creative: 'petit/sans-reflexion' });
    expect((await u.api('PATCH', `/projects/${project.id}/model`, { model: '' })).status).toBe(200);
    await writeChapter(h, u, chapters[0]!.id);
    expect(h.mock.requests.findLast((r) => r.stream)!.model).toBe('simu/redaction');
  });

  it('explique qu’un modèle retiré du catalogue n’est plus disponible', async () => {
    const { chapters } = await writingProject(h, u, 1, 1100, { model_creative: 'retire/du-catalogue' });
    await h.su.collection('scenes').create({ chapter: chapters[0]!.id, scene_number: 1, beat: 'b', target_words: 1100, status: 'PENDING' });
    const j = await writeChapter(h, u, chapters[0]!.id);
    expect(j.status).toBe('FAILED');
    expect(j.error_message).toMatch(/n'est plus disponible/);
    expect((await scenesOf(h, chapters[0]!.id))[0]!.status).toBe('PENDING');
  });
});

describe('garde-fou', () => {
  it('le redémarrage ne laisse aucune scène en GENERATING', async () => {
    const { project, chapters } = await writingProject(h, u, 1);
    const chapter = chapters[0]!;
    await h.su.collection('chapters').update(chapter.id, { status: 'GENERATING' });
    const stuck = await h.su.collection('scenes').create({ chapter: chapter.id, scene_number: 1, status: 'GENERATING', draft: 'moitié', beat: 'b' });
    const kept = await h.su.collection('scenes').create({ chapter: chapter.id, scene_number: 2, status: 'GENERATING', draft: 'x', content: 'ancien', beat: 'b' });
    await h.su.collection('projects').update(project.id, { sample_draft: 'moitié' });
    const j = await h.su.collection('generation_jobs').create({ user: u.id, project: project.id, kind: 'CHAPTER', status: 'RUNNING', target_id: chapter.id });
    await h.deps.jobs.recoverOnStartup();
    expect(await h.su.collection('generation_jobs').getOne(j.id)).toMatchObject({ status: 'FAILED', error_message: 'Serveur redémarré' });
    expect(await h.su.collection('scenes').getOne(stuck.id)).toMatchObject({ status: 'PENDING', draft: '' });
    expect(await h.su.collection('scenes').getOne(kept.id)).toMatchObject({ status: 'REVIEW', draft: '', content: 'ancien' });
    expect((await h.su.collection('chapters').getOne(chapter.id)).status).toBe('REVIEW');
    expect((await h.su.collection('projects').getOne(project.id)).sample_draft).toBe('');
  });

  it('le watchdog interrompt un job trop long', async () => {
    const { chapters, project } = await writingProject(h, u, 1, 2200, { reformulated_concept: '[[SLOW]]' });
    const r = await u.api('POST', `/chapters/${chapters[0]!.id}/write`);
    await until(async () => (await scenesOf(h, chapters[0]!.id)).some((s) => s.status === 'GENERATING' && s.draft));
    await h.su.collection('generation_jobs').update(r.body.jobId, { started_at: '2020-01-01 00:00:00.000Z' });
    await (h.deps.jobs as any).sweep();
    const j = await job(h, r.body.jobId);
    expect(j.status).toBe('FAILED');
    expect(j.error_message).toMatch(/délai/i);
    expect((await scenesOf(h, chapters[0]!.id)).every((s) => s.status === 'PENDING')).toBe(true);
    expect(h.deps.locks.has(project.id)).toBe(false);
  });
});

describe('réécriture d’un chapitre', () => {
  let w: TestUser; // son propre compte : ces tests pèsent sur la limite de requêtes IA par utilisateur
  beforeAll(async () => {
    w = await createUser(h);
  });
  const rewrite = (id: string) => w.api('POST', `/chapters/${id}/rewrite`);
  const written = async (brief?: string) => {
    const { project, chapters } = await writingProject(h, w, 2, 2200);
    const chapter = chapters[0]!;
    await writeChapter(h, w, chapter.id);
    const scenes = await scenesOf(h, chapter.id);
    await h.su.collection('scenes').update(scenes[0]!.id, { content: 'Texte de l’auteur', beat: 'Ancien plan' });
    if (brief) await h.su.collection('chapters').update(chapter.id, { brief_summary: brief });
    return { project, chapter, chapters, scenes };
  };
  const versionsOf = (id: string) => h.su.collection('versions').getFullList({ filter: `target_id = "${id}"` });

  it('refait le plan et le texte, et garde l’ancien dans l’historique', async () => {
    const { chapter, scenes } = await written();
    const r = await rewrite(chapter.id);
    expect(r.status).toBe(202);
    expect((await job(h, r.body.jobId)).status).toBe('DONE');
    const after = await scenesOf(h, chapter.id);
    expect(after.map((s) => s.id)).toEqual(scenes.map((s) => s.id));
    expect(after.every((s) => s.status === 'REVIEW')).toBe(true);
    expect(after[0]!.content).not.toBe('Texte de l’auteur');
    expect(after[0]!.beat).not.toBe('Ancien plan');
    expect((await versionsOf(scenes[0]!.id)).map((v) => v.content)).toContain('Texte de l’auteur');
    expect((await h.su.collection('chapters').getOne(chapter.id)).status).toBe('REVIEW');
    await approveChapter(w, chapter.id);
  });

  it('archive les scènes en trop', async () => {
    const { chapter } = await written();
    const extra = await h.su.collection('scenes').create({ chapter: chapter.id, scene_number: 9, beat: 'x', target_words: 100, content: 'Scène en trop', status: 'REVIEW' });
    const r = await rewrite(chapter.id);
    expect((await job(h, r.body.jobId)).status).toBe('DONE');
    expect((await scenesOf(h, chapter.id)).map((s) => s.scene_number)).toEqual([1, 2]);
    expect((await versionsOf(extra.id)).map((v) => v.content)).toContain('Scène en trop');
  });

  it('ne touche à rien si le nouveau plan échoue', async () => {
    const { chapter } = await written('[[REFUSE]]');
    const r = await rewrite(chapter.id);
    expect((await job(h, r.body.jobId)).status).toBe('FAILED');
    const [first] = await scenesOf(h, chapter.id);
    expect(first).toMatchObject({ content: 'Texte de l’auteur', beat: 'Ancien plan', status: 'REVIEW' });
    expect((await h.su.collection('chapters').getOne(chapter.id)).status).toBe('REVIEW');
  });

  it('exige un chapitre en relecture, après un chapitre validé', async () => {
    const { chapter, chapters } = await written();
    expect((await rewrite(chapters[1]!.id)).status).toBe(409);
    await approveChapter(w, chapter.id);
    expect((await rewrite(chapter.id)).status).toBe(409);
    expect((await rewrite(chapters[1]!.id)).status).toBe(409);
    expect(h.deps.locks.has(chapter.project)).toBe(false);
  });
});

describe('écriture automatique du livre', () => {
  const start = async (id: string, who = u) => {
    const r = await who.api('POST', `/projects/${id}/write-all`);
    expect(r.status).toBe(202);
    return r.body.jobId as string;
  };
  const chaptersOf = (id: string) => h.su.collection('chapters').getFullList({ filter: `project = "${id}"`, sort: 'chapter_number' });

  it('écrit, valide et clôt le livre, en appliquant la Bible au fil de l’eau', async () => {
    const { project } = await writingProject(h, u, 3, 2200);
    const j = await job(h, await start(project.id));
    expect(j.status).toBe('DONE');
    expect(j.kind).toBe('BOOK');
    expect(j.duration_ms).toBeGreaterThan(0);
    expect((await chaptersOf(project.id)).every((c) => c.status === 'APPROVED' && c.post_writing_summary)).toBe(true);
    const after = await h.su.collection('projects').getOne(project.id);
    expect(after.status).toBe('COMPLETED');
    expect(after.story_bible.characters.map((c: { name: string }) => c.name)).toContain('Le visiteur');
    const pending = await h.su.collection('pending_changes').getFullList({ filter: `project = "${project.id}"` });
    expect(pending).toHaveLength(0);
    expect(h.deps.locks.has(project.id)).toBe(false);
  });

  it('remplit chaque étape et connaît le nombre exact de scènes', async () => {
    const { project } = await writingProject(h, u, 2, 2200);
    const j = await job(h, await start(project.id));
    const stages = Object.fromEntries(j.progress.stages.map((s: { key: string }) => [s.key, s]));
    expect(stages.plan).toMatchObject({ done: 2, total: 2, basis: 'run' });
    expect(stages.write).toMatchObject({ done: 4, total: 4, basis: 'run' });
    expect(stages.memory).toMatchObject({ done: 2, total: 2, basis: 'run' });
    expect(stages.write.avg_ms).toBeGreaterThan(0);
  });

  it('annonce une estimation égale au travail réellement fait', async () => {
    const { project } = await writingProject(h, u, 2, 2200);
    const r = await u.api('GET', `/projects/${project.id}/estimate`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ chapters: 2, plans: 2, scenes: 4 });
    expect(r.body.duration_ms).toBeGreaterThan(0);
    expect(r.body.budget_left_usd).toBeGreaterThan(0);
  });

  it('encadre le coût réel par sa fourchette, et les tokens à moins d’un facteur 2', async () => {
    const { project } = await writingProject(h, u, 5, 3300);
    const { body: estimate } = await u.api('GET', `/projects/${project.id}/estimate`);
    await job(h, await start(project.id));
    const { body: report } = await u.api('GET', `/projects/${project.id}/report`);
    const { totals } = report;
    expect(totals.cost_usd).toBeGreaterThan(estimate.cost_low_usd);
    expect(totals.cost_usd).toBeLessThan(estimate.cost_high_usd);
    const input = totals.input_tokens + totals.cache_read_tokens + totals.cache_write_tokens;
    expect(input / estimate.input_tokens).toBeGreaterThan(0.5);
    expect(input / estimate.input_tokens).toBeLessThan(2);
    expect(totals.output_tokens / estimate.output_tokens).toBeGreaterThan(0.5);
    expect(totals.output_tokens / estimate.output_tokens).toBeLessThan(2);
  });

  it('estime selon le modèle du livre', async () => {
    const { project } = await writingProject(h, u, 2, 2200);
    const paid = (await u.api('GET', `/projects/${project.id}/estimate`)).body;
    await h.su.collection('projects').update(project.id, { model_creative: 'gratuit/libre:free' });
    const free = (await u.api('GET', `/projects/${project.id}/estimate`)).body;
    expect(free.model).toBe('gratuit/libre:free');
    expect(free.input_tokens).toBe(paid.input_tokens);
    expect(free.cost_high_usd).toBeLessThan(paid.cost_low_usd);
  });

  it('rend compte des tokens, du cache et du coût, y compris hors job', async () => {
    const { project } = await writingProject(h, u, 2, 2200);
    await job(h, await start(project.id));
    const { status, body } = await u.api('GET', `/projects/${project.id}/report`);
    expect(status).toBe(200);
    expect(body.by_purpose.map((p: { purpose: string }) => p.purpose).sort()).toEqual(['chapter_summary', 'scene_plan', 'scene_write']);
    expect(body.totals).toMatchObject({ calls: 2 + 4 + 2, failed_calls: 0 });
    expect(body.totals.output_tokens).toBeGreaterThan(0);
    expect(body.totals.cache_read_tokens).toBeGreaterThan(0);
    expect(body.totals.cost_usd).toBeGreaterThan(0);
    expect(body.words).toBeGreaterThan(3000);
    expect(body.cost_per_1000_words).toBeGreaterThan(0);
  });

  it('un autre utilisateur ne voit ni l’estimation ni le compte rendu', async () => {
    const { project } = await writingProject(h, u, 1, 1100);
    const other = await createUser(h);
    expect((await other.api('GET', `/projects/${project.id}/report`)).status).toBe(404);
    expect((await other.api('GET', `/projects/${project.id}/estimate`)).status).toBe(404);
    expect((await other.api('POST', `/projects/${project.id}/write-all`)).status).toBe(404);
  });

  it('refuse avant la validation de l’échantillon, et sur un livre fini', async () => {
    const early = await writingProject(h, u, 1, 1100, { status: 'STEP_4_SAMPLE_REVIEW' });
    expect((await u.api('POST', `/projects/${early.project.id}/write-all`)).status).toBe(409);
    const { project } = await writingProject(h, u, 1, 1100);
    await job(h, await start(project.id));
    await h.su.collection('projects').update(project.id, { status: 'STEP_5_WRITING' });
    expect((await u.api('POST', `/projects/${project.id}/write-all`)).status).toBe(409);
  });

  it('s’arrête sur demande, puis reprend là où il en était', async () => {
    const { project, chapters } = await writingProject(h, u, 2, 2200, { reformulated_concept: '[[SLOW]]' });
    const id = await start(project.id);
    await until(async () => (await scenesOf(h, chapters[0]!.id)).some((s) => s.status === 'GENERATING' && s.draft));
    expect((await u.api('POST', `/jobs/${id}/cancel`, { keepPartial: false })).status).toBe(200);
    expect((await job(h, id)).status).toBe('CANCELLED');
    expect((await chaptersOf(project.id)).some((c) => c.status === 'GENERATING')).toBe(false);
    expect((await scenesOf(h, chapters[0]!.id)).every((s) => s.status === 'PENDING')).toBe(true);

    await h.su.collection('projects').update(project.id, { reformulated_concept: 'Un concept.' });
    const planned = h.mock.requests.length;
    const resumed = await job(h, await start(project.id));
    expect(resumed.status).toBe('DONE');
    expect(resumed.progress.stages.find((s: { key: string }) => s.key === 'plan').total).toBe(0);
    expect(h.mock.requests.length).toBe(planned + 4 + 2); // 4 scènes et 2 résumés, aucun nouveau plan
    expect((await h.su.collection('projects').getOne(project.id)).status).toBe('COMPLETED');
  });

  it('s’arrête sur une erreur sans valider le chapitre, avec un message lisible', async () => {
    const { project, chapters } = await writingProject(h, u, 2, 1100);
    await u.api('POST', `/chapters/${chapters[1]!.id}/plan-scenes`);
    const [scene] = await scenesOf(h, chapters[1]!.id);
    await h.su.collection('scenes').update(scene!.id, { beat: '[[REFUSE]]' });
    const j = await job(h, await start(project.id));
    expect(j.status).toBe('FAILED');
    expect(j.error_message).toBeTruthy();
    const [first, second] = await chaptersOf(project.id);
    expect(first!.status).toBe('APPROVED');
    expect(second!.status).toBe('ERROR');
    expect(h.deps.locks.has(project.id)).toBe(false);
  });

  it('refait les chapitres écrits mais non validés, sans toucher aux chapitres validés', async () => {
    const { project, chapters } = await writingProject(h, u, 3, 1100);
    await job(h, await start(project.id));
    await u.api('POST', `/chapters/${chapters[1]!.id}/reopen`);
    expect((await chaptersOf(project.id)).map((c) => c.status)).toEqual(['APPROVED', 'REVIEW', 'STALE']);
    const scenes = await Promise.all(chapters.map(async (c) => (await scenesOf(h, c.id))[0]!));
    for (const s of scenes) await h.su.collection('scenes').update(s.id, { content: 'Ancien texte', beat: 'Ancien plan' });

    const { body: estimate } = await u.api('GET', `/projects/${project.id}/estimate`);
    expect(estimate).toMatchObject({ chapters: 2, plans: 2, scenes: 2, rewrites: 2 });
    const before = h.mock.requests.length;
    const j = await job(h, await start(project.id));
    expect(j.status).toBe('DONE');
    expect(h.mock.requests.length).toBe(before + 6); // par chapitre : un plan, une scène, un résumé
    const stages = Object.fromEntries(j.progress.stages.map((s: { key: string }) => [s.key, s]));
    expect(stages.plan).toMatchObject({ done: 2, total: 2 });
    expect(stages.write).toMatchObject({ done: 2, total: 2 });

    const [approved, reviewed, stale] = await Promise.all(scenes.map((s) => h.su.collection('scenes').getOne(s.id)));
    expect(approved).toMatchObject({ content: 'Ancien texte', beat: 'Ancien plan' });
    for (const s of [reviewed!, stale!]) {
      expect(s.content).not.toBe('Ancien texte');
      expect(s.beat).not.toBe('Ancien plan');
      expect(s.status).toBe('APPROVED');
      const versions = await h.su.collection('versions').getFullList({ filter: `target_id = "${s.id}"` });
      expect(versions.map((v) => v.content)).toContain('Ancien texte');
    }
    const after = await chaptersOf(project.id);
    expect(after.every((c) => c.status === 'APPROVED' && !c.stale_reason)).toBe(true);
    expect((await h.su.collection('projects').getOne(project.id)).status).toBe('COMPLETED');
  });

  it('garde les scènes déjà écrites d’un chapitre interrompu', async () => {
    const { project, chapters } = await writingProject(h, u, 1, 2200);
    await u.api('POST', `/chapters/${chapters[0]!.id}/plan-scenes`);
    const [first, second] = await scenesOf(h, chapters[0]!.id);
    await h.su.collection('scenes').update(first!.id, { content: 'Scène déjà écrite', status: 'REVIEW' });
    await h.su.collection('chapters').update(chapters[0]!.id, { status: 'REVIEW' });
    expect((await job(h, await start(project.id))).status).toBe('DONE');
    expect((await h.su.collection('scenes').getOne(first!.id)).content).toBe('Scène déjà écrite');
    expect((await h.su.collection('scenes').getOne(second!.id)).content).toBeTruthy();
  });

  it('laisse intact un chapitre dont le nouveau plan échoue', async () => {
    const { project, chapters } = await writingProject(h, u, 2, 1100);
    await job(h, await start(project.id));
    await u.api('POST', `/chapters/${chapters[1]!.id}/reopen`);
    await h.su.collection('chapters').update(chapters[1]!.id, { status: 'STALE', brief_summary: '[[REFUSE]]' });
    const text = (await scenesOf(h, chapters[1]!.id))[0]!.content;
    const j = await job(h, await start(project.id));
    expect(j.status).toBe('FAILED');
    expect((await chaptersOf(project.id)).map((c) => c.status)).toEqual(['APPROVED', 'STALE']);
    expect((await scenesOf(h, chapters[1]!.id))[0]).toMatchObject({ content: text, status: 'REVIEW' });
  });

  it('laisse en proposition un patch de Bible inapplicable', async () => {
    const { project } = await writingProject(h, u, 1, 1100);
    await h.su.collection('projects').update(project.id, { story_bible: { ...BIBLE, characters: 'cassée' } }).catch(() => {});
    const ctx = { userId: u.id, projectId: project.id, requestId: 't', log: { info() {}, warn() {}, error() {} } };
    const broken = { operations: [{ op: 'remove', section: 'characters', id: 'char_inconnu', reason: 'x' }] };
    await (h.deps.gen as any).handleBiblePatch(ctx, await h.deps.gen.getProject(project.id), broken, '', { applyBible: true });
    const pending = await h.su.collection('pending_changes').getFullList({ filter: `project = "${project.id}"` });
    expect(pending).toHaveLength(1);
  });

  it('le budget épuisé en route arrête le livre avec un message clair', async () => {
    const poor = await createUser(h, { monthly_budget_usd: 0.000001 });
    const { project } = await writingProject(h, poor, 2, 1100);
    await h.su.collection('ai_calls').create({ user: poor.id, cost_usd: 0, purpose: 'test', status: 'OK' });
    const r = await poor.api('POST', `/projects/${project.id}/write-all`);
    expect(r.status).toBe(202);
    const j = await job(h, r.body.jobId);
    expect(j.status).toBe('FAILED');
    expect(j.error_message).toMatch(/budget/i);
  });

  it('le délai porte sur le dernier maillon : un livre long survit, un livre bloqué non', async () => {
    const { project, chapters } = await writingProject(h, u, 1, 2200, { reformulated_concept: '[[SLOW]]' });
    const id = await start(project.id);
    await until(async () => (await scenesOf(h, chapters[0]!.id)).some((s) => s.status === 'GENERATING' && s.draft));
    await h.su.collection('generation_jobs').update(id, { started_at: '2020-01-01 00:00:00.000Z' });
    await (h.deps.jobs as any).sweep();
    expect(h.deps.jobs.activeJobs.get(id)?.timedOut).toBe(false);

    const sweepLater = new Date(Date.now() + 2 * h.env.JOB_TIMEOUT_MINUTES * 60_000);
    const now = Date.now;
    Date.now = () => sweepLater.getTime();
    try {
      await (h.deps.jobs as any).sweep();
    } finally {
      Date.now = now;
    }
    const j = await job(h, id);
    expect(j.status).toBe('FAILED');
    expect(j.error_message).toMatch(/délai/i);
  });
});

describe('tranche 5 : export et conformité', () => {
  it('exporte aux trois formats', async () => {
    const { project, chapters } = await writingProject(h, u, 1, 1100);
    await writeChapter(h, u, chapters[0]!.id);
    for (const [format, type] of [['md', 'markdown'], ['docx', 'wordprocessing'], ['epub', 'epub']] as const) {
      const r = await u.api('GET', `/projects/${project.id}/export?format=${format}&aiNotice=true`);
      expect(r.status).toBe(200);
      expect(r.raw.headers['content-type']).toContain(type);
      expect(r.raw.headers['content-disposition']).toContain(`.${format}`);
      expect(r.raw.rawPayload.length).toBeGreaterThan(100);
    }
    expect((await u.api('GET', `/projects/${project.id}/export?format=pdf`)).status).toBe(400);
  });

  it('supprimer un compte supprime toutes ses données', async () => {
    const gone = await createUser(h);
    const { project, chapters } = await writingProject(h, gone, 1);
    await writeChapter(h, gone, chapters[0]!.id);
    await approveChapter(gone, chapters[0]!.id);
    await h.su.collection('versions').create({ project: project.id, target_collection: 'projects', target_id: project.id, field: 'sample_text', content: 'x', reason: 'before_patch' });
    await gone.pb.collection('users').delete(gone.id);
    await sleep(50);
    for (const [collection, filter] of [
      ['projects', `id = "${project.id}"`], ['chapters', `project = "${project.id}"`], ['scenes', `chapter = "${chapters[0]!.id}"`],
      ['versions', `project = "${project.id}"`], ['pending_changes', `project = "${project.id}"`],
      ['generation_jobs', `user = "${gone.id}"`], ['ai_calls', `user = "${gone.id}"`],
    ] as const) {
      expect(await h.su.collection(collection).getFullList({ filter })).toHaveLength(0);
    }
  });
});

void STYLE;
