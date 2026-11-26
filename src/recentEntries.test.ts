import { createRequire } from 'node:module';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { RECENT_LIMIT, pushRecent } = require('../src-electron/recent-entries.cjs') as {
  RECENT_LIMIT: number;
  pushRecent(entries: string[], entryPath: string): string[];
};

// The recent tabs strip shows File > Recent Files in this order, so the Electron backend must list newest first.
describe('Electron recent entries', () => {
  it('lists newest first and moves a reopened entry to the front', () => {
    let recent: string[] = [];
    for (const name of ['a.hvy', 'b.hvy', 'c.hvy', 'a.hvy']) {
      recent = pushRecent(recent, join('/docs', name));
    }

    expect(recent.map((entry) => basename(entry))).toEqual(['a.hvy', 'c.hvy', 'b.hvy']);
  });

  it('drops the oldest past the limit', () => {
    let recent: string[] = [];
    for (let index = 0; index <= RECENT_LIMIT; index += 1) {
      recent = pushRecent(recent, join('/docs', `${index}.hvy`));
    }

    expect(recent).toHaveLength(RECENT_LIMIT);
    expect(basename(recent[0])).toBe(`${RECENT_LIMIT}.hvy`);
    expect(recent.map((entry) => basename(entry))).not.toContain('0.hvy');
  });
});
