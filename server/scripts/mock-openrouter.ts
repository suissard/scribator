/**
 * Simulateur local d'OpenRouter, pour tester sans clé ni coût.
 * Il parle le vrai protocole (SSE, sorties structurées, usage, refus, catalogue de modèles) : le code
 * applicatif passe par le vrai SDK. Il ne dit RIEN de la qualité de la prose ni du comportement réel
 * du cache, et il ne valide pas les schémas comme le ferait un vrai fournisseur.
 *
 * Marqueurs reconnus dans le prompt : [[REFUSE]] refus, [[REFUSE_ONCE]] refus sauf sur le modèle de repli,
 * [[MODERATE]] 403 de modération, [[MIDERROR]] erreur en cours de flux, [[SLOW]] flux très lent,
 * [[TRUNCATE]] arrêt par longueur, [[EMPTY]] réponse vide.
 */
import { createHash } from 'node:crypto';
import http from 'node:http';

export interface MockOptions {
  port?: number;
  chunkDelayMs?: number;
  thinkingDelayMs?: number;
}

export interface MockServer {
  url: string;
  requests: Array<Record<string, any>>;
  aborted: () => number;
  close: () => Promise<void>;
}

const WORDS = `La pluie frappait les vitres du vieux phare pendant que Marthe rangeait les cartes marines
sans un mot. Elle savait que la mer rendrait tôt ou tard ce qu'elle avait pris, et que personne au village
ne voudrait l'entendre. Le vent tourna vers le nord, la lampe vacilla, puis quelqu'un frappa trois coups à la porte.`
  .replace(/\s+/g, ' ')
  .split(' ');

function prose(targetWords: number): string {
  const out: string[] = [];
  while (out.length < targetWords) out.push(...WORDS);
  return `${out.slice(0, targetWords).join(' ')}.`;
}

function promptText(body: any): string {
  return body.messages.map((m: any) => (typeof m.content === 'string' ? m.content : m.content.map((b: any) => b.text).join('\n'))).join('\n');
}

