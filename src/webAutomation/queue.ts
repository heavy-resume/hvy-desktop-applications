import { randomBetween, type Clock, type Random } from './clock';
import { errorAction, errorCode, errorMessage, errorStatus } from './errors';
import type { AutomationEmit } from './events';

export type QueueEntryStatus = 'queued' | 'running' | 'waiting-retry' | 'done' | 'failed' | 'cancelled';

export interface QueueEntry {
  key: string;
  /** What the entry is, for people (a job's title): the queue reader shows it in place of the key. */
  label?: string;
  input: unknown;
  /** The caller's own bookkeeping, such as a status check's poll count: saved with the entry and handed back with its
   * result, never sent to the target. */
  context?: unknown;
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

/** Saved in the document's queue block when the document is saved; plain JSON. */
export interface QueueState {
  entries: QueueEntry[];
  paused: boolean;
  pauseReason: string | null;
  /** What the service said when its response paused the queue (pauseReason "response"), such as that quota ran out. */
  pauseMessage?: string | null;
  /** True after the document is reopened until the user resumes; nothing runs unattended. */
  awaitingResume: boolean;
}

/** An entry that will not run again: its script hears of it through on_result. */
const FINISHED: QueueEntry['status'][] = ['done', 'failed', 'cancelled'];

export interface QueueResult {
  key: string;
  /** The context the entry was enqueued with. */
  context: unknown;
  /** Cancelled: someone took it out of the queue before it ran (or after it failed), so its script can put it back. */
  status: 'done' | 'failed' | 'cancelled';
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
  /** Told as each entry's call starts (`onStart`): what a document shows as being done, rather than waiting. */
  private startHandler: ((started: { key: string; context: unknown }) => void) | null = null;
  private lastStartedAt: number | null = null;
  private wake: AbortController | null = null;
  private loops = 0;
  private detached = false;
  private target: QueueTarget;

  constructor(private readonly deps: {
    id: string;
    config: QueueConfig;
    clock: Clock;
    random: Random;
    emit: AutomationEmit;
    createId(): string;
    target: QueueTarget;
  }) {
    this.target = deps.target;
  }

  getState(): QueueState {
    return structuredClone(this.state);
  }

  /**
   * What the document saves in the queue block: everything except entries
   * that are finished or cancelled and were delivered as such.
   */
  savedState(): QueueState {
    const state = this.getState();
    return {
      ...state,
      entries: state.entries.filter((entry) => !(entry.delivered && FINISHED.includes(entry.status))),
    };
  }

  /** Restores entries saved in the document. Interrupted work is re-queued but waits for resume(). */
  restore(state: QueueState): void {
    const entries = state.entries.map((entry) => (entry.status === 'running' ? { ...entry, status: 'queued' as const } : { ...entry }));
    const pending = entries.some((entry) => entry.status === 'queued' || entry.status === 'waiting-retry');
    this.state = { entries, paused: state.paused, pauseReason: state.pauseReason, pauseMessage: state.pauseMessage ?? null, awaitingResume: pending };
  }

  /**
   * The document was opened again from its file while this queue was still in memory: the queue is what the file
   * saved. A saved entry this queue still holds (same idempotency key) keeps how far it got, such as a call that
   * finished while the file was closed; entries the file never saved go, with the rest of the changes not saved. Its
   * settings are the file's too, as the queue block has them now.
   */
  reopen(saved: QueueState | null, config: QueueConfig): void {
    this.deps.config = config;
    const progressed = new Map(this.state.entries.map((entry) => [entry.idempotencyKey, entry]));
    this.restore(saved ?? { entries: [], paused: false, pauseReason: null, awaitingResume: false });
    this.state.entries = this.state.entries.map((entry) => progressed.get(entry.idempotencyKey) ?? entry);
  }

