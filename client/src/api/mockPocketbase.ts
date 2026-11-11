import {
  MOCK_CHAPTERS,
  MOCK_CHANGES,
  MOCK_JOBS,
  MOCK_PROJECTS,
  MOCK_SCENES,
  MOCK_USER,
} from './mockData';
import type { Chapter, Job, PendingChange, Project, Scene } from '@/lib/types';

const STORAGE_PREFIX = 'scribator_mock_db_';

function load<T>(key: string, fallback: T[]): T[] {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T[];
  } catch {
    return fallback;
  }
}

function save<T>(key: string, data: T[]): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(data));
  } catch {
    // ignore
  }
}

class MockAuthStore {
  private _valid = true;
  private _listeners = new Set<() => void>();
  record = MOCK_USER;
  token = MOCK_USER.token;

  get isValid(): boolean {
    return this._valid;
  }

  set isValid(val: boolean) {
    this._valid = val;
    this.notify();
  }

  onChange(callback: () => void) {
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  }

  private notify() {
    this._listeners.forEach((l) => l());
  }

  clear() {
    this.token = '';
    this._valid = false;
    this.notify();
  }

  login() {
    this.record = MOCK_USER;
    this.token = MOCK_USER.token;
    this._valid = true;
    this.notify();
  }
}

export const mockAuthStore = new MockAuthStore();

export class MockCollection<T extends { id: string }> {
  constructor(private name: string, private defaultData: T[]) {}

  private get items(): T[] {
    return load(this.name, this.defaultData);
  }

  private set items(data: T[]) {
    save(this.name, data);
  }

  async getFullList<R = T>(options?: { sort?: string; filter?: string; fields?: string }): Promise<R[]> {
    let list = [...this.items];
    if (options?.filter) {
      const m = options.filter.match(/(\w+)\s*=\s*['"]?([^'"]+)['"]?/);
      if (m) {
        const [, field, val] = m;
        list = list.filter((item) => String((item as Record<string, unknown>)[field]) === val);
      }
    }
    return list as unknown as R[];
  }

  async getList<R = T>(page = 1, perPage = 20, options?: { filter?: string; sort?: string }): Promise<{ items: R[]; totalItems: number }> {
    const all = await this.getFullList<R>(options);
    const start = (page - 1) * perPage;
    return {
      items: all.slice(start, start + perPage),
      totalItems: all.length,
    };
  }

  async getOne<R = T>(id: string): Promise<R> {
    const found = this.items.find((x) => x.id === id);
    if (!found) throw new Error(`Not found: ${id}`);
    return found as unknown as R;
  }

  async create<R = T>(data: Record<string, unknown>): Promise<R> {
    const newItem = {
      id: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      updated: new Date().toISOString(),
      created: new Date().toISOString(),
      status: 'STEP_1_INPUT',
      ...data,
    } as unknown as T;
    this.items = [newItem, ...this.items];
    return newItem as unknown as R;
  }

  async update<R = T>(id: string, data: Record<string, unknown>): Promise<R> {
    const current = this.items;
    const index = current.findIndex((x) => x.id === id);
    if (index === -1) throw new Error(`Not found: ${id}`);
    const updated = {
      ...current[index],
      ...data,
      updated: new Date().toISOString(),
    };
    current[index] = updated;
    this.items = [...current];
    return updated as unknown as R;
  }

  async delete(id: string): Promise<boolean> {
    this.items = this.items.filter((x) => x.id !== id);
    return true;
  }

  async authWithPassword(_email: string, _pwd: string): Promise<{ record: typeof MOCK_USER; token: string }> {
    mockAuthStore.login();
    return { record: MOCK_USER, token: MOCK_USER.token };
  }

  async authRefresh(): Promise<{ record: typeof MOCK_USER; token: string }> {
    return { record: MOCK_USER, token: MOCK_USER.token };
  }

  subscribe(_topic: string, _callback: (data: unknown) => void): () => void {
    return () => {};
  }
}

export const mockPb = {
  authStore: mockAuthStore,
  filter(template: string, params: Record<string, unknown>) {
    let res = template;
    for (const [k, v] of Object.entries(params)) {
      res = res.replaceAll(`{: ${k}}`, String(v)).replaceAll(`{:${k}}`, String(v));
    }
    return res;
  },
  collection(name: string): MockCollection<any> {
    switch (name) {
      case 'projects':
        return new MockCollection<Project>('projects', MOCK_PROJECTS);
      case 'chapters':
        return new MockCollection<Chapter>('chapters', MOCK_CHAPTERS);
      case 'scenes':
        return new MockCollection<Scene>('scenes', MOCK_SCENES);
      case 'pending_changes':
        return new MockCollection<PendingChange>('pending_changes', MOCK_CHANGES);
      case 'generation_jobs':
        return new MockCollection<Job>('generation_jobs', MOCK_JOBS);
      case 'users':
        return new MockCollection<{ id: string; email: string }>('users', [MOCK_USER]);
      default:
        return new MockCollection(name, []);
    }
  },
};
