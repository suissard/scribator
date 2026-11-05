import { create } from 'zustand';
import { pb } from '@/api/pocketbase';
import type { Chapter, Job, PendingChange, Project, Scene } from '@/lib/types';

export type StepView = 1 | 2 | 3 | 4 | 5 | 6;

interface ProjectState {
  project: Project | null;
  chapters: Chapter[];
  scenes: Scene[];
  changes: PendingChange[];
  activeJob: Job | null;
  lastJobError: string | null;
  activeStepView: StepView;
  activeChapterId: string | null;
  setStep(step: StepView): void;
  setActiveChapter(id: string | null): void;
  setProject(p: Project): void;
  upsertChapter(c: Chapter): void;
  removeChapter(id: string): void;
  upsertScene(s: Scene): void;
  removeScene(id: string): void;
  upsertChange(c: PendingChange): void;
  applyJob(j: Job): void;
  clearJobError(): void;
  load(id: string): Promise<void>;
  loadChapters(): Promise<void>;
  loadScenes(chapterId: string): Promise<void>;
  reset(): void;
}

const byNumber = (a: Chapter, b: Chapter) => a.chapter_number - b.chapter_number;
const bySceneNumber = (a: Scene, b: Scene) => a.scene_number - b.scene_number;

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [...list, item];
  const next = [...list];
  next[i] = item;
  return next;
}

const initial = {
  project: null, chapters: [], scenes: [], changes: [], activeJob: null, lastJobError: null,
  activeStepView: 1 as StepView, activeChapterId: null,
};

export const useProjectStore = create<ProjectState>((set, get) => ({
  ...initial,
  setStep: (activeStepView) => set({ activeStepView }),
  setActiveChapter: (activeChapterId) => set({ activeChapterId, scenes: [] }),
  setProject: (project) => set({ project }),
  upsertChapter: (c) => set((s) => ({ chapters: upsert(s.chapters, c).sort(byNumber) })),
  removeChapter: (id) => set((s) => ({ chapters: s.chapters.filter((c) => c.id !== id) })),
  upsertScene: (scene) => set((s) => ({ scenes: upsert(s.scenes, scene).sort(bySceneNumber) })),
  removeScene: (id) => set((s) => ({ scenes: s.scenes.filter((c) => c.id !== id) })),
  upsertChange: (c) =>
    set((s) => ({ changes: c.status === 'PENDING' ? upsert(s.changes, c) : s.changes.filter((x) => x.id !== c.id) })),
  applyJob: (job) =>
    set((s) => {
      if (job.status === 'RUNNING') return { activeJob: job };
      if (s.activeJob && s.activeJob.id !== job.id) return {};
      return { activeJob: null, lastJobError: job.status === 'FAILED' ? job.error_message || 'La génération a échoué.' : null };
    }),
  clearJobError: () => set({ lastJobError: null }),
  async load(id) {
    const [project, chapters, changes, jobs] = await Promise.all([
      pb.collection('projects').getOne<Project>(id),
      pb.collection('chapters').getFullList<Chapter>({ filter: pb.filter('project = {:id}', { id }), sort: 'chapter_number' }),
      pb.collection('pending_changes').getFullList<PendingChange>({ filter: pb.filter('project = {:id} && status = "PENDING"', { id }), sort: 'created' }),
      pb.collection('generation_jobs').getList<Job>(1, 1, { filter: pb.filter('project = {:id}', { id }), sort: '-created' }),
    ]);
    const latest = jobs.items[0];
    set({
      project, chapters, changes,
      activeJob: latest?.status === 'RUNNING' ? latest : null,
      // Onglet fermé pendant l'analyse : l'échec doit rester visible au retour.
      lastJobError: latest?.status === 'FAILED' && project.status === 'STEP_1_INPUT' ? latest.error_message : null,
    });
  },
  async loadChapters() {
    const id = get().project?.id;
    if (!id) return;
    const chapters = await pb.collection('chapters').getFullList<Chapter>({ filter: pb.filter('project = {:id}', { id }), sort: 'chapter_number' });
    set({ chapters });
  },
  async loadScenes(chapterId) {
    const scenes = await pb.collection('scenes').getFullList<Scene>({ filter: pb.filter('chapter = {:c}', { c: chapterId }), sort: 'scene_number' });
    if (get().activeChapterId === chapterId) set({ scenes });
  },
  reset: () => set(initial),
}));
