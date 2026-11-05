import type PocketBase from 'pocketbase';
import { conflict } from '../lib/errors.js';

const BUSY = "Une génération est déjà en cours sur ce projet. Attends qu'elle se termine.";

/**
 * Verrou unifié (§3.7, §5). Le Set est rempli avant tout `await` : deux requêtes arrivant
 * dans le même tick ne peuvent pas passer toutes les deux.
 */
export class ProjectLocks {
  private readonly active = new Set<string>();

  constructor(private readonly pb: PocketBase) {}

  has(projectId: string): boolean {
    return this.active.has(projectId);
  }

  async acquire(projectId: string): Promise<void> {
    if (this.active.has(projectId)) throw conflict(BUSY);
    this.active.add(projectId);
    try {
      const running = await this.pb.collection('generation_jobs').getList(1, 1, {
        filter: this.pb.filter('project = {:p} && status = "RUNNING"', { p: projectId }),
        fields: 'id',
        skipTotal: true,
      });
      if (running.items.length > 0) throw conflict(BUSY);
    } catch (e) {
      this.active.delete(projectId);
      throw e;
    }
  }

  release(projectId: string): void {
    this.active.delete(projectId);
  }

  async withLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    await this.acquire(projectId);
    try {
      return await fn();
    } finally {
      this.release(projectId);
    }
  }
}
