import { randomBetween, type Clock, type Random } from './clock';
import type { AutomationEmit } from './events';
import type { BrowserHost } from './host';

export interface SchedulerOptions {
  host: BrowserHost;
  clock: Clock;
  random: Random;
  emit: AutomationEmit;
  /** Collection workers on one site (origin) at once, per profile. Their loads there still take turns. */
  maxCollectionWorkersPerSite?: number;
  maxCollectionWorkersPerProfile?: number;
  maxCollectionWorkersGlobal?: number;
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
  /** The site a collection job works on: it counts toward that site's worker limit for its profile while it runs. */
  origin?: string;
  label: string;
  interactive?: boolean;
  signal?: AbortSignal;
}

export interface WorkerLease {
  workerId: string;
  profileId: string;
  /**
   * Loads something from the URL's site (a navigation, or a command that loads the next page): waits for the site's
   * turn, so loads there never overlap however many workers are on it, then a random delay since the last load there
   * finished, then runs `load`.
   */
  paced<T>(url: string, load: () => Promise<T>): Promise<T>;
}

export interface SchedulerState {
  workers: Array<{ workerId: string; profileId: string; kind: 'collection' | 'api'; busy: boolean; label: string | null }>;
  waitingJobs: Array<{ profileId: string; kind: 'collection' | 'api'; label: string }>;
}

interface WorkerRecord {
  id: string;
  profileId: string;
  kind: 'collection' | 'api';
  busy: boolean;
  label: string | null;
  site: string | null;
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
      maxCollectionWorkersPerSite: 2,
      maxCollectionWorkersPerProfile: 4,
      maxCollectionWorkersGlobal: 4,
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
        label: worker.label,
      })),
      waitingJobs: this.pending.map((job) => ({ profileId: job.request.profileId, kind: job.request.kind, label: job.request.label })),
    };
  }

  private lease(record: WorkerRecord): WorkerLease {
    return {
      workerId: record.id,
      profileId: record.profileId,
      paced: async (url, load) => {
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
        if (last !== undefined) {
          const { min, max } = this.options.navigationDelayMs;
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
      const existing = this.workers.find((worker) => worker.profileId === request.profileId && worker.kind === 'api');
      if (existing) return existing.busy ? null : this.claim(existing, request);
      return this.claim(this.create(request.profileId, 'api'), request);
    }
    const site = request.origin ? `${request.profileId}\0${request.origin}` : null;
    if (site && (this.siteWorkers.get(site) ?? 0) >= this.options.maxCollectionWorkersPerSite) return null;
    const idle = this.workers.find((worker) => worker.profileId === request.profileId && worker.kind === 'collection' && !worker.busy);
    if (idle) return this.claim(idle, request, site);
    const collectionWorkers = this.workers.filter((worker) => worker.kind === 'collection');
    const profileWorkers = collectionWorkers.filter((worker) => worker.profileId === request.profileId);
    if (profileWorkers.length >= this.options.maxCollectionWorkersPerProfile) return null;
    if (collectionWorkers.length >= this.options.maxCollectionWorkersGlobal) return null;
    return this.claim(this.create(request.profileId, 'collection'), request, site);
  }

  private create(profileId: string, kind: WorkerRecord['kind']): WorkerRecord {
    const record: WorkerRecord = {
      id: '',
      profileId,
      kind,
      busy: false,
      label: null,
      site: null,
      creating: this.options.host.createWorker(profileId),
      idle: null,
    };
    this.workers.push(record);
    return record;
  }

  private claim(record: WorkerRecord, request: JobRequest, site: string | null = null): WorkerRecord {
    record.busy = true;
    record.label = request.label;
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
        record.id = await record.creating;
        record.creating = null;
        this.options.emit('scheduler', `worker created (${record.kind})`, { workerId: record.id, profileId: record.profileId });
      } else {
        await this.options.host.resetWorker(record.id);
      }
    } catch (error) {
      this.workers.splice(this.workers.indexOf(record), 1);
      this.release(record);
      job.reject(error);
      return;
    }
    this.options.emit('scheduler', `start: ${job.request.label}`, { workerId: record.id });
    await job.run(record);
    this.options.emit('scheduler', `finish: ${job.request.label}`, { workerId: record.id });
    this.release(record);
  }

  private release(record: WorkerRecord): void {
    record.busy = false;
    record.label = null;
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
