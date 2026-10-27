/**
 * Requests Galaxy makes of a browser profile's window: fetching records, running a command, a preview, a ready check.
 * Each has an id the page sends back with its answer (`context.browserRequestId`, or `requestId` on a command's or
 * WebMCP's result), and ends one way: the page answers, it times out, it is stopped, or the profile's window closes.
 * Whoever waits on one finds out which, so nothing is left waiting on a window that is gone.
 */

export class IntegrationBrowserClosedError extends Error {
  constructor(message = 'The browser window was closed.') {
    super(message);
    this.name = 'IntegrationBrowserClosedError';
  }
}

type BrowserResult = Record<string, unknown>;

export interface BrowserRequestOptions<T> {
  profileId: string;
  /** Which results with the request's id answer it; a result it doesn't accept is left for others. */
  accepts?: (result: BrowserResult) => boolean;
  /** The request's value from the page's answer. Throwing fails the request with that error. */
  answer: (result: BrowserResult) => T;
  /** Without one, the request waits as long as it takes (a person picking on the page), until stopped or closed. */
  timeoutMs?: number;
  timeoutMessage?: string;
  signal?: AbortSignal;
  abortMessage?: string;
  /** Stops the page's work when the request ends without an answer, by time limit or by being stopped. */
  onStop?: () => void;
}

interface Waiting {
  profileId: string;
  accepts(result: BrowserResult): boolean;
  answer(result: BrowserResult): unknown;
  resolve(value: unknown): void;
  reject(error: Error): void;
  end(): void;
}

const waiting = new Map<string, Waiting>();

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function settle(requestId: string, outcome: { value: unknown } | { error: Error }): void {
  const request = waiting.get(requestId);
  if (!request) return;
  waiting.delete(requestId);
  request.end();
  if ('error' in outcome) request.reject(outcome.error);
  else request.resolve(outcome.value);
}

/** Waits for the page's answer to `requestId`, which the caller has sent (or is about to). */
export function waitForBrowserAnswer<T>(requestId: string, options: BrowserRequestOptions<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = (error: Error) => {
      if (!waiting.has(requestId)) return;
      options.onStop?.();
      settle(requestId, { error });
    };
    const timeout = options.timeoutMs === undefined ? null : setTimeout(() => stop(new Error(options.timeoutMessage ?? 'Timed out while waiting for the page.')), options.timeoutMs);
    const abort = () => stop(options.signal?.reason instanceof Error ? options.signal.reason : new Error(options.abortMessage ?? 'The request was stopped.'));
    options.signal?.addEventListener('abort', abort, { once: true });
    waiting.set(requestId, {
      profileId: options.profileId,
      accepts: options.accepts ?? (() => true),
      answer: options.answer,
      resolve: (value) => resolve(value as T),
      reject,
      end: () => {
        if (timeout) clearTimeout(timeout);
        options.signal?.removeEventListener('abort', abort);
      },
    });
    if (options.signal?.aborted) abort();
  });
}

/** Sends a request (`send` puts its id where the page will send it back) and waits for its answer. */
export function requestFromBrowser<T>(options: BrowserRequestOptions<T>, send: (requestId: string) => Promise<unknown>): Promise<T> {
  const requestId = crypto.randomUUID();
  const answer = waitForBrowserAnswer(requestId, options);
  void send(requestId).catch((error: unknown) => failBrowserRequest(requestId, error));
  return answer;
}

/** Fails a request that couldn't be sent, or whose sender knows it won't be answered. */
export function failBrowserRequest(requestId: string, error: unknown): void {
  settle(requestId, { error: asError(error) });
}

/** The request id a result answers, if any. */
export function browserResultRequestId(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = value as BrowserResult;
  const context = result.context && typeof result.context === 'object' && !Array.isArray(result.context) ? result.context as BrowserResult : null;
  const id = context?.browserRequestId ?? result.requestId;
  return typeof id === 'string' ? id : null;
}

/** Answers the request a page's result is for. False when it answers none, so the result is someone else's. */
export function answerBrowserRequest(value: unknown): boolean {
  const requestId = browserResultRequestId(value);
  const request = requestId ? waiting.get(requestId) : undefined;
  if (!requestId || !request || !request.accepts(value as BrowserResult)) return false;
  try {
    settle(requestId, { value: request.answer(value as BrowserResult) });
  } catch (error) {
    settle(requestId, { error: asError(error) });
  }
  return true;
}

/** A profile's window closed: every request still waiting on it fails, as none of them can be answered now. */
export function browserClosed(profileId: string): void {
  for (const [requestId, request] of [...waiting]) {
    if (request.profileId === profileId) settle(requestId, { error: new IntegrationBrowserClosedError() });
  }
}
