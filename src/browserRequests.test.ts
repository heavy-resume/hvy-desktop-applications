import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerBrowserRequest, browserClosed, IntegrationBrowserClosedError, requestFromBrowser, waitForBrowserAnswer } from './browserRequests';

afterEach(() => {
  vi.useRealTimers();
});

/** Sends nothing, handing the request's id back so the test can answer it as the page would. */
function sent() {
  let requestId = '';
  return { send: async (id: string) => { requestId = id; }, id: () => requestId };
}

describe('requests of a browser window', () => {
  it('is answered by the page\'s result carrying its id, in the result\'s context or as a command\'s requestId', async () => {
    const preview = sent();
    const request = requestFromBrowser({ profileId: 'p', accepts: (result) => result.kind === 'integration-extraction', answer: (result) => result.records }, preview.send);
    await vi.waitFor(() => expect(preview.id()).not.toBe(''));

    // A result of another kind with the same id is left for whoever it is for.
    expect(answerBrowserRequest({ kind: 'integration-page-readiness', context: { browserRequestId: preview.id() } })).toBe(false);
    expect(answerBrowserRequest({ kind: 'integration-extraction', context: { browserRequestId: preview.id() }, records: ['one'] })).toBe(true);
    await expect(request).resolves.toEqual(['one']);
    // It is answered once: a second answer is no one's.
    expect(answerBrowserRequest({ kind: 'integration-extraction', context: { browserRequestId: preview.id() } })).toBe(false);

    const command = waitForBrowserAnswer('command-1', { profileId: 'p', answer: (result) => result.status });
    expect(answerBrowserRequest({ kind: 'integration-command-result', requestId: 'command-1', status: 'executed' })).toBe(true);
    await expect(command).resolves.toBe('executed');
  });

  it('fails with the answer\'s own error when reading it throws', async () => {
    const request = waitForBrowserAnswer('r', { profileId: 'p', answer: () => { throw new Error('The page is not ready.'); } });
    expect(answerBrowserRequest({ kind: 'any', requestId: 'r' })).toBe(true);
    await expect(request).rejects.toThrow('The page is not ready.');
  });

  it('fails every request waiting on a window when it closes, and only that window\'s', async () => {
    const first = waitForBrowserAnswer('a', { profileId: 'closing', answer: () => 'a' });
    const second = waitForBrowserAnswer('b', { profileId: 'closing', answer: () => 'b' });
    const other = waitForBrowserAnswer('c', { profileId: 'open', answer: () => 'c' });

    browserClosed('closing');

    await expect(first).rejects.toBeInstanceOf(IntegrationBrowserClosedError);
    await expect(second).rejects.toThrow('The browser window was closed.');
    expect(answerBrowserRequest({ requestId: 'c' })).toBe(true);
    await expect(other).resolves.toBe('c');
  });

  it('fails when it can\'t be sent', async () => {
    const request = requestFromBrowser({ profileId: 'p', answer: () => 'never' }, async () => { throw new Error('Open the integration browser first.'); });
    await expect(request).rejects.toThrow('Open the integration browser first.');
  });

  it('stops the page\'s work on a time limit or a stop, but not when the window closed', async () => {
    vi.useFakeTimers();
    const onStop = vi.fn();
    const timed = waitForBrowserAnswer('t', { profileId: 'p', answer: () => null, timeoutMs: 1000, timeoutMessage: 'Too slow.', onStop });
    const rejection = expect(timed).rejects.toThrow('Too slow.');
    await vi.advanceTimersByTimeAsync(1000);
    await rejection;
    expect(onStop).toHaveBeenCalledOnce();

    const controller = new AbortController();
    const stopped = waitForBrowserAnswer('s', { profileId: 'p', answer: () => null, signal: controller.signal, onStop });
    controller.abort(new Error('Stopped by the person.'));
    await expect(stopped).rejects.toThrow('Stopped by the person.');
    expect(onStop).toHaveBeenCalledTimes(2);

    const closed = waitForBrowserAnswer('x', { profileId: 'p', answer: () => null, timeoutMs: 1000, onStop });
    browserClosed('p');
    await expect(closed).rejects.toBeInstanceOf(IntegrationBrowserClosedError);
    // Its time limit ended with it.
    await vi.advanceTimersByTimeAsync(1000);
    expect(onStop).toHaveBeenCalledTimes(2);
  });
});
