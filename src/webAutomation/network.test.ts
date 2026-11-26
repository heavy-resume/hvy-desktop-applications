import { describe, expect, it } from 'vitest';
import { VirtualClock } from '../test/webAutomation/virtualClock';
import { WebAutomationError } from './errors';
import { NetworkGate, type Connectivity } from './network';
import { DEFAULT_QUEUE_CONFIG, DurableQueue, Semaphore } from './queue';

/** The browser's network, switched by the test: going online tells whoever waits, as the "online" event does. */
function network(online: boolean) {
  const listeners = new Set<() => void>();
  const connectivity: Connectivity = {
    online: () => online,
    whenOnline: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    connectivity,
    goOnline() {
      online = true;
      for (const listener of [...listeners]) listener();
    },
    goOffline() {
      online = false;
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('network gate', () => {
  it('offline, holds every load and call to a site until the network is back, without trying it; a local site goes', async () => {
    const clock = new VirtualClock();
    const net = network(false);
    const gate = new NetworkGate({ connectivity: net.connectivity, clock, emit: () => undefined });
    const attempts: string[] = [];
    const remote = gate.reach('https://jobs.example.com/list', async () => {
      attempts.push('remote');
      return 'listed';
    }, { wait: true });
    const local = gate.reach('http://localhost:5173/api', async () => {
      attempts.push('local');
      return 'answered';
    }, { wait: true });
    await expect(local).resolves.toBe('answered');
    // However long it is offline: no tries, no backoff.
    await clock.advance(60 * 60_000);
    expect(attempts).toEqual(['local']);

    net.goOnline();
    await expect(remote).resolves.toBe('listed');
    expect(attempts).toEqual(['local', 'remote']);
  });

  it('online, waits longer each time a site can\'t be reached, up to the cap, and its first answer opens it again', async () => {
    const clock = new VirtualClock();
    const gate = new NetworkGate({ connectivity: network(true).connectivity, clock, emit: () => undefined, maxBackoffMs: 10_000 });
    const triedAt: number[] = [];
    const call = gate.reach('https://api.example.com/v1', async () => {
      triedAt.push(clock.now());
      if (triedAt.length < 5) throw new Error('[unreachable] Failed to fetch');
      return 'answered';
    }, { wait: true });
    await clock.runUntil(() => triedAt.length === 5);
    await expect(call).resolves.toBe('answered');
    // 2s, 4s, 8s, then the 10s cap.
    expect(triedAt).toEqual([0, 2_000, 6_000, 14_000, 24_000]);
    expect(gate.open('https://api.example.com/other')).toBe(true);
  });

  it('without wait, says unreachable at once, with the site to wait on; an error the site gave is never tried again', async () => {
    const clock = new VirtualClock();
    const net = network(false);
    const gate = new NetworkGate({ connectivity: net.connectivity, clock, emit: () => undefined });
    let tries = 0;
    const offline = await gate.reach('https://api.example.com/v1', async () => {
      tries += 1;
    }, { wait: false }).catch((error: unknown) => error);
    expect(offline).toMatchObject({ code: 'unreachable', message: 'You’re offline.', origin: 'https://api.example.com' });
    expect(tries).toBe(0);

    net.goOnline();
    const refused = new WebAutomationError('http_error', 'returned 500', 500);
    await expect(gate.reach('https://api.example.com/v1', async () => {
      tries += 1;
      throw refused;
    }, { wait: true })).rejects.toBe(refused);
    expect(tries).toBe(1);
  });

  it('a queue\'s entry that can\'t reach its site waits for it, spending no attempt and holding no slot, then runs', async () => {
    const clock = new VirtualClock();
    const net = network(true);
    const gate = new NetworkGate({ connectivity: net.connectivity, clock, emit: () => undefined });
    const slots = new Semaphore(() => 1);
    const ran: string[] = [];
    const queues = new Map<string, DurableQueue>();
    for (const [id, url] of [['remote', 'https://api.example.com/v1'], ['local', 'http://localhost:5173/api']] as const) {
      const queue = new DurableQueue({
        slots,
        network: gate,
        id,
        config: { ...DEFAULT_QUEUE_CONFIG, concurrency: 1, minIntervalMs: 0, jitterMs: 0 },
        clock,
        random: () => 0,
        emit: () => undefined,
        createId: () => `${id}-id`,
        // As a queue's Web API call is made: without waiting.
        target: (input) => gate.reach(url, async () => {
          ran.push(String(input));
          return input;
        }, { wait: false }),
      });
      queues.set(id, queue);
    }
    net.goOffline();
    queues.get('remote')!.enqueue('a', 'a');
    await settle();
    expect(queues.get('remote')!.status('a')).toMatchObject({ status: 'waiting-retry', attempts: 0, waitingFor: 'https://api.example.com' });

    // Its slot is free for a local site's call meanwhile.
    queues.get('local')!.enqueue('b', 'b');
    await clock.runUntil(() => ran.includes('b'));
    expect(ran).toEqual(['b']);

    net.goOnline();
    await clock.runUntil(() => queues.get('remote')!.status('a')?.status === 'done');
    expect(queues.get('remote')!.status('a')).toMatchObject({ status: 'done', attempts: 1, waitingFor: null });
    expect(ran).toEqual(['b', 'a']);
  });
});
