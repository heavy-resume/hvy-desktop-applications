import { randomBetween, type Clock, type Random } from './clock';
import { errorCode, errorMessage, errorStatus } from './errors';
import type { AutomationEmit } from './events';

export type QueueEntryStatus = 'queued' | 'running' | 'waiting-retry' | 'done' | 'failed' | 'cancelled';

export interface QueueEntry {
  key: string;
  input: unknown;
  /** Sent with every attempt of this entry, so a retried or interrupted call never creates a second result. */
  idempotencyKey: string;
  status: QueueEntryStatus;
  attempts: number;
  lastError: string | null;
  result: unknown;
  nextAttemptAt: number | null;
  delivered: boolean;
  updatedAt: number;
}

export interface QueueConfig {
  concurrency: number;
  minIntervalMs: number;
  jitterMs: number;
  retry: {
    statuses: number[];
    codes: string[];
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };
}

/** Persisted in the app's queue store, per document and queue; plain JSON. */
export interface QueueState {
  entries: QueueEntry[];
  paused: boolean;
  pauseReason: string | null;
  /** True after the document is reopened until the user resumes; nothing runs unattended. */
  awaitingResume: boolean;
}

export interface QueueResult {
  key: string;
  status: 'done' | 'failed';
  result?: unknown;
  error?: string;
}

export const DEFAULT_QUEUE_CONFIG: QueueConfig = {
  concurrency: 1,
  minIntervalMs: 5_000,
  jitterMs: 3_000,
  retry: { statuses: [429, 502, 503, 504], codes: [], maxAttempts: 4, baseDelayMs: 30_000, maxDelayMs: 600_000 },
};

export type QueueTarget = (input: unknown, context: { idempotencyKey: string }) => Promise<unknown>;

export class DurableQueue {
  private state: QueueState = { entries: [], paused: false, pauseReason: null, awaitingResume: false };
  private handler: ((result: QueueResult) => void) | null = null;
  private lastStartedAt: number | null = null;
  private wake: AbortController | null = null;
  private loops = 0;
  private detached = false;
  private written: Promise<void> = Promise.resolve();
  private target: QueueTarget;

  constructor(private readonly deps: {
    id: string;
    config: QueueConfig;
    clock: Clock;
    random: Random;
    emit: AutomationEmit;
    createId(): string;
    target: QueueTarget;
    /** Persists each change (the app's queue store). A call starts only after its entry is written. */
    onChange?(state: QueueState): void | Promise<void>;
  }) {
    this.target = deps.target;
  }

  getState(): QueueState {
    return structuredClone(this.state);
  }

  /** Restores persisted entries. Interrupted work is re-queued but waits for resume(). */
  restore(state: QueueState): void {
    const entries = state.entries.map((entry) => (entry.status === 'running' ? { ...entry, status: 'queued' as const } : { ...entry }));
    const pending = entries.some((entry) => entry.status === 'queued' || entry.status === 'waiting-retry');
    this.state = { entries, paused: state.paused, pauseReason: state.pauseReason, awaitingResume: pending };
    this.changed();
  }

  enqueue(key: string, input: unknown): { added: boolean } {
    const existing = this.state.entries.find((entry) => entry.key === key);
    if (existing && ['queued', 'running', 'waiting-retry'].includes(existing.status)) return { added: false };
    const entry: QueueEntry = {
      key, input, idempotencyKey: this.deps.createId(), status: 'queued', attempts: 0, lastError: null, result: null, nextAttemptAt: null, delivered: false, updatedAt: this.deps.clock.now(),
    };
    this.state.entries = [...this.state.entries.filter((candidate) => candidate.key !== key), entry];
    this.deps.emit('queue', `${this.deps.id}: enqueued ${key}`);
    this.changed();
    this.pump();
    return { added: true };
  }

  status(key: string): QueueEntry | null {
    const entry = this.state.entries.find((candidate) => candidate.key === key);
    return entry ? structuredClone(entry) : null;
  }

  list(): QueueEntry[] {
    return structuredClone(this.state.entries);
  }

  cancel(key: string): void {
    this.update(key, (entry) => (['queued', 'waiting-retry'].includes(entry.status) ? { ...entry, status: 'cancelled' } : entry));
  }

  retry(key: string): void {
    this.update(key, (entry) => (entry.status === 'failed' ? { ...entry, status: 'queued', attempts: 0, lastError: null, nextAttemptAt: null } : entry));
    this.pump();
  }

  pause(reason = 'paused'): void {
    this.state.paused = true;
    this.state.pauseReason = reason;
    this.deps.emit('queue', `${this.deps.id}: paused (${reason})`);
    this.changed();
  }

  resume(): void {
    this.state.paused = false;
    this.state.pauseReason = null;
    this.state.awaitingResume = false;
    this.deps.emit('queue', `${this.deps.id}: resumed`);
    this.changed();
    this.pump();
  }

  onResult(handler: (result: QueueResult) => void): void {
    this.handler = handler;
    for (const entry of this.state.entries.filter((candidate) => !candidate.delivered && (candidate.status === 'done' || candidate.status === 'failed'))) {
      this.deliver(entry);
    }
  }

  /** True when no entry is queued, running, or waiting to retry, or the queue is paused. */
  isIdle(): boolean {
    return this.state.paused || this.state.awaitingResume
      || !this.state.entries.some((entry) => ['queued', 'running', 'waiting-retry'].includes(entry.status));
  }

