import { describe, expect, it } from 'vitest';
import { enqueueWebCapabilityForProfile } from './webCapabilityQueue';

describe('per-profile web capability queue', () => {
  it('serializes work within a profile while allowing different profiles to run concurrently', async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = enqueueWebCapabilityForProfile('profile-a', async () => {
      events.push('a1-start');
      await firstGate;
      events.push('a1-end');
    });
    const second = enqueueWebCapabilityForProfile('profile-a', async () => { events.push('a2'); });
    const other = enqueueWebCapabilityForProfile('profile-b', async () => { events.push('b1'); });
    await other;
    expect(events).toEqual(['a1-start', 'b1']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['a1-start', 'b1', 'a1-end', 'a2']);
  });
});
