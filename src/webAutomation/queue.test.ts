import { describe, expect, it } from 'vitest';
import { VirtualClock } from '../test/webAutomation/virtualClock';
import { WebAutomationError } from './errors';
import { DEFAULT_QUEUE_CONFIG, DurableQueue, Semaphore, type QueueResult } from './queue';

function createQueue(clock: VirtualClock, concurrency: number) {
  let ids = 0;
  const calls: unknown[] = [];
  const queue = new DurableQueue({
    slots: new Semaphore(() => 8),
    network: { ready: async () => undefined },
    id: 'test',
    config: { ...DEFAULT_QUEUE_CONFIG, concurrency, minIntervalMs: 1_000, jitterMs: 0 },
    clock,
    random: () => 0,
    emit: () => undefined,
    createId: () => `id-${++ids}`,
    target: async (input) => {
      calls.push(input);
      await clock.sleep(10);
      return input;
    },
  });
  return { queue, calls };
}

async function runUntilIdle(clock: VirtualClock, queue: DurableQueue): Promise<void> {
  for (let step = 0; step < 1_000 && !queue.isIdle(); step += 1) {
    if (!await clock.step()) break;
  }
}

describe('DurableQueue', () => {
  it('runs as many jobs at once as the shared slots allow, across queues, each holding its slot until its result is handled', async () => {
    const clock = new VirtualClock();
    let limit = 1;
    const slots = new Semaphore(() => limit);
    const started: string[] = [];
    const handled: Array<() => void> = [];
    const queues = ['a', 'b', 'c'].map((id) => {
      const queue = new DurableQueue({
        slots,
        network: { ready: async () => undefined },
        id,
        config: { ...DEFAULT_QUEUE_CONFIG, concurrency: 1, minIntervalMs: 0, jitterMs: 0 },
        clock,
        random: () => 0,
        emit: () => undefined,
        createId: () => `${id}-id`,
        target: async (input) => {
          started.push(String(input));
          return input;
        },
      });
      // The script takes its time with each result.
      queue.onResult(() => new Promise<boolean>((resolve) => handled.push(() => resolve(true))));
      queue.enqueue(id, id);
      return queue;
    });
    await clock.step();
    expect(started).toEqual(['a']);

    // Its result handled, the next queue's job starts.
    handled.shift()!();
    await clock.step();
    expect(started).toEqual(['a', 'b']);

    // A changed limit applies to the next slot taken.
    limit = 2;
    handled.shift()!();
    await clock.step();
    expect(started).toEqual(['a', 'b', 'c']);
    handled.shift()!();
    await clock.step();
    expect(queues.every((queue) => queue.isIdle())).toBe(true);
  });

  it('has work while a result waits for its script: one its handler couldn\'t run is held until a handler takes it', async () => {
    const clock = new VirtualClock();
    const { queue } = createQueue(clock, 1);
    // The document's callbacks were gone when the result came: the handler says it didn't run.
    let running = false;
    queue.onResult(async () => running);
    queue.enqueue('a', 'a');
    await runUntilIdle(clock, queue);
    for (let step = 0; step < 5; step += 1) await clock.step();
    expect(queue.isIdle()).toBe(true);
    expect(queue.hasWork()).toBe(true);
    // A handler that runs (the document's load script registering again) takes it, and the work is done.
    running = true;
    queue.onResult(async () => running);
    for (let step = 0; step < 5; step += 1) await clock.step();
    expect(queue.hasWork()).toBe(false);
  });

  it('gives a result to the handler registered while it was out being handed to a replaced one', async () => {
    const clock = new VirtualClock();
    const { queue } = createQueue(clock, 1);
    const handled: string[] = [];
    // The load script's first run: its handler is called, but by the time it would run, the script ran again.
    let replaced: (ran: boolean) => void = () => undefined;
    queue.onResult(() => new Promise<boolean>((resolve) => { replaced = resolve; }));
    queue.enqueue('a', 'a');
    await runUntilIdle(clock, queue);
    for (let step = 0; step < 5; step += 1) await clock.step();
    // The second run registers its handler (the result is out, so isn't given again yet), then the first says it didn't run.
    queue.onResult(async (result) => {
      handled.push(String(result.key));
      return true;
    });
    replaced(false);
    for (let step = 0; step < 5; step += 1) await clock.step();
    expect(handled).toEqual(['a']);
    expect(queue.hasWork()).toBe(false);
  });

  it('has no work for a result nothing has registered to take, as a queue whose document never asked for results', async () => {
    const clock = new VirtualClock();
    const { queue } = createQueue(clock, 1);
    queue.enqueue('a', 'a');
    await runUntilIdle(clock, queue);
    expect(queue.getState().entries.map((entry) => [entry.status, entry.delivered])).toEqual([['done', false]]);
    expect(queue.hasWork()).toBe(false);
  });

  it('runs every entry enqueued together, whatever its concurrency', async () => {
    for (const concurrency of [1, 2, 3]) {
      const clock = new VirtualClock();
      const { queue, calls } = createQueue(clock, concurrency);
      for (const key of ['a', 'b', 'c', 'd', 'e']) queue.enqueue(key, key);
      await runUntilIdle(clock, queue);
      expect(queue.getState().entries.map((entry) => entry.status), `concurrency ${concurrency}`).toEqual(['done', 'done', 'done', 'done', 'done']);
      expect(calls).toHaveLength(5);
    }
  });

  it('takes the file\'s settings when reopened while still in memory, as a regenerated file sets more calls at once', async () => {
    const clock = new VirtualClock();
    let ids = 0;
    const queue = new DurableQueue({
      slots: new Semaphore(() => 8),
      network: { ready: async () => undefined },
      id: 'details',
      config: { ...DEFAULT_QUEUE_CONFIG, concurrency: 1, minIntervalMs: 200, jitterMs: 0 },
      clock,
      random: () => 0,
      emit: () => undefined,
      createId: () => `id-${++ids}`,
      target: async (input) => {
        await clock.sleep(5_000);
        return input;
      },
    });
    queue.reopen(null, { ...DEFAULT_QUEUE_CONFIG, concurrency: 3, minIntervalMs: 200, jitterMs: 0 });
    for (const key of ['a', 'b', 'c', 'd']) queue.enqueue(key, key);
    const running = () => queue.getState().entries.filter((entry) => entry.status === 'running').length;
    await clock.runUntil(() => running() === 3);
    expect(running()).toBe(3);
    await runUntilIdle(clock, queue);
  });

  it('pauses with the service\'s message when a response rule says to, every entry waiting its turn rather than failing; Stop cancels them', async () => {
    const clock = new VirtualClock();
    let ids = 0;
    let quota = 1;
    const sent: unknown[] = [];
    const results: QueueResult[] = [];
    const queue = new DurableQueue({
      slots: new Semaphore(() => 8),
      network: { ready: async () => undefined },
      id: 'evaluate',
      config: { ...DEFAULT_QUEUE_CONFIG, concurrency: 1, minIntervalMs: 1_000, jitterMs: 0 },
      clock,
      random: () => 0,
      emit: () => undefined,
      createId: () => `id-${++ids}`,
      target: async (input) => {
        sent.push(input);
        await clock.sleep(10);
        if (quota <= 0) throw new WebAutomationError('http_error', 'Not enough premium HVY tokens for this request.', 402, 'pause');
        quota -= 1;
        return input;
      },
    });
    queue.onResult((result) => { results.push(result); });
    for (const key of ['a', 'b', 'c', 'd']) queue.enqueue(key, key);
    await runUntilIdle(clock, queue);
    // The first went through; the second was told quota ran out, and waits again with the rest: none was sent after it.
    expect(sent).toEqual(['a', 'b']);
    expect(queue.getState()).toMatchObject({ paused: true, pauseReason: 'response', pauseMessage: 'Not enough premium HVY tokens for this request.' });
    expect(queue.getState().entries.map((entry) => [entry.key, entry.status, entry.attempts])).toEqual([['a', 'done', 1], ['b', 'queued', 0], ['c', 'queued', 0], ['d', 'queued', 0]]);
    expect(results.map((result) => result.status)).toEqual(['done']);

    // Topped up for one more, and resumed: the one that waited goes first, then the next is told quota ran out again.
    quota = 1;
    queue.resume();
    await runUntilIdle(clock, queue);
    expect(sent).toEqual(['a', 'b', 'b', 'c']);
    expect(queue.getState()).toMatchObject({ paused: true, pauseMessage: 'Not enough premium HVY tokens for this request.' });

    // Stop: what waits is cancelled, and nothing is left paused.
    queue.stop();
    expect(queue.getState()).toMatchObject({ paused: false, pauseReason: null, pauseMessage: null });
    expect(queue.getState().entries.map((entry) => entry.status)).toEqual(['done', 'done', 'cancelled', 'cancelled']);
    expect(results.map((result) => [result.key, result.status])).toEqual([['a', 'done'], ['b', 'done'], ['c', 'cancelled'], ['d', 'cancelled']]);
  });

  it('retries or fails as a response rule says, whatever its own retry statuses', async () => {
    for (const [action, expected] of [['retry', 'waiting-retry'], ['fail', 'failed']] as const) {
      const clock = new VirtualClock();
      let ids = 0;
      const queue = new DurableQueue({
        slots: new Semaphore(() => 8),
        network: { ready: async () => undefined },
        id: 'evaluate',
        // 429 is one the queue retries itself; 418 is not.
        config: { ...DEFAULT_QUEUE_CONFIG, concurrency: 1, jitterMs: 0 },
        clock,
        random: () => 0,
        emit: () => undefined,
        createId: () => `id-${++ids}`,
        target: async () => {
          throw new WebAutomationError('http_error', 'No.', action === 'retry' ? 418 : 429, action);
        },
      });
      queue.enqueue('a', 'a');
      await clock.runUntil(() => queue.getState().entries[0].status !== 'queued' && queue.getState().entries[0].status !== 'running');
      expect(queue.getState().entries[0].status, action).toBe(expected);
      queue.detach();
    }
  });
});