  private pump(): void {
    this.wake?.abort();
    while (this.loops < this.deps.config.concurrency) {
      this.loops += 1;
      void this.loop().finally(() => {
        this.loops -= 1;
      });
    }
  }

  /**
   * The document was unloaded: start nothing new. A call already sent still
   * finishes, and its result is kept until the document reopens and a handler
   * is registered again.
   */
  detach(): void {
    this.detached = true;
    this.handler = null;
    this.wake?.abort();
  }

  /** The document reopened: calls go to its target again, after the user resumes. */
  attach(target: QueueTarget): void {
    this.target = target;
    this.detached = false;
    if (this.state.entries.some((entry) => entry.status === 'queued' || entry.status === 'waiting-retry')) {
      this.state.awaitingResume = true;
      this.changed();
    }
  }

  private blocked(): boolean {
    return this.detached || this.state.paused || this.state.awaitingResume;
  }

  private nextEligible(): QueueEntry | null {
    const now = this.deps.clock.now();
    return this.state.entries.find((entry) => entry.status === 'queued'
      || (entry.status === 'waiting-retry' && (entry.nextAttemptAt ?? 0) <= now)) ?? null;
  }

  private async loop(): Promise<void> {
    while (!this.blocked()) {
      const entry = this.nextEligible();
      if (!entry) {
        const retryTimes = this.state.entries.filter((candidate) => candidate.status === 'waiting-retry').map((candidate) => candidate.nextAttemptAt ?? 0);
        if (!retryTimes.length) return;
        this.wake = new AbortController();
        await this.deps.clock.sleep(Math.max(0, Math.min(...retryTimes) - this.deps.clock.now()), this.wake.signal).catch(() => undefined);
        continue;
      }
      if (this.lastStartedAt !== null) {
        const wait = this.lastStartedAt + this.deps.config.minIntervalMs + randomBetween(this.deps.random, 0, this.deps.config.jitterMs) - this.deps.clock.now();
        if (wait > 0) await this.deps.clock.sleep(wait);
        if (this.blocked()) return;
      }
      const current = this.state.entries.find((candidate) => candidate.key === entry.key);
      if (current?.status !== 'queued' && current?.status !== 'waiting-retry') continue;
      await this.attempt(entry.key);
    }
  }

  private async attempt(key: string): Promise<void> {
    const entry = this.update(key, (current) => ({ ...current, status: 'running', attempts: current.attempts + 1, nextAttemptAt: null }));
    if (!entry) return;
    this.lastStartedAt = this.deps.clock.now();
    this.deps.emit('queue', `${this.deps.id}: run ${key} (attempt ${entry.attempts})`);
    try {
      // Write-ahead: the entry and its idempotency key are stored before the call is made.
      await this.written;
      const result = await this.target(entry.input, { idempotencyKey: entry.idempotencyKey });
      const done = this.update(key, (current) => ({ ...current, status: 'done', result, lastError: null }));
      if (done) this.deliver(done);
    } catch (error) {
      const code = errorCode(error);
      const status = errorStatus(error);
      if (code === 'not_authenticated' || code === 'not_authorized') {
        // Needs the user (sign in again, or review the document's access); keep the entry and wait.
        this.update(key, (current) => ({ ...current, status: 'queued', attempts: current.attempts - 1, lastError: errorMessage(error) }));
        this.pause(code);
        return;
      }
      const retry = this.deps.config.retry;
      const retryable = (status !== undefined && retry.statuses.includes(status)) || retry.codes.includes(code);
      if (retryable && entry.attempts < retry.maxAttempts) {
        const delay = Math.min(retry.baseDelayMs * 2 ** (entry.attempts - 1), retry.maxDelayMs) + randomBetween(this.deps.random, 0, this.deps.config.jitterMs);
        this.update(key, (current) => ({ ...current, status: 'waiting-retry', lastError: errorMessage(error), nextAttemptAt: this.deps.clock.now() + delay }));
        this.deps.emit('queue', `${this.deps.id}: retry ${key} in ${(delay / 1000).toFixed(0)}s (${errorMessage(error)})`);
        return;
      }
      const failed = this.update(key, (current) => ({ ...current, status: 'failed', lastError: errorMessage(error) }));
      if (failed) this.deliver(failed);
    }
  }

  private deliver(entry: QueueEntry): void {
    if (!this.handler || (entry.status !== 'done' && entry.status !== 'failed')) return;
    this.update(entry.key, (current) => ({ ...current, delivered: true }));
    this.deps.emit('queue', `${this.deps.id}: ${entry.status} ${entry.key}`);
    this.handler(entry.status === 'done'
      ? { key: entry.key, status: 'done', result: entry.result }
      : { key: entry.key, status: 'failed', error: entry.lastError ?? 'Failed.' });
  }

  private update(key: string, change: (entry: QueueEntry) => QueueEntry): QueueEntry | null {
    let updated: QueueEntry | null = null;
    this.state.entries = this.state.entries.map((entry) => {
      if (entry.key !== key) return entry;
      updated = { ...change(entry), updatedAt: this.deps.clock.now() };
      return updated;
    });
    this.changed();
    return updated;
  }

  private changed(): void {
    const state = this.getState();
    this.written = this.written.then(() => this.deps.onChange?.(state));
  }
}
