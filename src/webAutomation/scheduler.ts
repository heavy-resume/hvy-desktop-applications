import { randomBetween, type Clock, type Random } from './clock';
import type { AutomationEmit } from './events';
import type { BrowserHost } from './host';

export interface SchedulerOptions {
  host: BrowserHost;
  clock: Clock;
  random: Random;
  emit: AutomationEmit;
  maxCollectionWorkersPerProfile?: number;
  maxCollectionWorkersGlobal?: number;
  idleTimeoutMs?: number;
  navigationDelayMs?: { min: number; max: number };
}

export interface JobRequest {
  profileId: string;
  kind: 'collection' | 'api';
  /** Collection jobs hold this origin exclusively for their profile while they run. */
  origin?: string;
  label: string;
  interactive?: boolean;
  signal?: AbortSignal;
}

export interface WorkerLease {
  workerId: string;
  profileId: string;
  /** Waits a random delay since the profile's last navigation to the URL's origin. */
  pace(url: string): Promise<void>;
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
  lockedOrigin: string | null;
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
  private readonly lockedOrigins = new Set<string>();
  private readonly lastNavigation = new Map<string, number>();
  private sequence = 0;

  constructor(options: SchedulerOptions) {
    this.options = {
      maxCollectionWorkersPerProfile: 2,
      maxCollectionWorkersGlobal: 4,
      idleTimeoutMs: 120_000,
      navigationDelayMs: { min: 1_500, max: 4_500 },
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
      pace: async (url) => {
        const key = `${record.profileId}\0${new URL(url).origin}`;
        const last = this.lastNavigation.get(key);
        if (last !== undefined) {
          const { min, max } = this.options.navigationDelayMs;
          const waitUntil = last + randomBetween(this.options.random, min, max);
          const wait = waitUntil - this.options.clock.now();
          if (wait > 0) {
            this.options.emit('scheduler', `delay ${(wait / 1000).toFixed(1)}s before ${new URL(url).host}`, { workerId: record.id });
            await this.options.clock.sleep(wait);
          }
        }
        this.lastNavigation.set(key, this.options.clock.now());
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
    const originKey = request.origin ? `${request.profileId}\0${request.origin}` : null;
    if (originKey && this.lockedOrigins.has(originKey)) return null;
    const idle = this.workers.find((worker) => worker.profileId === request.profileId && worker.kind === 'collection' && !worker.busy);
    if (idle) return this.claim(idle, request, originKey);
    const collectionWorkers = this.workers.filter((worker) => worker.kind === 'collection');
    const profileWorkers = collectionWorkers.filter((worker) => worker.profileId === request.profileId);
    if (profileWorkers.length >= this.options.maxCollectionWorkersPerProfile) return null;
    if (collectionWorkers.length >= this.options.maxCollectionWorkersGlobal) return null;
    return this.claim(this.create(request.profileId, 'collection'), request, originKey);
  }

  private create(profileId: string, kind: WorkerRecord['kind']): WorkerRecord {
    const record: WorkerRecord = {
      id: '',
      profileId,
      kind,
      busy: false,
      label: null,
      lockedOrigin: null,
      creating: this.options.host.createWorker(profileId),
      idle: null,
    };
    this.workers.push(record);
    return record;
  }

  private claim(record: WorkerRecord, request: JobRequest, originKey: string | null = null): WorkerRecord {
    record.busy = true;
    record.label = request.label;
    record.idle?.abort();
    record.idle = null;
    if (originKey) {
      this.lockedOrigins.add(originKey);
      record.lockedOrigin = originKey;
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
    if (record.lockedOrigin) {
      this.lockedOrigins.delete(record.lockedOrigin);
      record.lockedOrigin = null;
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
