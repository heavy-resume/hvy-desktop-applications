import { describe, expect, it } from 'vitest';
import { VirtualClock } from '../test/webAutomation/virtualClock';
import { DEFAULT_QUEUE_CONFIG, DurableQueue } from './queue';

function createQueue(clock: VirtualClock, concurrency: number) {
  let ids = 0;
  const calls: unknown[] = [];
  const queue = new DurableQueue({
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
});
