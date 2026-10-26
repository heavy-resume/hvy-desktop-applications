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
    collectionLimits: () => ({ perSite: 2, total: options.global ?? 4 }),
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

  it('runs two jobs on a site at once, whose loads there take turns, and closes idle workers', async () => {
    const { clock, scheduler, host, log } = setup({ perProfile: 4 });
    const loads: string[] = [];
    let running = 0;
    let mostAtOnce = 0;
    const job = (label: string) => scheduler.run({ profileId: 'p1', kind: 'collection', origin: 'https://same.test', label }, async (lease) => {
      running += 1;
      mostAtOnce = Math.max(mostAtOnce, running);
      for (let page = 1; page <= 2; page += 1) {
        await lease.paced(`https://same.test/${label}/${page}`, async () => {
          loads.push(`load ${label}`);
          await clock.sleep(500);
          loads.push(`loaded ${label}`);
        });
      }
      running -= 1;
    });
    const all = Promise.all([job('first'), job('second'), job('third')]);
    await clock.step(0);
    // A third job on the site waits for one of the two there.
    expect(scheduler.getState().waitingJobs.map((waiting) => waiting.label)).toEqual(['third']);
    await clock.runUntil(() => loads.length === 12);
    await all;
    expect(mostAtOnce).toBe(2);
    // A load from the site never starts before the one before it finished.
    expect(loads.every((event, index) => (index % 2 === 0 ? event.startsWith('load ') : event === loads[index - 1].replace('load ', 'loaded ')))).toBe(true);
    await clock.advance(61_000);
    expect(host.workerIds()).toEqual([]);
    expect(log).toContain('worker closed (idle)');
  });

  it('waits a random delay between loads from the same site', async () => {
    const { clock, scheduler } = setup();
    const times: number[] = [];
    const done = scheduler.run({ profileId: 'p1', kind: 'collection', label: 'pace' }, async (lease) => {
      for (let index = 0; index < 4; index += 1) {
        await lease.paced('https://same.test/page', async () => {
          times.push(clock.now());
        });
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
        await lease.paced('https://same.test/page', async () => {
          times.push(clock.now());
        });
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
  it('reads the collection limits as each job is placed, so a changed setting applies to the next job', async () => {
    const clock = new VirtualClock();
    let limits = { perSite: 1, total: 4 };
    const scheduler = new WorkerScheduler({ host: new MockHost([]), clock, random: seededRandom(1), emit: () => undefined, collectionLimits: () => limits });
    const job = (label: string) => scheduler.run({ profileId: 'p1', kind: 'collection', origin: 'https://same.test', label }, holdFor(clock, 10_000));
    const first = [job('a'), job('b')];
    await clock.step(0);
    expect(scheduler.getState().waitingJobs.map((waiting) => waiting.label)).toEqual(['b']);
    // App Settings: two pages on one site. The next placement lets the waiting job in, in order.
    limits = { perSite: 2, total: 4 };
    const third = job('c');
    await clock.step(0);
    expect(scheduler.getState().waitingJobs.map((waiting) => waiting.label)).toEqual(['c']);
    expect(scheduler.getState().workers.filter((worker) => worker.busy).map((worker) => worker.label).sort()).toEqual(['a', 'b']);
    await clock.runUntil(() => scheduler.getState().waitingJobs.length === 0 && scheduler.getState().workers.every((worker) => !worker.busy));
    await Promise.all([...first, third]);
  });
});
