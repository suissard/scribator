import {
  MOCK_ESTIMATE,
  MOCK_MODELS,
  MOCK_REPORT,
  MOCK_USAGE,
} from './mockData';
import { mockPb } from './mockPocketbase';
import type { BookEstimate, GenerationReport, Usage } from './server';
import type { Chapter, ModelOption, Scene } from '@/lib/types';

export const mockApi = {
  models: async (): Promise<{ default_model: string; models: ModelOption[] }> => {
    return { default_model: MOCK_MODELS[0].id, models: MOCK_MODELS };
  },

  setModel: async (id: string, model: string): Promise<unknown> => {
    await mockPb.collection('projects').update(id, { model_creative: model });
    window.dispatchEvent(new CustomEvent('mock-project-updated', { detail: { id } }));
    return { model_creative: model };
  },

  analyze: async (id: string, _feedback?: string): Promise<{ jobId: string }> => {
    setTimeout(async () => {
      await mockPb.collection('projects').update(id, {
        status: 'STEP_2_CONCEPT_REVIEW',
        reformulated_concept:
          'Concept analysé (Mock) : Une histoire prenante au cœur d\'un monde mystérieux où chaque décision a des conséquences imprévisibles.',
        style_matrix: {
          tone: 'Atmosphérique et immersif',
          pacing: 'Progressif',
          vocabulary_level: 'Soutenu',
          narrative_pov: 'Troisième personne',
          tense: 'Passé simple',
          sentence_structure: 'Variée',
          dialogue_style: 'Naturel',
          stylistic_rules: ['Évoquer la brume'],
          forbidden_tropes: [],
          forbidden_phrases: [],
        },
      });
      window.dispatchEvent(new CustomEvent('mock-project-updated', { detail: { id } }));
    }, 1000);
    return { jobId: 'job-mock-analyze' };
  },

  outline: async (id: string, _userFeedback?: string): Promise<unknown> => {
    setTimeout(async () => {
      await mockPb.collection('projects').update(id, {
        status: 'STEP_3_OUTLINE_REVIEW',
      });
      window.dispatchEvent(new CustomEvent('mock-project-updated', { detail: { id } }));
    }, 1000);
    return { ok: true };
  },

  sample: async (id: string): Promise<{ jobId: string }> => {
    setTimeout(async () => {
      await mockPb.collection('projects').update(id, {
        status: 'STEP_4_SAMPLE_REVIEW',
        sample_text:
          'Extrait généré (Mock) :\n\nLe vent soufflait sur les toits d\'ardoise. Elle serra son carnet contre elle et franchit le seuil.',
      });
      window.dispatchEvent(new CustomEvent('mock-project-updated', { detail: { id } }));
    }, 1500);
    return { jobId: 'job-mock-sample' };
  },

  approveSample: async (id: string): Promise<unknown> => {
    await mockPb.collection('projects').update(id, { status: 'STEP_5_WRITING' });
    window.dispatchEvent(new CustomEvent('mock-project-updated', { detail: { id } }));
    return { ok: true };
  },

  writeAll: async (id: string): Promise<{ jobId: string }> => {
    setTimeout(async () => {
      const chapters = (await mockPb.collection('chapters').getFullList()) as Chapter[];
      const scenes = (await mockPb.collection('scenes').getFullList()) as Scene[];
      for (const chap of chapters.filter((c) => c.project === id && c.status !== 'APPROVED')) {
        const chapScenes = scenes.filter((s) => s.chapter === chap.id);
        if (chapScenes.length === 0) {
          await mockPb.collection('scenes').create({
            chapter: chap.id,
            scene_number: 1,
            beat: chap.brief_summary || 'Scène principale du chapitre',
            target_words: chap.target_words || 1500,
            content: 'Contenu rédigé automatiquement en mode Mock.',
            status: 'APPROVED',
          });
        } else {
          for (const sc of chapScenes) {
            await mockPb.collection('scenes').update(sc.id, {
              content: sc.content || 'Contenu rédigé automatiquement en mode Mock.',
              status: 'APPROVED',
            });
          }
        }
        await mockPb.collection('chapters').update(chap.id, {
          status: 'APPROVED',
          post_writing_summary: chap.post_writing_summary || 'Résumé automatique du chapitre (Mock).',
          stale_reason: '',
        });
        window.dispatchEvent(new CustomEvent('mock-chapter-updated', { detail: { id: chap.id } }));
      }
      await mockPb.collection('projects').update(id, { status: 'COMPLETED' });
      window.dispatchEvent(new CustomEvent('mock-project-updated', { detail: { id } }));
    }, 1500);
    return { jobId: 'job-mock-write-all' };
  },

  estimate: async (_id: string): Promise<BookEstimate> => {
    return MOCK_ESTIMATE;
  },

  report: async (_id: string): Promise<GenerationReport> => {
    return MOCK_REPORT;
  },

  patchStyle: async (id: string, style: unknown): Promise<unknown> => {
    await mockPb.collection('projects').update(id, { style_matrix: style as any });
    return { ok: true };
  },

  patchBible: async (id: string, bible: unknown): Promise<unknown> => {
    await mockPb.collection('projects').update(id, { story_bible: bible as any });
    return { ok: true };
  },

  addChapter: async (projectId: string, title: string): Promise<unknown> => {
    const chapters = (await mockPb.collection('chapters').getFullList()) as Chapter[];
    const count = chapters.filter((c) => c.project === projectId).length;
    const newChap = await mockPb.collection('chapters').create({
      project: projectId,
      chapter_number: count + 1,
      title,
      brief_summary: 'Résumé provisoire du chapitre.',
      target_words: 3000,
      status: 'PLANNED',
    });
    return newChap;
  },

  deleteChapter: async (id: string): Promise<unknown> => {
    await mockPb.collection('chapters').delete(id);
    return { ok: true };
  },

  reorder: async (projectId: string, orderedIds: string[]): Promise<unknown> => {
    const chapters = (await mockPb.collection('chapters').getFullList()) as Chapter[];
    const sorted = chapters.filter((c) => c.project === projectId).sort((a, b) => a.chapter_number - b.chapter_number);
    const queue = [...orderedIds];
    const nextIds = sorted.map((c) => (c.status === 'PENDING' ? (queue.shift() ?? c.id) : c.id));
    for (const [index, chapId] of nextIds.entries()) {
      await mockPb.collection('chapters').update(chapId, { chapter_number: index + 1 });
    }
    return { ok: true };
  },

  planScenes: async (chapterId: string): Promise<unknown> => {
    setTimeout(async () => {
      await mockPb.collection('scenes').create({
        chapter: chapterId,
        scene_number: 1,
        beat: 'Nouvelle scène planifiée',
        target_words: 1500,
        content: '',
        status: 'PENDING',
      });
      await mockPb.collection('chapters').update(chapterId, { status: 'PLANNED' });
      window.dispatchEvent(new CustomEvent('mock-chapter-updated', { detail: { id: chapterId } }));
    }, 1000);
    return { ok: true };
  },

  writeChapter: async (chapterId: string): Promise<{ jobId: string }> => {
    setTimeout(async () => {
      const scenes = (await mockPb.collection('scenes').getFullList()) as Scene[];
      const chapScenes = scenes.filter((s) => s.chapter === chapterId);
      for (const sc of chapScenes) {
        await mockPb.collection('scenes').update(sc.id, {
          content: sc.content || 'Contenu rédigé automatiquement en mode Mock.',
          status: 'REVIEW',
        });
      }
      await mockPb.collection('chapters').update(chapterId, { status: 'REVIEW' });
      window.dispatchEvent(new CustomEvent('mock-chapter-updated', { detail: { id: chapterId } }));
    }, 1500);
    return { jobId: 'job-mock-write' };
  },

  rewriteChapter: async (chapterId: string): Promise<{ jobId: string }> => {
    setTimeout(async () => {
      const scenes = (await mockPb.collection('scenes').getFullList()) as Scene[];
      for (const sc of scenes.filter((s) => s.chapter === chapterId)) {
        await mockPb.collection('scenes').update(sc.id, {
          content: 'Nouvelle version réécrite du chapitre en mode Mock.',
          status: 'REVIEW',
        });
        window.dispatchEvent(new CustomEvent('mock-scene-updated', { detail: { id: sc.id } }));
      }
      await mockPb.collection('chapters').update(chapterId, { status: 'REVIEW' });
      window.dispatchEvent(new CustomEvent('mock-chapter-updated', { detail: { id: chapterId } }));
    }, 1500);
    return { jobId: 'job-mock-rewrite' };
  },

  approveChapter: async (chapterId: string): Promise<unknown> => {
    await mockPb.collection('chapters').update(chapterId, { status: 'APPROVED' });
    window.dispatchEvent(new CustomEvent('mock-chapter-updated', { detail: { id: chapterId } }));
    return { ok: true };
  },

  reopenChapter: async (chapterId: string): Promise<unknown> => {
    await mockPb.collection('chapters').update(chapterId, { status: 'REVIEW' });
    window.dispatchEvent(new CustomEvent('mock-chapter-updated', { detail: { id: chapterId } }));
    return { ok: true };
  },

  refreshMemory: async (chapterId: string): Promise<unknown> => {
    await mockPb.collection('chapters').update(chapterId, {
      status: 'APPROVED',
      post_writing_summary: 'Mémoire recalculée (Mock).',
      stale_reason: '',
    });
    window.dispatchEvent(new CustomEvent('mock-chapter-updated', { detail: { id: chapterId } }));
    return { ok: true };
  },

  ignoreStale: async (chapterId: string): Promise<unknown> => {
    await mockPb.collection('chapters').update(chapterId, { status: 'APPROVED', stale_reason: '' });
    window.dispatchEvent(new CustomEvent('mock-chapter-updated', { detail: { id: chapterId } }));
    return { ok: true };
  },

  regenerateScene: async (sceneId: string, _instructions?: string): Promise<{ jobId: string }> => {
    setTimeout(async () => {
      await mockPb.collection('scenes').update(sceneId, {
        content: 'Nouvelle version de la scène régénérée avec succès (Mock).',
        status: 'REVIEW',
      });
      window.dispatchEvent(new CustomEvent('mock-scene-updated', { detail: { id: sceneId } }));
    }, 1000);
    return { jobId: 'job-mock-regen' };
  },

  cancelJob: async (_id: string, _keepPartial: boolean): Promise<unknown> => {
    return { ok: true };
  },

  acceptChange: async (id: string): Promise<unknown> => {
    await mockPb.collection('pending_changes').update(id, { status: 'ACCEPTED' });
    return { ok: true };
  },

  rejectChange: async (id: string): Promise<unknown> => {
    await mockPb.collection('pending_changes').update(id, { status: 'REJECTED' });
    return { ok: true };
  },

  restoreVersion: async (_id: string): Promise<unknown> => {
    return { ok: true };
  },

  usage: async (): Promise<Usage> => {
    return MOCK_USAGE;
  },

  acceptTerms: async (): Promise<unknown> => {
    return { ok: true };
  },

  exportBook: async (_id: string, format: 'md' | 'docx' | 'epub', _aiNotice: boolean): Promise<void> => {
    const blob = new Blob([`# Manuscrit Exporté (Mock)\n\nCeci est un document exporté au format ${format}.`], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `livre_demo.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  },
};
