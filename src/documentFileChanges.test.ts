import { describe, expect, it, vi } from 'vitest';
import { DocumentFileChanges } from './documentFileChanges';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('external document changes', () => {
  it('detects changes, keeps them pending across tab switches, and acknowledges dismissal', async () => {
    const changes = new DocumentFileChanges();
    await changes.remember('/test.hvy', bytes('original'));
    const read = vi.fn(async () => bytes('MCP edit'));
    const stamp = async () => 'changed';
    expect(await changes.check('/test.hvy', stamp, read)).toBe(true);
    expect(await changes.check('/test.hvy', stamp, read)).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
    changes.dismiss('/test.hvy');
    expect(await changes.check('/test.hvy', stamp, read)).toBe(false);
    expect(await changes.check('/test.hvy', async () => 'changed-again', async () => bytes('another edit'))).toBe(true);
  });

  it('ignores metadata-only changes and application saves', async () => {
    const changes = new DocumentFileChanges();
    await changes.remember('/test.hvy', bytes('original'));
    expect(await changes.check('/test.hvy', async () => 'touched', async () => bytes('original'))).toBe(false);
    await changes.remember('/test.hvy', bytes('saved'));
    expect(await changes.check('/test.hvy', async () => 'saved', async () => bytes('saved'))).toBe(false);
  });

  it('does not replace a cached tab baseline when reopened', async () => {
    const changes = new DocumentFileChanges();
    await changes.remember('/test.hvy', bytes('original'));
    await changes.remember('/test.hvy', bytes('external'), false);
    expect(await changes.check('/test.hvy', async () => 'new', async () => bytes('external'))).toBe(true);
  });

  it('ignores a disk read overtaken by an application save', async () => {
    const changes = new DocumentFileChanges();
    await changes.remember('/test.hvy', bytes('original'));
    let finishRead!: (value: Uint8Array) => void;
    const reading = changes.check('/test.hvy', async () => 'external', () => new Promise((resolve) => { finishRead = resolve; }));
    await Promise.resolve();
    await changes.remember('/test.hvy', bytes('saved'));
    finishRead(bytes('external'));
    expect(await reading).toBe(false);
    expect(await changes.check('/test.hvy', async () => 'saved', async () => bytes('saved'))).toBe(false);
  });

  it('retries after a temporarily missing file', async () => {
    const changes = new DocumentFileChanges();
    await changes.remember('/test.hvy', bytes('original'));
    await expect(changes.check('/test.hvy', async () => { throw new Error('missing'); }, async () => bytes('external'))).rejects.toThrow('missing');
    expect(await changes.check('/test.hvy', async () => 'replaced', async () => bytes('external'))).toBe(true);
  });
});
