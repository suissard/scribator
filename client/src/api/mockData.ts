import type { BookEstimate, GenerationReport, Usage } from './server';
import type { Chapter, Job, ModelOption, PendingChange, Project, Scene } from '@/lib/types';

export const MOCK_USER = {
  id: 'usr-mock-demo-1',
  email: 'demo@scribator.test',
  name: 'Auteur Démo',
  role: 'admin',
  token: 'mock-jwt-token-for-demo',
};

export const MOCK_MODELS: ModelOption[] = [
  { id: 'mock/claude-3-5-sonnet', name: 'Claude 3.5 Sonnet (Simulé)', input_per_million: 3, output_per_million: 15, context_length: 200000, free: false },
  { id: 'mock/gpt-4o', name: 'GPT-4o (Simulé)', input_per_million: 2.5, output_per_million: 10, context_length: 128000, free: false },
  { id: 'mock/deepseek-chat', name: 'DeepSeek Chat (Simulé)', input_per_million: 0.14, output_per_million: 0.28, context_length: 64000, free: true },
];

export const MOCK_PROJECTS: Project[] = [
  {
    id: 'prj-demo-1',
    user: MOCK_USER.id,
    title: 'Les Ombres de Brumeval',
    language: 'fr',
    genre: 'Fantastique / Mystère',
    audience: 'Adulte',
    status: 'STEP_5_WRITING',
    length_preset: 'ROMAN',
    target_chapter_count: 5,
    target_words_per_chapter: 3000,
    reference_file: '',
    reference_meta: {
      filename: 'extrait_reference.txt',
      word_count: 1450,
      language: 'fr',
      analyzed_at: new Date().toISOString(),
    },
    raw_ideas: 'Une cité médiévale enveloppée d\'un brouillard perpétuel où les souvenirs des défunts se matérialisent sous forme de reflets murmurants dans l\'eau.',
    model_creative: 'mock/claude-3-5-sonnet',
    style_matrix: {
      tone: 'Atmosphérique et immersif',
      pacing: 'Progressif avec montées de tension',
      vocabulary_level: 'Soutenu mais fluide',
      narrative_pov: 'Troisième personne limitée',
      tense: 'Passé simple / Imparfait',
      sentence_structure: 'Variée, alternant phrases courtes d\'action et descriptions sensorielles',
      dialogue_style: 'Naturel avec sous-entendus',
      stylistic_rules: ['Évoquer les odeurs de brume et d\'humidité', 'Focaliser sur les reflets d\'eau'],
      forbidden_tropes: ['Le réveil d\'un rêve', 'L\'élu prophétique'],
      forbidden_phrases: ['Soudainement', 'Comme par magie'],
    },
    story_bible: {
      characters: [
        { id: 'c1', name: 'Albane Vane', role: 'principal', traits: 'Enquêtrice taciturne, attentive aux détails, porte une broche d\'argent', current_status: 'En quête de vérité' },
        { id: 'c2', name: 'Maître Cassian', role: 'secondaire', traits: 'Archiviste de la Tour Haute, érudit mais fuyant', current_status: 'Détient un manuscrit interdit' },
      ],
      locations: [
        { id: 'l1', name: 'Le Pont des Soupirs Givrés', description: 'Vieux pont de pierre traversant le canal principal de Brumeval.' },
        { id: 'l2', name: 'L\'Archivium Souterrain', description: 'Crypte humide conservant les parchemins protégés de la condensation.' },
      ],
      world_rules: [
        { id: 'w1', rule: 'Le brouillard s\'épaissit au crépuscule et rend les reflets audibles.' },
        { id: 'w2', rule: 'L\'argent poli repousse les murmures néfastes.' },
      ],
      timeline_events: [
        { id: 't1', chapter_number: 1, event: 'Découverte du premier reflet instable près de la rive.' },
        { id: 't2', chapter_number: 2, event: 'Rencontre avec Cassian dans les archives désertes.' },
      ],
    },
    reformulated_concept: 'À Brumeval, cité cloîtrée sous un voile de vapeurs spectrales, Albane tente d\'élucider l\'apparition de silhouettes aqueuses répétant les derniers mots des disparus.',
    sample_text: 'La nuit tombait sur les pavés humides de Brumeval, étouffant les bruits de pas d\'Albane sous une épaisse couche de silence. Près du canal, l\'onde sombre frissonna sans un souffle de vent.',
    sample_ai_original: 'La nuit tombait sur les pavés humides de Brumeval, étouffant les bruits de pas d\'Albane...',
    sample_draft: '',
    updated: new Date().toISOString(),
  },
  {
    id: 'prj-demo-2',
    user: MOCK_USER.id,
    title: 'Éclipse stellaire',
    language: 'fr',
    genre: 'Science-Fiction',
    audience: 'Jeune Adulte',
    status: 'STEP_1_INPUT',
    length_preset: 'NOVELLA',
    target_chapter_count: 8,
    target_words_per_chapter: 2500,
    reference_file: '',
    reference_meta: null,
    raw_ideas: 'Une station spatiale à l\'abandon cache une balise d\'origine inconnue.',
    model_creative: 'mock/deepseek-chat',
    style_matrix: null,
    story_bible: null,
    reformulated_concept: '',
    sample_text: '',
    sample_ai_original: '',
    sample_draft: '',
    updated: new Date(Date.now() - 3600000 * 24).toISOString(),
  },
];

