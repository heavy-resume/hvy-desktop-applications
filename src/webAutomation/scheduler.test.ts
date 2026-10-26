import { describe, expect, it } from 'vitest';
import { seededRandom } from './clock';
import { MockHost } from '../test/webAutomation/mockHost';
import { VirtualClock } from '../test/webAutomation/virtualClock';
import { WorkerScheduler } from './scheduler';

function setup(options: { perProfile?: number; global?: number; delayScale?: number } = {}) {
  const clock = new VirtualClock();
  const host = new MockHost([]);
  const log: string[] = [];
  const scheduler = new WorkerScheduler({
    host,
    clock,
    random: seededRandom(1),
    emit: (_source, message) => log.push(message),
    maxCollectionWorkersPerProfile: options.perProfile ?? 2,
    maxCollectionWorkersGlobal: options.global ?? 4,
    idleTimeoutMs: 60_000,
    ...(options.delayScale !== undefined ? { navigationDelayScale: options.delayScale } : {}),
  });
  return { clock, host, scheduler, log };
}

const holdFor = (clock: VirtualClock, ms: number) => async () => clock.sleep(ms);

describe('worker scheduler', () => {
  it('caps collection workers per profile and globally, and reserves an API worker', async () => {
    const { clock, scheduler, host } = setup({ perProfile: 2, global: 3 });
    const jobs = ['a', 'b', 'c'].map((origin) => scheduler.run({ profileId: 'p1', kind: 'collection', origin: `https://${origin}.test`, label: origin }, holdFor(clock, 10_000)));
    const other = ['d', 'e'].map((origin) => scheduler.run({ profileId: 'p2', kind: 'collection', origin: `https://${origin}.test`, label: origin }, holdFor(clock, 10_000)));
    const api = scheduler.run({ profileId: 'p1', kind: 'api', label: 'api' }, holdFor(clock, 100));
    await clock.step(0);
    expect(scheduler.getState().workers.filter((worker) => worker.kind === 'collection')).toHaveLength(3);
    expect(scheduler.getState().workers.filter((worker) => worker.profileId === 'p1' && worker.kind === 'collection')).toHaveLength(2);
    expect(scheduler.getState().workers.some((worker) => worker.kind === 'api' && worker.busy)).toBe(true);
    expect(scheduler.getState().waitingJobs.map((job) => job.label)).toEqual(['c', 'e']);
    await clock.runUntil(() => scheduler.getState().waitingJobs.length === 0 && scheduler.getState().workers.every((worker) => !worker.busy));
    await Promise.all([...jobs, ...other, api]);
    expect(host.workerIds().length).toBeLessThanOrEqual(4);
  });

  it('serializes jobs on the same origin and profile, and closes idle workers', async () => {
    const { clock, scheduler, host, log } = setup();
    const order: string[] = [];
    const job = (label: string) => scheduler.run({ profileId: 'p1', kind: 'collection', origin: 'https://same.test', label }, async () => {
      order.push(`start ${label}`);
      await clock.sleep(1_000);
      order.push(`end ${label}`);
    });
    const both = Promise.all([job('first'), job('second')]);
    await clock.runUntil(() => order.length === 4);
    await both;
    expect(order).toEqual(['start first', 'end first', 'start second', 'end second']);
    await clock.advance(61_000);
    expect(host.workerIds()).toEqual([]);
    expect(log).toContain('worker closed (idle)');
  });

  it('waits a random delay between navigations to the same origin', async () => {
    const { clock, scheduler } = setup();
    const times: number[] = [];
    const done = scheduler.run({ profileId: 'p1', kind: 'collection', label: 'pace' }, async (lease) => {
      for (let index = 0; index < 4; index += 1) {
        await lease.pace('https://same.test/page');
        times.push(clock.now());
      }
    });
    await clock.runUntil(() => times.length === 4);
    await done;
    const gaps = times.slice(1).map((time, index) => time - times[index]);
    expect(gaps.every((gap) => gap >= 1_500 && gap <= 4_500)).toBe(true);
    expect(new Set(gaps).size).toBeGreaterThan(1);
  });

  it('scales the delays for development, and says how long each would be at full pacing', async () => {
    const { clock, scheduler, log } = setup({ delayScale: 0.25 });
    const times: number[] = [];
    const done = scheduler.run({ profileId: 'p1', kind: 'collection', label: 'pace' }, async (lease) => {
      for (let index = 0; index < 4; index += 1) {
        await lease.pace('https://same.test/page');
        times.push(clock.now());
      }
    });
    await clock.runUntil(() => times.length === 4);
    await done;
    const gaps = times.slice(1).map((time, index) => time - times[index]);
    expect(gaps.every((gap) => gap >= 375 && gap <= 1_125)).toBe(true);
    const delays = log.filter((line) => line.startsWith('delay '));
    expect(delays).toHaveLength(3);
    for (const [index, line] of delays.entries()) {
      const [, scaled, full] = line.match(/^delay ([\d.]+)s before same\.test \(([\d.]+)s at full pacing\)$/)!;
      expect(Number(scaled)).toBeCloseTo(gaps[index] / 1000, 1);
      expect(Number(full)).toBeCloseTo(Number(scaled) * 4, 0);
    }
  });
});