  /** `delayMs` holds the entry back, such as a status check that backs off while a report is still pending. */
  enqueue(key: string, input: unknown, options: { delayMs?: number; context?: unknown; label?: string } = {}): { added: boolean } {
    const existing = this.state.entries.find((entry) => entry.key === key);
    if (existing && ['queued', 'running', 'waiting-retry'].includes(existing.status)) return { added: false };
    const entry: QueueEntry = {
      ...(options.context === undefined ? {} : { context: options.context }),
      ...(options.label ? { label: options.label } : {}),
      key, input, idempotencyKey: this.deps.createId(), status: 'queued', attempts: 0, lastError: null, result: null, nextAttemptAt: options.delayMs ? this.deps.clock.now() + options.delayMs : null, delivered: false, updatedAt: this.deps.clock.now(),
    };
    this.state.entries = [...this.state.entries.filter((candidate) => candidate.key !== key), entry];
    this.deps.emit('queue', `${this.deps.id}: enqueued ${key}`);
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

  /**
   * Stops the queue's work: every entry waiting its turn (or to retry) is cancelled, and a pause goes with them, as
   * nothing is left to hold. A call already sent finishes, and its result is delivered; failed entries stay, to retry
   * or dismiss.
   */
  stop(): void {
    const waiting = new Set(this.state.entries.filter((entry) => entry.status === 'queued' || entry.status === 'waiting-retry').map((entry) => entry.key));
    // Stopped first, all of it, and then told: whatever a handler does with the news, nothing waiting is left to run.
    for (const key of waiting) this.update(key, (entry) => ({ ...entry, status: 'cancelled', delivered: false }));
    this.state.paused = false;
    this.state.pauseReason = null;
    this.state.pauseMessage = null;
    this.state.awaitingResume = false;
    this.deps.emit('queue', `${this.deps.id}: stopped, ${waiting.size} cancelled`);
    for (const entry of this.state.entries.filter((candidate) => waiting.has(candidate.key))) this.deliver(entry);
  }

  /** Cancels an entry waiting its turn, or dismisses a failed one. */
  cancel(key: string): void {
    const before = this.state.entries.find((entry) => entry.key === key)?.status;
    const cancelled = this.update(key, (entry) => (['queued', 'waiting-retry', 'failed'].includes(entry.status) ? { ...entry, status: 'cancelled', delivered: false } : entry));
    if (cancelled && before !== 'cancelled' && cancelled.status === 'cancelled') this.deliver(cancelled);
  }

  /**
   * Runs an entry next: first in line, ready now. While the queue is paused (or waits to be resumed), it runs on its
   * own now, and the rest stay paused.
   */
  runNext(key: string): void {
    const entry = this.state.entries.find((candidate) => candidate.key === key);
    if (!entry || (entry.status !== 'queued' && entry.status !== 'waiting-retry')) return;
    this.state.entries = [{ ...entry, status: 'queued', nextAttemptAt: null }, ...this.state.entries.filter((candidate) => candidate !== entry)];
    this.deps.emit('queue', `${this.deps.id}: ${key} runs next`);
    if (this.blocked() && !this.detached) void this.attempt(key);
    else this.pump();
  }

  retry(key: string): void {
    this.update(key, (entry) => (entry.status === 'failed' ? { ...entry, status: 'queued', attempts: 0, lastError: null, nextAttemptAt: null } : entry));
    this.pump();
  }

  pause(reason = 'paused', message: string | null = null): void {
    this.state.paused = true;
    this.state.pauseReason = reason;
    this.state.pauseMessage = message;
    this.deps.emit('queue', `${this.deps.id}: paused (${message ?? reason})`);
  }

  resume(): void {
    this.state.paused = false;
    this.state.pauseReason = null;
    this.state.pauseMessage = null;
    this.state.awaitingResume = false;
    this.deps.emit('queue', `${this.deps.id}: resumed`);
    this.pump();
  }

  onStart(handler: (started: { key: string; context: unknown }) => void): void {
    this.startHandler = handler;
  }

  onResult(handler: (result: QueueResult) => void): void {
    this.handler = handler;
    for (const entry of this.state.entries.filter((candidate) => !candidate.delivered && FINISHED.includes(candidate.status))) {
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
    // The loops missing, counted first: one that finds nothing ends at once, and is not started again here.
    for (let missing = this.deps.config.concurrency - this.loops; missing > 0; missing -= 1) {
      this.loops += 1;
      void this.loop();
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
    this.startHandler = null;
    this.wake?.abort();
  }

  /** The document reopened: calls go to its target again, after the user resumes. */
  attach(target: QueueTarget): void {
    this.target = target;
    this.detached = false;
    if (this.state.entries.some((entry) => entry.status === 'queued' || entry.status === 'waiting-retry')) this.state.awaitingResume = true;
  }

  private blocked(): boolean {
    return this.detached || this.state.paused || this.state.awaitingResume;
  }

  private nextEligible(): QueueEntry | null {
    const now = this.deps.clock.now();
    return this.state.entries.find((entry) => (entry.status === 'queued' || entry.status === 'waiting-retry') && (entry.nextAttemptAt ?? 0) <= now) ?? null;
  }

  /**
   * One of the queue's `concurrency` loops, taking entries in turn. It counts itself out as it ends, at once: a loop
   * that finds nothing to run ends before the next entry is enqueued (several are, together), which then starts another.
   */
  private async loop(): Promise<void> {
    try {
      while (!this.blocked()) {
        const entry = this.nextEligible();
        if (!entry) {
          // Entries held back until a later time: retries, and entries enqueued with a delay.
          const retryTimes = this.state.entries.filter((candidate) => candidate.nextAttemptAt !== null && (candidate.status === 'waiting-retry' || candidate.status === 'queued')).map((candidate) => candidate.nextAttemptAt ?? 0);
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
    } finally {
      this.loops -= 1;
    }
  }

  private async attempt(key: string): Promise<void> {
    const entry = this.update(key, (current) => ({ ...current, status: 'running', attempts: current.attempts + 1, nextAttemptAt: null }));
    if (!entry) return;
    this.lastStartedAt = this.deps.clock.now();
    this.deps.emit('queue', `${this.deps.id}: run ${key} (attempt ${entry.attempts})`);
    this.startHandler?.({ key, context: entry.context ?? null });
    try {
      const result = await this.target(entry.input, { idempotencyKey: entry.idempotencyKey });
      const done = this.update(key, (current) => ({ ...current, status: 'done', result, lastError: null }));
      if (done) this.deliver(done);
    } catch (error) {
      const code = errorCode(error);
      const status = errorStatus(error);
      if (code === 'not_authenticated' || code === 'not_authorized' || code === 'no_profile') {
        // Needs the user (sign in again, review the document's access, or choose a browser profile); keep the entry and
        // wait.
        this.update(key, (current) => ({ ...current, status: 'queued', attempts: current.attempts - 1, lastError: errorMessage(error) }));
        this.pause(code);
        return;
      }
      const action = errorAction(error);
      if (action === 'pause') {
        // The service's response says to wait for the user (such as quota run out): the entry waits its turn again, and
        // so does every other, rather than each failing the same way.
        this.update(key, (current) => ({ ...current, status: 'queued', attempts: current.attempts - 1, lastError: errorMessage(error) }));
        this.pause('response', errorMessage(error));
        return;
      }
      const retry = this.deps.config.retry;
      // The service's rule says, when one matched; else the queue's own statuses and codes to retry.
      const retryable = action ? action === 'retry' : (status !== undefined && retry.statuses.includes(status)) || retry.codes.includes(code);
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
    if (!this.handler || !FINISHED.includes(entry.status)) return;
    this.update(entry.key, (current) => ({ ...current, delivered: true }));
    this.deps.emit('queue', `${this.deps.id}: ${entry.status} ${entry.key}${entry.status === 'failed' ? ` (${entry.lastError ?? 'Failed.'})` : ''}`);
    const base = { key: entry.key, context: entry.context ?? null };
    this.handler(entry.status === 'done'
      ? { ...base, status: 'done', result: entry.result }
      : entry.status === 'failed'
        ? { ...base, status: 'failed', error: entry.lastError ?? 'Failed.' }
        : { ...base, status: 'cancelled' });
  }

  private update(key: string, change: (entry: QueueEntry) => QueueEntry): QueueEntry | null {
    let updated: QueueEntry | null = null;
    this.state.entries = this.state.entries.map((entry) => {
      if (entry.key !== key) return entry;
      updated = { ...change(entry), updatedAt: this.deps.clock.now() };
      return updated;
    });
    return updated;
  }
}
