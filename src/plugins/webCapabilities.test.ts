import { describe, expect, test, vi } from 'vitest';
import { queueWebCapabilityScriptOperation } from './webCapabilityScripting';

describe('web capability scripting callbacks', () => {
  test('returns synchronously and invokes on_complete after queued work settles', async () => {
    let resolveOperation!: (value: unknown) => void;
    const operation = new Promise((resolve) => {
      resolveOperation = resolve;
    });
    const onComplete = vi.fn();

    const queued = queueWebCapabilityScriptOperation(
      () => operation,
      { onComplete, onError: null },
    );

    expect(queued).toMatchObject({ status: 'queued' });
    expect(queued.jobId).toEqual(expect.any(String));
    expect(onComplete).not.toHaveBeenCalled();

    resolveOperation({ records: [{ values: { Subject: 'Hello' } }] });
    await operation;
    await Promise.resolve();

    expect(onComplete).toHaveBeenCalledWith({
      jobId: queued.jobId,
      status: 'completed',
      result: { records: [{ values: { Subject: 'Hello' } }] },
    });
  });

  test('invokes on_error for a failed queued operation', async () => {
    const onComplete = vi.fn();
    const onError = vi.fn();
    const operation = Promise.reject(new Error('Page unavailable'));

    const queued = queueWebCapabilityScriptOperation(
      () => operation,
      { onComplete, onError },
    );

    await operation.catch(() => undefined);
    await Promise.resolve();

    expect(onComplete).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith({
      jobId: queued.jobId,
      status: 'failed',
      error: 'Page unavailable',
    });
  });

  test('reports failure through on_complete when no error callback is supplied', async () => {
    const onComplete = vi.fn();
    const operation = Promise.reject(new Error('No matching control'));

    const queued = queueWebCapabilityScriptOperation(
      () => operation,
      { onComplete, onError: null },
    );

    await operation.catch(() => undefined);
    await Promise.resolve();

    expect(onComplete).toHaveBeenCalledWith({
      jobId: queued.jobId,
      status: 'failed',
      error: 'No matching control',
    });
  });
});
