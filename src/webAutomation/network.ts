import type { Clock } from './clock';
import { errorMessage, isUnreachable, UNREACHABLE_MARK, WebAutomationError } from './errors';
import type { AutomationEmit } from './events';

/** Whether the machine has a network, as the browser tells it (navigator.onLine, and its "online" event). */
export interface Connectivity {
  online(): boolean;
  /** Calls `listener` each time the network comes back; returns how to stop. */
  whenOnline(listener: () => void): () => void;
}

export const ALWAYS_ONLINE: Connectivity = { online: () => true, whenOnline: () => () => undefined };

export const DEFAULT_MAX_BACKOFF_MS = 120_000;
const FIRST_BACKOFF_MS = 2_000;

/** A site on this machine, reached without a network. */
function isLocal(url: string): boolean {
  const host = new URL(url).hostname;
  return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]';
}

/**
 * What every load and call to a site waits on (the scheduler's paced loads, a Web API call): offline, nothing goes to a
 * site that isn't local until the network is back; online, a site that couldn't be reached is tried again after a
 * while, doubling from 2s to at most the cap, and the rest wait for that try. The first answer from it opens it again.
 */
export class NetworkGate {
  /** Sites backing off, by origin: how long the last wait was, and when the next try goes. */
  private readonly backoff = new Map<string, { delay: number; until: number }>();
  private waitingOffline = false;

  constructor(private readonly deps: { connectivity: Connectivity; clock: Clock; emit: AutomationEmit; maxBackoffMs?: number }) {}

  /** Whether a load or call to the URL's site goes now. */
  open(url: string): boolean {
    if (!this.online(url)) return false;
    const site = this.backoff.get(new URL(url).origin);
    return !site || site.until <= this.deps.clock.now();
  }

  /** Resolves once a load or call to the URL's site goes; stopped (`signal`), rejects with its reason. */
  async ready(url: string, signal?: AbortSignal): Promise<void> {
    for (;;) {
      if (signal?.aborted) throw signal.reason;
      if (!this.online(url)) {
        await this.untilOnline(signal);
        continue;
      }
      const site = this.backoff.get(new URL(url).origin);
      const wait = site ? site.until - this.deps.clock.now() : 0;
      if (wait <= 0) return;
      await this.deps.clock.sleep(wait, signal);
    }
  }

  /**
   * Runs `attempt` once the URL's site may be reached. A failure that never reached it (the host says so, or the
   * network went) waits and is tried again; without `wait`, it is thrown as unreachable, as is a site not open now.
   */
  async reach<T>(url: string, attempt: () => Promise<T>, options: { wait: boolean; signal?: AbortSignal }): Promise<T> {
    for (;;) {
      if (!options.wait && !this.open(url)) throw this.unreachable(url);
      await this.ready(url, options.signal);
      try {
        const result = await attempt();
        this.reached(url);
        return result;
      } catch (error) {
        if (options.signal?.aborted || !this.failedToReach(url, error)) throw error;
        // Offline, it waits for the network; online, the site couldn't be reached, and backs off.
        if (this.online(url)) this.backOff(url);
        if (!options.wait) throw this.unreachable(url, error);
      }
    }
  }

  private online(url: string): boolean {
    return isLocal(url) || this.deps.connectivity.online();
  }

  /** The host says so; or, with no network now, a failure that isn't one of automation's own. */
  private failedToReach(url: string, error: unknown): boolean {
    return isUnreachable(error) || (!this.online(url) && !(error instanceof WebAutomationError));
  }

  private reached(url: string): void {
    const origin = new URL(url).origin;
    if (this.backoff.delete(origin)) this.deps.emit('network', `reached ${new URL(url).host} again`);
  }

  private backOff(url: string): void {
    const origin = new URL(url).origin;
    const previous = this.backoff.get(origin);
    const delay = Math.min(previous ? previous.delay * 2 : FIRST_BACKOFF_MS, this.deps.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS);
    this.backoff.set(origin, { delay, until: this.deps.clock.now() + delay });
    this.deps.emit('network', `couldn’t reach ${new URL(url).host}: trying again in ${Math.round(delay / 1000)}s`);
  }

  private unreachable(url: string, cause?: unknown): WebAutomationError {
    const host = new URL(url).host;
    const message = !this.online(url)
      ? 'You’re offline.'
      : `Couldn’t reach ${host}${cause ? `: ${errorMessage(cause).replace(UNREACHABLE_MARK, '').trim()}` : '.'}`;
    return new WebAutomationError('unreachable', message, undefined, undefined, new URL(url).origin);
  }

  private untilOnline(signal?: AbortSignal): Promise<void> {
    if (!this.waitingOffline) {
      this.waitingOffline = true;
      this.deps.emit('network', 'offline: loads and calls wait for the network');
    }
    return new Promise<void>((resolve, reject) => {
      const stop = this.deps.connectivity.whenOnline(() => {
        stop();
        signal?.removeEventListener('abort', abort);
        if (this.waitingOffline) {
          this.waitingOffline = false;
          this.deps.emit('network', 'online again');
        }
        resolve();
      });
      const abort = () => {
        stop();
        reject(signal!.reason);
      };
      signal?.addEventListener('abort', abort, { once: true });
    });
  }
}