const model = (id: string, over: object = {}) => ({
  id,
  name: id.split('/')[1],
  context_length: 1_000_000,
  pricing: { prompt: '0.000002', completion: '0.00001', input_cache_read: '0.0000002' },
  supported_parameters: ['max_tokens', 'reasoning', 'response_format', 'structured_outputs'],
  top_provider: { max_completion_tokens: 128_000 },
  reasoning: { supported_efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  ...over,
});

const CATALOG = [
  model('simu/redaction'),
  model('simu/rapide'),
  model('simu/repli'),
  model('gratuit/libre:free', { pricing: { prompt: '0', completion: '0' } }),
  model('nvidia/nemotron-3.5-super-vl:free', { pricing: { prompt: '0', completion: '0' } }), // celui de .env.mock, hors ligne
  model('simu/redaction:batch'),
  model('petit/sans-reflexion', { context_length: 32_000, supported_parameters: ['max_tokens', 'structured_outputs'], top_provider: { max_completion_tokens: 8000 }, reasoning: null }),
  model('vieux/sans-json', { supported_parameters: ['max_tokens'] }),
  model('openrouter/auto', { pricing: { prompt: '-1', completion: '-1' } }),
];

function structuredAnswer(schema: any, prompt: string): unknown {
  const props = schema?.properties ?? {};
  if (props.tone) {
    return {
      tone: 'sobre et mélancolique', pacing: 'lent, avec des accélérations brèves', vocabulary_level: 'courant et précis',
      narrative_pov: 'troisième personne limitée', tense: 'passé simple', sentence_structure: 'phrases courtes, parfois nominales',
      dialogue_style: 'rares, sans incise', stylistic_rules: ['Préférer le concret à l’abstrait', 'Une image par paragraphe'],
      forbidden_tropes: ['le rêve explicatif'], forbidden_phrases: ['un frisson lui parcourut l’échine'],
    };
  }
  if (props.reformulated_concept) {
    return {
      reformulated_concept: '**Pitch.** Une gardienne de phare découvre que la mer rend ce qu’on lui a confié.\n\n**Thèmes.** Mémoire, deuil.\n\n**Arc.** De la solitude à la vérité.',
      story_bible: {
        characters: [{ name: 'Marthe', role: 'principal', traits: 'taciturne, obstinée', current_status: 'gardienne du phare' }],
        locations: [{ name: 'Le phare de la Vieille', description: 'tour battue par les vents' }],
        world_rules: [{ rule: 'La mer rend les objets à marée d’équinoxe' }],
        timeline_events: [{ chapter_number: 0, event: 'Disparition du mari de Marthe' }],
      },
    };
  }
  if (props.chapters) {
    const missing = Number(prompt.match(/exactement (\d+) nouveaux chapitres/)?.[1] ?? 3);
    return {
      chapters: Array.from({ length: missing }, (_, i) => ({
        title: `Marée ${i + 1}`, brief_summary: `Marthe affronte la marée numéro ${i + 1}.`,
        key_events: ['Un objet revient', 'Le village se tait'], after_chapter_id: null,
      })),
    };
  }
  if (props.scenes) {
    const count = Number(prompt.match(/exactement (\d+) scènes/)?.[1] ?? 2);
    const total = Number(prompt.match(/environ (\d+) mots/)?.[1] ?? 2000);
    return {
      scenes: Array.from({ length: count }, (_, i) => ({
        beat: `Temps ${i + 1} : Marthe avance d’un pas vers la vérité.`,
        target_words: Math.round(total / count),
        scene_break_before: i > 0,
      })),
    };
  }
  if (props.post_writing_summary) {
    return {
      post_writing_summary: prose(160),
      bible_patch: {
        add: { characters: [{ name: 'Le visiteur', role: 'secondaire', traits: 'trempé, muet', current_status: 'au phare' }], locations: [], world_rules: [], timeline_events: [] },
        updates: [], removals: [],
      },
    };
  }
  if (props.explanation) {
    return {
      explanation: 'Tu raccourcis systématiquement les phrases et supprimes les adverbes.',
      changes: {
        tone: null, pacing: null, vocabulary_level: null, sentence_structure: 'phrases encore plus courtes', dialogue_style: null,
        stylistic_rules: ['Supprimer les adverbes en -ment'], forbidden_tropes: [], forbidden_phrases: [],
      },
      evidence: [{ before: 'lentement et sans un mot', after: 'sans un mot' }],
    };
  }
  if (props.synopsis) return { synopsis: prose(200) };
  return {};
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function startMock(options: MockOptions = {}): Promise<MockServer> {
  const requests: MockServer['requests'] = [];
  const seenPrefixes = new Set<string>();
  let aborted = 0;

  const usageFor = (body: any, outputTokens: number) => {
    const system = body.messages.find((m: any) => m.role === 'system');
    const blocks = Array.isArray(system?.content) ? system.content : [];
    let read = 0;
    let written = 0;
    let prefix = '';
    for (const b of blocks) {
      prefix += b.text;
      if (!b.cache_control) continue;
      const key = createHash('sha256').update(body.model + prefix).digest('hex');
      const tokens = Math.ceil(b.text.length / 4);
      if (seenPrefixes.has(key)) read += tokens;
      else {
        written += tokens;
        seenPrefixes.add(key);
      }
    }
    const prompt = read + written + Math.ceil(JSON.stringify(body.messages.filter((m: any) => m.role !== 'system')).length / 4);
    return {
      prompt_tokens: prompt,
      completion_tokens: outputTokens,
      total_tokens: prompt + outputTokens,
      prompt_tokens_details: { cached_tokens: read, cache_write_tokens: written },
      cost: ((prompt - read - written) * 2 + read * 0.2 + written * 2.5 + outputTokens * 10) / 1_000_000,
    };
  };

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const url = req.url ?? '';
      if (url.startsWith('/api/v1/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: CATALOG }));
        return;
      }
      if (!url.startsWith('/api/v1/chat/completions')) {
        res.writeHead(404).end('{}');
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push(body);
      const prompt = promptText(body);
      const refused = prompt.includes('[[REFUSE]]') || (prompt.includes('[[REFUSE_ONCE]]') && !body.model.includes('repli'));
      const id = `gen-mock-${requests.length}`;
      const base = { id, created: 0, model: body.model, provider: 'Mock' };

      if (body.model.endsWith(':free') && body.provider?.data_collection === 'deny') {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 404, message: 'No endpoints found matching your data policy (Free model training). Configure: https://openrouter.ai/settings/privacy' } }));
        return;
      }

      if (prompt.includes('[[MODERATE]]')) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 403, message: 'flagged', metadata: { reasons: ['violence'], flagged_input: 'x', provider_name: 'Mock', model_slug: body.model } } }));
        return;
      }

      if (!body.stream) {
        const schema = body.response_format?.json_schema?.schema;
        const text = schema ? JSON.stringify(structuredAnswer(schema, prompt)) : 'ok';
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ...base,
          object: 'chat.completion',
          choices: [{
            index: 0,
            finish_reason: refused ? 'content_filter' : 'stop',
            native_finish_reason: refused ? 'refusal' : 'end_turn',
            message: { role: 'assistant', content: refused ? null : text, refusal: refused ? 'Je ne peux pas.' : null },
          }],
          usage: usageFor(body, Math.ceil(text.length / 4)),
        }));
        return;
      }

      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      let closed = false;
      res.on('close', () => {
        if (!res.writableEnded) {
          closed = true;
          aborted++;
        }
      });
      const chunk = (delta: object, finish: string | null = null, extra: object = {}) =>
        res.write(`data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`);
      const end = (finish: string, outputTokens: number) => {
        chunk({}, finish, { usage: usageFor(body, outputTokens) });
        res.write('data: [DONE]\n\n');
        res.end();
      };

      res.write(': OPENROUTER PROCESSING\n\n');
      await sleep(options.thinkingDelayMs ?? 0);

      if (refused) return end('content_filter', 0);
      if (prompt.includes('[[EMPTY]]')) return end('length', 100);

      const target = Number(prompt.match(/Vise environ (\d+) mots/)?.[1] ?? 1000);
      const all = prose(target).split(' ');
      const words = prompt.includes('[[TRUNCATE]]') ? all.slice(0, 20) : all;
      const delay = prompt.includes('[[SLOW]]') ? 200 : (options.chunkDelayMs ?? 0);
      for (let i = 0; i < words.length && !closed; i += 8) {
        chunk({ role: 'assistant', content: `${words.slice(i, i + 8).join(' ')} ` });
        if (delay) await sleep(delay);
        if (i >= 16 && prompt.includes('[[MIDERROR]]')) {
          res.write(`data: ${JSON.stringify({ ...base, error: { code: 'server_error', message: 'Provider disconnected unexpectedly' }, choices: [{ index: 0, delta: { content: '' }, finish_reason: 'error' }] })}\n\n`);
          res.end();
          return;
        }
      }
      if (closed) return;
      end(prompt.includes('[[TRUNCATE]]') ? 'length' : 'stop', Math.ceil(words.length * 1.4));
    });
  });

  return new Promise((resolve) => {
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      const address = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${address.port}/api/v1`,
        requests,
        aborted: () => aborted,
        close: () =>
          new Promise((r) => {
            server.closeAllConnections();
            server.close(() => r());
          }),
      });
    });
  });
}

if (process.argv[1]?.endsWith('mock-openrouter.ts')) {
  const port = Number(process.env.MOCK_PORT ?? 4010);
  const mock = await startMock({
    port,
    chunkDelayMs: Number(process.env.MOCK_CHUNK_MS ?? 60),
    thinkingDelayMs: Number(process.env.MOCK_THINK_MS ?? 2500),
  });
  console.log(`Simulateur OpenRouter sur ${mock.url}/api/v1`);
}
