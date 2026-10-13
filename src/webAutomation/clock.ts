export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export type Random = () => number;

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('The operation was cancelled.');
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) => new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(abortReason(signal!));
    };
    signal?.addEventListener('abort', abort, { once: true });
  }),
};

/** Deterministic PRNG (mulberry32) so random delays vary but replay identically for a seed. */
export function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomBetween(random: Random, min: number, max: number): number {
  return Math.round(min + random() * Math.max(0, max - min));
}
