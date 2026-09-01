import { describe, expect, it, vi } from 'vitest';
import { RecoveryDraftWrites } from './recoveryDraftWrites';

describe('RecoveryDraftWrites', () => {
  it('does not settle while a recovery draft write is still in flight', async () => {
    let finishWrite!: () => void;
    const writes = new RecoveryDraftWrites();
    const write = writes.run(() => new Promise<void>((resolve) => {
      finishWrite = resolve;
    }));
    const settled = vi.fn();
    const settling = writes.settle().then(settled);

    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    finishWrite();
    await write;
    await settling;
    expect(settled).toHaveBeenCalledOnce();
  });
});
