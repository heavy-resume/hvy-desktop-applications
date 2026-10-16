import type { Clock } from '../../webAutomation/clock';

interface Timer {
  at: number;
  sequence: number;
  fire(): void;
}

function settleMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Virtual time: sleeps resolve only when the scenario runs the clock forward. */
export class VirtualClock implements Clock {
  private current = 0;
  private sequence = 0;
  private timers: Timer[] = [];

  now(): number {
    return this.current;
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const abort = () => {
        this.timers = this.timers.filter((candidate) => candidate !== timer);
        reject(signal!.reason);
      };
      const timer: Timer = {
        at: this.current + Math.max(0, ms),
        sequence: this.sequence++,
        fire: () => {
          signal?.removeEventListener('abort', abort);
          resolve();
        },
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.timers.push(timer);
    });
  }

  pendingTimers(): number {
    return this.timers.length;
  }

  /** Fires the next timer. Returns false when nothing is waiting on time. */
  async step(limitAt = Number.POSITIVE_INFINITY): Promise<boolean> {
    await settleMicrotasks();
    const next = [...this.timers].sort((left, right) => left.at - right.at || left.sequence - right.sequence)[0];
    if (!next || next.at > limitAt) return false;
    this.timers = this.timers.filter((candidate) => candidate !== next);
    this.current = Math.max(this.current, next.at);
    next.fire();
    await settleMicrotasks();
    return true;
  }

  /** Runs time forward until `done()` is true; returns false if nothing is left to wait on first. */
  async runUntil(done: () => boolean, maxSteps = 100_000): Promise<boolean> {
    await settleMicrotasks();
    for (let steps = 0; !done(); steps += 1) {
      if (steps >= maxSteps) throw new Error(`Virtual clock exceeded ${maxSteps} steps.`);
      if (!(await this.step())) return done();
    }
    return true;
  }

  async advance(ms: number): Promise<void> {
    const target = this.current + ms;
    while (await this.step(target)) { /* fire every timer due by target */ }
    this.current = Math.max(this.current, target);
    await settleMicrotasks();
  }
}