export const MOCK_CHAPTERS: Chapter[] = [
  {
    id: 'ch-1',
    project: 'prj-demo-1',
    chapter_number: 1,
    title: 'Les murmures du canal',
    brief_summary: 'Albane découvre un étrange reflet dans l\'eau alors que le brouillard se lève sur Brumeval.',
    key_events: ['Arrivée au bord du canal', 'Apparition du reflet', 'Découverte de l\'indice d\'argent'],
    target_words: 3000,
    user_edited_outline: false,
    status: 'APPROVED',
    post_writing_summary: 'Albane a identifié la source des rumeurs : un artefact oublié sous la digue.',
    stale_reason: '',
  },
  {
    id: 'ch-2',
    project: 'prj-demo-1',
    chapter_number: 2,
    title: 'L\'Archiviste silencieux',
    brief_summary: 'Albane se rend à l\'Archivium pour consulter les registres d\'avant la brume.',
    key_events: ['Entrée dans l\'Archivium', 'Interrogatoire de Cassian', 'Fuite précipitée de l\'assistant'],
    target_words: 3200,
    user_edited_outline: false,
    status: 'REVIEW',
    post_writing_summary: '',
    stale_reason: '',
  },
  {
    id: 'ch-3',
    project: 'prj-demo-1',
    chapter_number: 3,
    title: 'Le Sanctuaire submergé',
    brief_summary: 'Une expédition nocturne sous les fondations de la cité.',
    key_events: ['Descente dans les catacombes', 'Montée soudaine des eaux'],
    target_words: 3500,
    user_edited_outline: false,
    status: 'PLANNED',
    post_writing_summary: '',
    stale_reason: '',
  },
];

export const MOCK_SCENES: Scene[] = [
  {
    id: 'sc-1',
    chapter: 'ch-2',
    scene_number: 1,
    beat: 'Albane descend l\'escalier en colimaçon vers l\'Archivium, l\'odeur de papier moisi la prend à la gorge.',
    target_words: 1500,
    content: 'Les marches de pierre calcaire étaient usées au centre par des siècles de déambulations feutrées. Albane resserra les pans de son manteau de laine brute pour se prémunir du froid mordant qui montait des profondeurs.\n\n— Maître Cassian ? lança-t-elle à mi-voix, sa voix ricochant contre les voûtes basses.\n\nUne silhouette émaciée émergea d\'une rangée de rayonnages croulant sous les reliures de cuir.',
    draft: '',
    status: 'APPROVED',
    scene_break_before: false,
    truncated: false,
  },
  {
    id: 'sc-2',
    chapter: 'ch-2',
    scene_number: 2,
    beat: 'Cassian refuse d\'abord de coopérer, mais la vue de la broche d\'argent éveille en lui une vive inquiétude.',
    target_words: 1700,
    content: 'L\'archiviste posa sur la table de chêne une lourde loupe sertie de laiton. Ses doigts tremblaient légèrement lorsqu\'il désigna la broche épinglée sur le revers d\'Albane.\n\n— Où avez-vous trouvé ceci ? murmura-t-il, les yeux écarquillés par une soudaine lucidité.',
    draft: '',
    status: 'REVIEW',
    scene_break_before: true,
    truncated: false,
  },
];

export const MOCK_CHANGES: PendingChange[] = [
  {
    id: 'pch-1',
    project: 'prj-demo-1',
    kind: 'BIBLE_PATCH',
    source_chapter: 'ch-2',
    status: 'PENDING',
    payload: {
      operations: [
        {
          op: 'add',
          section: 'characters',
          item: {
            id: 'c3',
            name: 'Gaspard',
            role: 'figurant',
            traits: 'Apprenti craintif aux mains tachées d\'encre',
            current_status: 'En fuite',
          },
        },
      ],
    },
  },
];

export const MOCK_JOBS: Job[] = [];

export const MOCK_USAGE: Usage = {
  spent_usd: 1.42,
  budget_usd: 20.0,
};

export const MOCK_ESTIMATE: BookEstimate = {
  chapters: 5,
  plans: 5,
  scenes: 12,
  rewrites: 2,
  duration_ms: 180000,
  basis: 'history',
  model: 'Claude 3.5 Sonnet',
  input_tokens: 125000,
  cacheable_tokens: 85000,
  output_tokens: 28000,
  cost_low_usd: 0.85,
  cost_high_usd: 1.45,
  budget_left_usd: 18.58,
};

export const MOCK_REPORT: GenerationReport = {
  totals: {
    calls: 18,
    failed_calls: 0,
    duration_ms: 42000,
    input_tokens: 95000,
    output_tokens: 16000,
    cache_read_tokens: 65000,
    cache_write_tokens: 15000,
    cost_usd: 1.42,
  },
  by_purpose: [
    { purpose: 'concept', avg_duration_ms: 3200, calls: 2, failed_calls: 0, duration_ms: 6400, input_tokens: 12000, output_tokens: 2000, cache_read_tokens: 8000, cache_write_tokens: 2000, cost_usd: 0.15 },
    { purpose: 'outline', avg_duration_ms: 5400, calls: 3, failed_calls: 0, duration_ms: 16200, input_tokens: 28000, output_tokens: 4500, cache_read_tokens: 18000, cache_write_tokens: 5000, cost_usd: 0.38 },
    { purpose: 'writing', avg_duration_ms: 8100, calls: 13, failed_calls: 0, duration_ms: 19400, input_tokens: 55000, output_tokens: 9500, cache_read_tokens: 39000, cache_write_tokens: 8000, cost_usd: 0.89 },
  ],
  words: 6200,
  truncated_scenes: 0,
  cost_per_1000_words: 0.23,
};
