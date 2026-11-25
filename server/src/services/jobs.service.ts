import OpenAI from 'openai';
import type PocketBase from 'pocketbase';
import type { Env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import type { ProjectLocks } from '../middlewares/projectLock.js';
import type { ChapterRecord, JobRecord, SceneRecord } from '../types.js';
import { isAbortError, type CallContext, type Logger } from './llm.service.js';
import { ProgressTracker, type StageEstimates, type StageKey, type StepPlace } from './progress.js';

export interface ActiveJob {
  controller: AbortController;
  keepPartial: boolean;
  timedOut: boolean;
  /** Arrêt du serveur : le job est interrompu, pas annulé par l'auteur. */
  shuttingDown: boolean;
  /** Résolue quand le job a fini de se ranger (statut écrit, verrou relâché). */
  settled: Promise<void>;
}

export interface JobHandle {
  id: string;
  signal: AbortSignal;
  active: ActiveJob;
  ctx: CallContext;
  stages(stages: Array<{ key: StageKey; total: number }>, estimates: StageEstimates): Promise<void>;
  setStageTotal(key: StageKey, total: number): Promise<void>;
  step<T>(key: StageKey, place: StepPlace, fn: () => Promise<T>): Promise<T>;
  assertNotCancelled(): void;
}

class JobCancelled extends Error {
  override name = 'AbortError';
}

export function humanMessage(e: unknown): string {
  if (e instanceof AppError) return e.message;
  if (e instanceof OpenAI.RateLimitError) return "Le service d'IA est saturé. Réessaie dans quelques minutes.";
  if (e instanceof OpenAI.AuthenticationError) return "Le service d'IA est mal configuré. Préviens l'administrateur.";
  if (e instanceof OpenAI.APIConnectionError) return "Le service d'IA est injoignable. Réessaie dans un instant.";
  if (e instanceof OpenAI.NotFoundError && /data policy/i.test(e.message)) {
    return "Ce modèle n'est pas accessible avec les réglages de confidentialité actuels : il exige souvent d'autoriser l'entraînement sur tes textes. Choisis un autre modèle, ou modifie ces réglages sur openrouter.ai/settings/privacy.";
  }
  if (e instanceof OpenAI.NotFoundError) return "Ce modèle n'est pas disponible pour le moment. Choisis-en un autre dans les paramètres du livre.";
  if (e instanceof OpenAI.APIError && e.status === 402) return "Le crédit du service d'IA est épuisé. Préviens l'administrateur.";
  if (e instanceof OpenAI.APIError) return "Le service d'IA a renvoyé une erreur. Réessaie dans un instant.";
  return 'La génération a échoué à cause d\'une erreur inattendue.';
}

const nowIso = () => new Date().toISOString().replace('T', ' ');

export const SHUTDOWN_MESSAGE = 'Serveur arrêté pendant la génération. Relance-la : le travail déjà fait est conservé.';

export class JobsService {
  readonly activeJobs = new Map<string, ActiveJob>();
  private watchdog: NodeJS.Timeout | undefined;

  constructor(
    private readonly pb: PocketBase,
    private readonly env: Env,
    private readonly locks: ProjectLocks,
    private readonly log: Logger,
  ) {}

  /** Le verrou du projet doit être acquis avant l'appel : il est relâché ici, à la fin du job. */
  async launch(input: {
    userId: string;
    projectId: string;
    kind: JobRecord['kind'];
    targetId: string;
    requestId: string;
    logger: Logger;
    run: (job: JobHandle) => Promise<void>;
    onSettled?: (outcome: 'DONE' | 'CANCELLED' | 'FAILED') => Promise<void>;
  }): Promise<string> {
    let record: JobRecord;
    try {
      record = await this.pb.collection('generation_jobs').create<JobRecord>({
        user: input.userId,
        project: input.projectId,
        kind: input.kind,
        target_id: input.targetId,
        status: 'RUNNING',
        cancel_requested: false,
        started_at: nowIso(),
      });
    } catch (e) {
      this.locks.release(input.projectId);
      throw e;
    }
    let markSettled!: () => void;
    const active: ActiveJob = {
      controller: new AbortController(),
      keepPartial: false,
      timedOut: false,
      shuttingDown: false,
      settled: new Promise<void>((resolve) => (markSettled = resolve)),
    };
    this.activeJobs.set(record.id, active);
    // Une progression non enregistrée ne doit pas faire perdre un texte déjà payé.
    const tracker = new ProgressTracker((progress) =>
      this.pb.collection('generation_jobs').update(record.id, { progress }).then(
        () => undefined,
        (e: unknown) => input.logger.warn({ err: e, job_id: record.id }, "échec d'écriture de la progression"),
      ),
    );
    const handle: JobHandle = {
      id: record.id,
      signal: active.controller.signal,
      active,
      ctx: {
        userId: input.userId,
        projectId: input.projectId,
        jobId: record.id,
        requestId: input.requestId,
        log: input.logger,
      },
      stages: (stages, estimates) => tracker.define(stages, estimates),
      setStageTotal: (key, total) => tracker.setTotal(key, total),
      step: (key, place, fn) => tracker.step(key, place, fn),
      assertNotCancelled: () => {
        if (active.controller.signal.aborted) throw new JobCancelled();
      },
    };
    void this.execute(input, record.id, handle).finally(markSettled);
    return record.id;
  }

  private async execute(
    input: { projectId: string; kind: string; logger: Logger; run: (j: JobHandle) => Promise<void>; onSettled?: (o: 'DONE' | 'CANCELLED' | 'FAILED') => Promise<void> },
    jobId: string,
    handle: JobHandle,
  ): Promise<void> {
    const log = input.logger;
    log.info({ job_id: jobId, kind: input.kind }, 'début du job');
    const started = Date.now();
    let status: 'DONE' | 'CANCELLED' | 'FAILED' = 'DONE';
    let error = '';
    try {
      await input.run(handle);
    } catch (e) {
      if (handle.active.timedOut) {
        status = 'FAILED';
        error = `Génération interrompue : délai de ${this.env.JOB_TIMEOUT_MINUTES} minutes dépassé.`;
      } else if (handle.active.shuttingDown) {
        status = 'FAILED';
        error = SHUTDOWN_MESSAGE;
      } else if (isAbortError(e)) {
        status = 'CANCELLED';
      } else {
        status = 'FAILED';
        error = humanMessage(e);
        log.error({ err: e, job_id: jobId }, 'échec du job');
      }
    }
    try {
      await input.onSettled?.(status);
    } catch (e) {
      log.error({ err: e, job_id: jobId }, 'échec de la finalisation du job');
    }
    await this.pb
      .collection('generation_jobs')
      .update(jobId, { status, error_message: error, finished_at: nowIso(), duration_ms: Date.now() - started })
      .catch((e: unknown) => log.error({ err: e, job_id: jobId }, 'échec de mise à jour du job'));
    this.activeJobs.delete(jobId);
    this.locks.release(input.projectId);
    log.info({ job_id: jobId, status }, 'fin du job');
  }

  async cancel(jobId: string, keepPartial: boolean): Promise<void> {
    await this.pb.collection('generation_jobs').update(jobId, { cancel_requested: true });
    const active = this.activeJobs.get(jobId);
    if (!active) return;
    active.keepPartial = keepPartial;
    active.controller.abort();
  }

  /**
   * Arrêt du serveur (redéploiement) : les jobs en cours sont coupés et rangés comme une erreur, pour
   * que l'auteur voie un message clair et que rien ne reste en `RUNNING`. Au-delà du délai, le
   * nettoyage au redémarrage prend le relais.
   */
  async shutdown(timeoutMs = 10_000): Promise<void> {
    this.stopWatchdog();
    const running = [...this.activeJobs.values()];
    if (running.length === 0) return;
    this.log.warn({ count: running.length }, 'arrêt du serveur, jobs en cours interrompus');
    for (const active of running) {
      active.shuttingDown = true;
      active.controller.abort();
    }
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), timeoutMs)));
    const outcome = await Promise.race([Promise.all(running.map((a) => a.settled)), timeout]);
    clearTimeout(timer);
    if (outcome === 'timeout') this.log.warn({}, "jobs non rangés à temps, le redémarrage s'en chargera");
  }

  /** §6 : après un crash, rien ne doit rester en cours. Les filtres couvrent aussi un état sans job. */
  async recoverOnStartup(): Promise<void> {
    const jobs = await this.pb.collection('generation_jobs').getFullList<JobRecord>({ filter: 'status = "RUNNING"' });
    for (const job of jobs) await this.failStuckJob(job, 'Serveur redémarré');
    await this.restoreOrphans();
    if (jobs.length) this.log.warn({ count: jobs.length }, 'jobs interrompus par le redémarrage');
  }

  private async failStuckJob(job: JobRecord, reason: string): Promise<void> {
    await this.pb
      .collection('generation_jobs')
      .update(job.id, { status: 'FAILED', error_message: reason, finished_at: nowIso() });
  }

  /**
   * Remet d'aplomb ce qu'un job mort a laissé en cours. Sans `projectId` (démarrage), tout est
   * concerné ; sinon seulement ce projet, car d'autres jobs vivants écrivent peut-être ailleurs.
   */
  private async restoreOrphans(projectId?: string): Promise<void> {
    const pb = this.pb;
    const scope = (filter: string, path: string) =>
      projectId ? pb.filter(`(${filter}) && ${path} = {:p}`, { p: projectId }) : filter;

    const scenes = await pb.collection('scenes').getFullList<SceneRecord>({ filter: scope('status = "GENERATING"', 'chapter.project') });
    for (const s of scenes) {
      await pb.collection('scenes').update(s.id, { draft: '', status: s.content.trim() ? 'REVIEW' : 'PENDING' });
    }
    const leftovers = await pb.collection('scenes').getFullList({ filter: scope('draft != ""', 'chapter.project'), fields: 'id' });
    for (const s of leftovers) await pb.collection('scenes').update(s.id, { draft: '' });

    const chapters = await pb.collection('chapters').getFullList<ChapterRecord>({ filter: scope('status = "GENERATING"', 'project') });
    for (const c of chapters) {
      const list = await pb.collection('scenes').getFullList<SceneRecord>({
        filter: pb.filter('chapter = {:c}', { c: c.id }),
        fields: 'status',
      });
      await pb.collection('chapters').update(c.id, { status: settledChapterStatus(list, 'interrupted') });
    }
  }

  private async sweep(): Promise<void> {
    const limit = new Date(Date.now() - this.env.JOB_TIMEOUT_MINUTES * 60_000).toISOString().replace('T', ' ');
    // Un livre entier dure des heures : son délai porte sur le dernier maillon, pas sur le job.
    const stuck = await this.pb.collection('generation_jobs').getFullList<JobRecord>({
      filter: this.pb.filter(
        'status = "RUNNING" && ((kind != "BOOK" && started_at < {:d}) || (kind = "BOOK" && updated < {:d}))',
        { d: limit },
      ),
    });
    for (const job of stuck) {
      const active = this.activeJobs.get(job.id);
      if (active) {
        // Le job vivant fait lui-même le ménage : coupe le flux puis passe par son chemin d'erreur.
        active.timedOut = true;
        active.controller.abort();
      } else {
        await this.failStuckJob(job, `Délai de ${this.env.JOB_TIMEOUT_MINUTES} minutes dépassé`);
        await this.restoreOrphans(job.project);
        this.locks.release(job.project);
      }
    }
  }

  async purgeOldSnapshots(): Promise<void> {
    const limit = new Date(Date.now() - 30 * 86_400_000).toISOString().replace('T', ' ');
    const old = await this.pb.collection('ai_calls').getFullList({
      filter: this.pb.filter('prompt_snapshot != "" && created < {:d}', { d: limit }),
      fields: 'id',
    });
    for (const row of old) await this.pb.collection('ai_calls').update(row.id, { prompt_snapshot: '' });
  }

  startWatchdog(): void {
    let ticks = 0;
    this.watchdog = setInterval(() => {
      this.sweep().catch((e: unknown) => this.log.error({ err: e }, 'échec du watchdog'));
      if (ticks++ % 1440 === 0) {
        this.purgeOldSnapshots().catch((e: unknown) => this.log.error({ err: e }, 'échec de la purge'));
      }
    }, 60_000);
    this.watchdog.unref();
  }

  stopWatchdog(): void {
    clearInterval(this.watchdog);
  }
}

/** Statut d'un chapitre à la fin d'un job, d'après ses scènes (§5.6). */
export function settledChapterStatus(
  scenes: Pick<SceneRecord, 'status'>[],
  outcome: 'done' | 'cancelled' | 'failed' | 'interrupted',
): ChapterRecord['status'] {
  if (scenes.some((s) => s.status === 'REVIEW')) return 'REVIEW';
  return outcome === 'failed' ? 'ERROR' : 'PLANNED';
}
