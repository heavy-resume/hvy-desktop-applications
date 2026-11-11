import { randomBetween, type Clock, type Random } from './clock';
import type { AutomationEmit } from './events';
import type { BrowserHost } from './host';
import { COLLECTION_WORKER_LIMIT_BOUNDS, DEFAULT_COLLECTION_WORKER_LIMITS, type CollectionWorkerLimits } from './settings';

export interface SchedulerOptions {
  host: BrowserHost;
  clock: Clock;
  random: Random;
  emit: AutomationEmit;
  /**
   * Collection workers at once: on one site (origin) per profile, whose loads there still take turns, and in all; and
   * calls a profile's API worker makes at once, all to one site (its page sends them side by side). Read when a job is
   * placed, so a change in App Settings applies to the next one.
   */
  collectionLimits?: () => CollectionWorkerLimits;
  maxCollectionWorkersPerProfile?: number;
  idleTimeoutMs?: number;
  navigationDelayMs?: { min: number; max: number };
  /**
   * Multiplies the delays between page loads: 1 in production. Development can shorten them (0.25 waits a quarter as
   * long) while the log still says how long each delay would be at full pacing.
   */
  navigationDelayScale?: number;
}

export interface JobRequest {
  profileId: string;
  kind: 'collection' | 'api';
  /**
   * The site a job works on. A collection job counts toward that site's worker limit for its profile while it runs; API
   * jobs share their worker only with others on the same site (its page is there).
   */
  origin?: string;
  label: string;
  /** What makes two jobs the same call, told apart from two calls of one kind (the label): the label by default. */
  identity?: string;
  interactive?: boolean;
  signal?: AbortSignal;
}

export interface WorkerLease {
  workerId: string;
  profileId: string;
  /**
   * Loads something from the URL's site (a navigation, or a command that loads the next page): waits for the site's
   * turn, so loads there never overlap however many workers are on it, then a random delay since the last load there
   * finished, then runs `load`. `delay: false` skips the random delay (not the turn): a load the user asked for just
   * now, as a person's click would be, such as site setup opening the item picked. It still counts as the site's last
   * load, so the next load there waits after it. A range instead of the usual delay is a pause of its own, such as
   * the shorter one between items opened from a list a person is clicking through.
   */
  paced<T>(url: string, load: () => Promise<T>, options?: { delay?: false | { min: number; max: number } }): Promise<T>;
}

export interface SchedulerState {
  /** Each worker and the jobs it runs now: one at a time for a collection worker, several for an API worker. */
  workers: Array<{ workerId: string; profileId: string; kind: 'collection' | 'api'; busy: boolean; jobs: Array<{ label: string; identity: string }> }>;
  waitingJobs: Array<{ profileId: string; kind: 'collection' | 'api'; label: string; identity: string }>;
}

interface WorkerRecord {
  id: string;
  profileId: string;
  kind: 'collection' | 'api';
  /** Running a job now (an API worker, one or more). */
  busy: boolean;
  jobs: JobRequest[];
  /** An API worker's site while it runs jobs. */
  origin: string | null;
  site: string | null;
  /** The site its page was left on, by its last job: a collection job there takes this worker first, its page still warm. */
  at: string | null;
  creating: Promise<string> | null;
  idle: AbortController | null;
}

interface PendingJob {
  request: JobRequest;
  sequence: number;
  run(record: WorkerRecord): Promise<void>;
  reject(error: unknown): void;
}

export class WorkerScheduler {
  private readonly options: Required<Omit<SchedulerOptions, 'host' | 'clock' | 'random' | 'emit'>> & Pick<SchedulerOptions, 'host' | 'clock' | 'random' | 'emit'>;
  private readonly workers: WorkerRecord[] = [];
  private readonly pending: PendingJob[] = [];
  /** Collection workers on each site, by profile and origin. */
  private readonly siteWorkers = new Map<string, number>();
  /** When the last load from each site finished, by profile and origin. */
  private readonly lastLoad = new Map<string, number>();
  /** Each site's turn: the load there now, and those waiting behind it, by profile and origin. */
  private readonly siteTurns = new Map<string, Promise<void>>();
  private sequence = 0;

