import { describe, expect, it } from 'vitest';
import { SCRIPT_WATCHDOG_WINDOW_MS } from '../../../heavy-file-format/src/plugins/scripting/cycle-coordinator';
import { VirtualClock } from '../test/webAutomation/virtualClock';
import { CALLS_PER_BUDGET, CALLS_PER_WINDOW, ScriptCalls } from './scriptCalls';

describe('calls into a document\'s scripts', () => {
  it('runs a call at once while there is room, in order, and starts no more than the watchdog allows in its window', async () => {
    const clock = new VirtualClock();
    const calls = new ScriptCalls(clock);
    const ran: Array<[number, number]> = [];
    const done = Array.from({ length: CALLS_PER_WINDOW * 3 }, (_, index) => calls.call(() => ran.push([index, clock.now()])));
    // The first are not held back.
    expect(ran.map(([index]) => index)).toEqual(Array.from({ length: CALLS_PER_WINDOW }, (_, index) => index));
    expect(calls.pending()).toBe(CALLS_PER_WINDOW * 2);
    await clock.runUntil(() => calls.pending() === 0);
    expect(await Promise.all(done)).toEqual(done.map(() => true));
    expect(ran.map(([index]) => index)).toEqual(done.map((_, index) => index));
    // Within any window as long as the watchdog's, at most CALLS_PER_WINDOW start.
    for (const [, at] of ran) expect(ran.filter(([, other]) => other >= at && other < at + SCRIPT_WATCHDOG_WINDOW_MS).length).toBeLessThanOrEqual(CALLS_PER_WINDOW);
  });

  it('waits for the step budget\'s gap after many calls in a row, and starts afresh after it', async () => {
    const clock = new VirtualClock();
    const calls = new ScriptCalls(clock);
    const ran: number[] = [];
    const total = CALLS_PER_BUDGET + 2;
    for (let index = 0; index < total; index += 1) void calls.call(() => ran.push(clock.now()));
    await clock.runUntil(() => calls.pending() === 0);
    expect(ran).toHaveLength(total);
    // The one after CALLS_PER_BUDGET in a row starts three seconds after the last of them ended, at least.
    expect(ran[CALLS_PER_BUDGET] - ran[CALLS_PER_BUDGET - 1]).toBeGreaterThanOrEqual(3_000);
  });

  it('runs nothing waiting once the document closes, and says so', async () => {
    const clock = new VirtualClock();
    const calls = new ScriptCalls(clock);
    const ran: number[] = [];
    const done = Array.from({ length: CALLS_PER_WINDOW + 2 }, (_, index) => calls.call(() => ran.push(index)));
    calls.close();
    expect(await Promise.all(done)).toEqual([...Array.from({ length: CALLS_PER_WINDOW }, () => true), false, false]);
    expect(ran).toHaveLength(CALLS_PER_WINDOW);
    expect(await calls.call(() => ran.push(-1))).toBe(false);
  });

  it('keeps going after a call that throws', async () => {
    const clock = new VirtualClock();
    const calls = new ScriptCalls(clock);
    const thrown: unknown[] = [];
    const onError = (error: unknown) => thrown.push(error);
    process.on('uncaughtException', onError);
    try {
      const first = calls.call(() => {
        throw new Error('broken handler');
      });
      const second = calls.call(() => undefined);
      expect(await Promise.all([first, second])).toEqual([true, true]);
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 0));
      process.off('uncaughtException', onError);
    }
  });
});
