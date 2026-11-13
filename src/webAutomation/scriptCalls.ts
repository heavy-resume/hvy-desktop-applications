import { SCRIPT_REPEAT_LIMIT, SCRIPT_WATCHDOG_WINDOW_MS } from '../../../heavy-file-format/src/plugins/scripting/cycle-coordinator';
import type { Clock } from './clock';

/**
 * heavy-file-format gives the callbacks of one script run a step budget they share, reset only after this long with none
 * of them running (CALLBACK_BUDGET_RESET_GAP_MS in its scripting wrapper, which it does not export).
 */
const CALLBACK_BUDGET_RESET_GAP_MS = 3_000;
/**
 * The mutation renders one call into a script may cause, as heavy-file-format's watchdog counts them for the script: the
 * render of the call's own edits, and those of the document hook runs its edits start.
 */
const RENDERS_PER_CALL = 3;
/** Calls started within the watchdog's window, kept below its limit (it stops a script at SCRIPT_REPEAT_LIMIT renders). */
export const CALLS_PER_WINDOW = Math.max(1, Math.floor((SCRIPT_REPEAT_LIMIT - 1) / RENDERS_PER_CALL));
/** Calls in a row with no budget-resetting gap between them, before the gap is waited for. */
export const CALLS_PER_BUDGET = 20;

interface WaitingCall {
  run: () => void;
  settle: (ran: boolean) => void;
}

/**
 * Calls into a document's scripts (the callbacks they registered with Galaxy's plugins: queue results, finished calls,
 * sign-in changes), one at a time and in order, no faster than heavy-file-format's limits allow. Its render watchdog
 * stops a script that renders too often, and its callbacks share a step budget until they pause: a queue answering every
 * moment would run into either. A call is a synchronous script execution, so it cannot be slowed once started; it is
 * started later instead. With nothing waiting and room under both limits, a call runs at once.
 */
export class ScriptCalls {
  private waiting: WaitingCall[] = [];
  private startedAt: number[] = [];
  private callsInARow = 0;
  private lastEndedAt = Number.NEGATIVE_INFINITY;
  private draining = false;
  private closed = false;

  constructor(private readonly clock: Clock) {}

  /** Resolves true once the call has run, or false if the document closed first (it never runs). */
  call(run: () => void): Promise<boolean> {
    if (this.closed) return Promise.resolve(false);
    const ran = new Promise<boolean>((settle) => this.waiting.push({ run, settle }));
    void this.drain();
    return ran;
  }

  /** Calls waiting their turn. */
  pending(): number {
    return this.waiting.length;
  }

  /** The document closed: nothing waiting runs. */
  close(): void {
    this.closed = true;
    for (const call of this.waiting.splice(0)) call.settle(false);
  }

  /** How long the next call must wait, from now. */
  private delay(now: number): number {
    if (now - this.lastEndedAt >= CALLBACK_BUDGET_RESET_GAP_MS) this.callsInARow = 0;
    this.startedAt = this.startedAt.filter((at) => now - at < SCRIPT_WATCHDOG_WINDOW_MS);
    const forBudget = this.callsInARow >= CALLS_PER_BUDGET ? this.lastEndedAt + CALLBACK_BUDGET_RESET_GAP_MS - now : 0;
    const forWatchdog = this.startedAt.length >= CALLS_PER_WINDOW ? this.startedAt[0] + SCRIPT_WATCHDOG_WINDOW_MS - now : 0;
    return Math.max(forBudget, forWatchdog);
  }

  private async drain(): Promise<void> {
    // A call that makes another (a script's edit a plugin reports back) leaves it to this loop.
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.waiting.length) {
        const delay = this.delay(this.clock.now());
        if (delay > 0) {
          await this.clock.sleep(delay);
          continue;
        }
        const next = this.waiting.shift()!;
        this.startedAt.push(this.clock.now());
        this.callsInARow += 1;
        try {
          next.run();
        } catch (error) {
          // Reported as an uncaught error is, without stopping the calls after it.
          queueMicrotask(() => {
            throw error;
          });
        } finally {
          this.lastEndedAt = this.clock.now();
          next.settle(true);
        }
      }
    } finally {
      this.draining = false;
    }
  }
}