  constructor(options: SchedulerOptions) {
    this.options = {
      collectionLimits: () => DEFAULT_COLLECTION_WORKER_LIMITS,
      maxCollectionWorkersPerProfile: COLLECTION_WORKER_LIMIT_BOUNDS.total,
      idleTimeoutMs: 120_000,
      navigationDelayMs: { min: 1_500, max: 4_500 },
      navigationDelayScale: 1,
      ...options,
    };
  }

  run<T>(request: JobRequest, task: (lease: WorkerLease) => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (request.signal?.aborted) {
        reject(request.signal.reason);
        return;
      }
      const job: PendingJob = {
        request,
        sequence: this.sequence++,
        reject,
        run: async (record) => {
          try {
            resolve(await task(this.lease(record)));
          } catch (error) {
            reject(error);
          }
        },
      };
      request.signal?.addEventListener('abort', () => {
        const index = this.pending.indexOf(job);
        if (index >= 0) {
          this.pending.splice(index, 1);
          reject(request.signal!.reason);
        }
      }, { once: true });
      this.pending.push(job);
      if (!this.acquireNow(job)) this.options.emit('scheduler', `waiting: ${request.label}`, { profileId: request.profileId });
    });
  }

  getState(): SchedulerState {
    return {
      workers: this.workers.map((worker) => ({
        workerId: worker.id,
        profileId: worker.profileId,
        kind: worker.kind,
        busy: worker.busy,
        jobs: worker.jobs.map((request) => ({ label: request.label, identity: identityOf(request) })),
      })),
      waitingJobs: this.pending.map((job) => ({ profileId: job.request.profileId, kind: job.request.kind, label: job.request.label, identity: identityOf(job.request) })),
    };
  }

  private lease(record: WorkerRecord): WorkerLease {
    return {
      workerId: record.id,
      profileId: record.profileId,
      paced: async (url, load, options) => {
        const key = `${record.profileId}\0${new URL(url).origin}`;
        // The site's turn comes after whatever load is there now.
        const previous = this.siteTurns.get(key) ?? Promise.resolve();
        let finished = () => {};
        const turn = previous.then(() => new Promise<void>((resolve) => {
          finished = resolve;
        }));
        this.siteTurns.set(key, turn);
        await previous;
        const last = this.lastLoad.get(key);
        if (last !== undefined && options?.delay !== false) {
          const { min, max } = options?.delay ?? this.options.navigationDelayMs;
          const scale = this.options.navigationDelayScale;
          const full = randomBetween(this.options.random, min, max);
          const wait = last + full * scale - this.options.clock.now();
          if (wait > 0) {
            const atFullPacing = scale === 1 ? '' : ` (${(full / 1000).toFixed(1)}s at full pacing)`;
            this.options.emit('scheduler', `delay ${(wait / 1000).toFixed(1)}s before ${new URL(url).host}${atFullPacing}`, { workerId: record.id });
            await this.options.clock.sleep(wait);
          }
        }
        try {
          return await load();
        } finally {
          this.lastLoad.set(key, this.options.clock.now());
          finished();
          if (this.siteTurns.get(key) === turn) this.siteTurns.delete(key);
        }
      },
    };
  }

  private acquireNow(job: PendingJob): boolean {
    const started = this.dispatch();
    return started.includes(job);
  }

  private dispatch(): PendingJob[] {
    const ordered = [...this.pending].sort((left, right) => (
      Number(Boolean(right.request.interactive)) - Number(Boolean(left.request.interactive)) || left.sequence - right.sequence
    ));
    const started: PendingJob[] = [];
    for (const job of ordered) {
      const record = this.acquire(job.request);
      if (!record) continue;
      this.pending.splice(this.pending.indexOf(job), 1);
      started.push(job);
      void this.start(job, record);
    }
    return started;
  }

  private acquire(request: JobRequest): WorkerRecord | null {
    if (request.kind === 'api') {
      // One page per profile for its API calls: they share it while they go to one site, up to the limit.
      const existing = this.workers.find((worker) => worker.profileId === request.profileId && worker.kind === 'api');
      if (!existing) return this.claim(this.create(request.profileId, 'api'), request);
      if (!existing.busy) return this.claim(existing, request);
      return existing.origin === (request.origin ?? null) && existing.jobs.length < this.options.collectionLimits().apiCalls ? this.claim(existing, request) : null;
    }
    const limits = this.options.collectionLimits();
    const site = request.origin ? `${request.profileId}\0${request.origin}` : null;
    // What the user just asked for doesn't wait behind runs for the site's or Settings' worker limits: a run holds its
    // site's worker for every page it reads there. It still takes its turn among the site's loads, and stays within
    // the profile's own cap.
    const interactive = Boolean(request.interactive);
    if (!interactive && site && (this.siteWorkers.get(site) ?? 0) >= limits.perSite) return null;
    const idle = this.workers
      .filter((worker) => worker.profileId === request.profileId && worker.kind === 'collection' && !worker.busy)
      .sort((a, b) => Number(b.at === (request.origin ?? null)) - Number(a.at === (request.origin ?? null)))[0];
    if (idle) return this.claim(idle, request, site);
    const collectionWorkers = this.workers.filter((worker) => worker.kind === 'collection');
    const profileWorkers = collectionWorkers.filter((worker) => worker.profileId === request.profileId);
    if (profileWorkers.length >= this.options.maxCollectionWorkersPerProfile) return null;
    if (!interactive && collectionWorkers.length >= limits.total) return null;
    return this.claim(this.create(request.profileId, 'collection'), request, site);
  }

  private create(profileId: string, kind: WorkerRecord['kind']): WorkerRecord {
    const record: WorkerRecord = {
      id: '',
      profileId,
      kind,
      busy: false,
      jobs: [],
      origin: null,
      site: null,
      at: null,
      creating: this.options.host.createWorker(profileId),
      idle: null,
    };
    this.workers.push(record);
    return record;
  }

  private claim(record: WorkerRecord, request: JobRequest, site: string | null = null): WorkerRecord {
    record.busy = true;
    record.jobs.push(request);
    record.origin = request.origin ?? null;
    record.at = request.origin ?? null;
    record.idle?.abort();
    record.idle = null;
    if (site) {
      this.siteWorkers.set(site, (this.siteWorkers.get(site) ?? 0) + 1);
      record.site = site;
    }
    return record;
  }

  private async start(job: PendingJob, record: WorkerRecord): Promise<void> {
    try {
      if (record.creating) {
        // API jobs sharing a worker still being made wait for it together; the first to have it says so.
        const creating = record.creating;
        record.id = await creating;
        if (record.creating === creating) {
          record.creating = null;
          this.options.emit('scheduler', `worker created (${record.kind})`, { workerId: record.id, profileId: record.profileId });
        }
      }
    } catch (error) {
      if (this.workers.includes(record)) this.workers.splice(this.workers.indexOf(record), 1);
      this.release(record, job.request);
      job.reject(error);
      return;
    }
    this.options.emit('scheduler', `start: ${job.request.label}`, { workerId: record.id });
    await job.run(record);
    this.options.emit('scheduler', `finish: ${job.request.label}`, { workerId: record.id });
    this.release(record, job.request);
  }

  private release(record: WorkerRecord, request: JobRequest): void {
    record.jobs.splice(record.jobs.indexOf(request), 1);
    if (record.jobs.length) {
      this.dispatch();
      return;
    }
    record.busy = false;
    record.origin = null;
    if (record.site) {
      const workers = (this.siteWorkers.get(record.site) ?? 1) - 1;
      if (workers) this.siteWorkers.set(record.site, workers);
      else this.siteWorkers.delete(record.site);
      record.site = null;
    }
    if (this.workers.includes(record)) this.scheduleIdleClose(record);
    this.dispatch();
  }

  private scheduleIdleClose(record: WorkerRecord): void {
    const controller = new AbortController();
    record.idle = controller;
    this.options.clock.sleep(this.options.idleTimeoutMs, controller.signal).then(async () => {
      if (record.busy || record.idle !== controller) return;
      this.workers.splice(this.workers.indexOf(record), 1);
      await this.options.host.closeWorker(record.id);
      this.options.emit('scheduler', 'worker closed (idle)', { workerId: record.id });
      this.dispatch();
    }).catch(() => undefined);
  }
}

function identityOf(request: JobRequest): string {
  return request.identity ?? request.label;
}
