import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IntegrationProfileDefinition } from './integrationRegistry';
import type { WebRecordsCapabilityConfig } from './webCapabilities';

const { controlIntegrationBrowser, openIntegrationPage } = vi.hoisted(() => ({
  controlIntegrationBrowser: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
  openIntegrationPage: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
}));

vi.mock('./integrationBrowser', () => ({ controlIntegrationBrowser, openIntegrationPage }));
vi.mock('./webCapabilities', async (importOriginal) => ({
  ...await importOriginal<typeof import('./webCapabilities')>(),
  isWebCapabilityAuthorized: () => true,
}));

import {
  executeWebRecordCommandCapability,
  executeWebRecordsCapability,
  handleWebCapabilityIntegrationResult,
} from './webCapabilityRuntime';

const config = {
  schemaVersion: 1,
  capabilityId: 'records',
  name: 'Records',
  description: '',
  page: {
    name: 'Inbox',
    url: 'https://example.com/inbox',
    allowedOrigins: ['https://example.com'],
    readyChecks: { urlMode: 'strict-url', urlValue: 'https://example.com/inbox', elements: [] },
  },
  record: {
    id: 'messages',
    name: 'Messages',
    version: 1,
    resultSchema: {},
    permissions: ['dom:read'],
    pattern: { minimumConfidence: 0.85, parents: [], targets: [] },
    commands: [],
    limit: 25,
    scrollPage: true,
  },
  mcp: { exposeRead: true, commandIds: [] },
} as WebRecordsCapabilityConfig;

const profile = {
  id: 'profile',
  name: 'Profile',
  browserStoreId: 'store',
} as IntegrationProfileDefinition;

function executionContext(foreground: boolean) {
  return { documentPath: '/document.hvy', profile, authorizations: {}, foreground };
}

afterEach(() => {
  vi.useRealTimers();
  openIntegrationPage.mockClear();
  controlIntegrationBrowser.mockClear();
});

describe('web capability operation timeouts', () => {
  it('allows an interactive fetch enough time to complete a sign-in redirect', async () => {
    vi.useFakeTimers();
    const operation = executeWebRecordsCapability(config, executionContext(true));
    await vi.waitFor(() => expect(openIntegrationPage).toHaveBeenCalledOnce());
    const extraction = openIntegrationPage.mock.calls[0][5] as { context: { webCapabilityRequestId: string } };

    expect(extraction).toMatchObject({ pattern: { recordLimit: 25, scrollPage: true } });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(handleWebCapabilityIntegrationResult({
      kind: 'integration-extraction',
      context: { webCapabilityRequestId: extraction.context.webCapabilityRequestId },
      records: [{ value: 'signed in' }],
    })).toBe(true);

    await expect(operation).resolves.toEqual({ records: [{ value: 'signed in' }] });
  });

  it('retains the shorter timeout for unattended background fetches', async () => {
    vi.useFakeTimers();
    const operation = executeWebRecordsCapability(config, executionContext(false));
    await vi.waitFor(() => expect(openIntegrationPage).toHaveBeenCalledOnce());
    const rejection = expect(operation).rejects.toThrow('The web capability timed out while waiting for the page.');

    await vi.advanceTimersByTimeAsync(60_000);

    await rejection;
  });

  it('reports a failed ready check instead of treating the interstitial as an empty result', async () => {
    const operation = executeWebRecordsCapability(config, executionContext(true));
    await vi.waitFor(() => expect(openIntegrationPage).toHaveBeenCalledOnce());
    const extraction = openIntegrationPage.mock.calls[0][5] as { context: { webCapabilityRequestId: string } };
    const rejection = expect(operation).rejects.toThrow('The browser is not at the exact configured URL.');

    expect(handleWebCapabilityIntegrationResult({
      kind: 'integration-extraction',
      status: 'not-ready',
      message: 'The browser is not at the exact configured URL.',
      context: { webCapabilityRequestId: extraction.context.webCapabilityRequestId },
      records: [],
    })).toBe(true);

    await rejection;
  });

  it('stops a pending record fetch and cancels extraction in the browser', async () => {
    const controller = new AbortController();
    const operation = executeWebRecordsCapability(config, { ...executionContext(true), signal: controller.signal });
    await vi.waitFor(() => expect(openIntegrationPage).toHaveBeenCalledOnce());

    controller.abort(new Error('The fetch was stopped.'));

    await expect(operation).rejects.toThrow('The fetch was stopped.');
    expect(controlIntegrationBrowser).toHaveBeenCalledWith('cancel-extraction', profile.id);
  });
});

it('delivers a watched record change after the command itself completes', async () => {
  const onRecordChange = vi.fn();
  const commandConfig = {
    ...config,
    record: {
      ...config.record,
      commands: [{ id: 'archive', name: 'Archive', scope: 'record', steps: [{ gesture: 'click', target: {} }] }],
    },
  } as WebRecordsCapabilityConfig;
  const operation = executeWebRecordCommandCapability(
    commandConfig,
    'archive',
    '#message-1',
    executionContext(true),
    {},
    '[["Subject","Message 1"]]',
    onRecordChange,
  );
  await vi.waitFor(() => expect(openIntegrationPage).toHaveBeenCalledOnce());
  const extraction = openIntegrationPage.mock.calls[0][5] as {
    payload: { requestId: string; watchRecord: boolean; recordParent: string };
  };
  expect(extraction.payload).toMatchObject({
    watchRecord: true,
    recordParent: '#message-1',
    recordIdentity: '[["Subject","Message 1"]]',
  });

  expect(handleWebCapabilityIntegrationResult({
    kind: 'integration-command-result',
    requestId: extraction.payload.requestId,
    status: 'executed',
    commandId: 'archive',
  })).toBe(true);
  await expect(operation).resolves.toEqual({ status: 'executed', commandId: 'archive' });
  expect(onRecordChange).not.toHaveBeenCalled();

  const recordChange = { status: 'removed', previousParent: '#message-1' };
  expect(handleWebCapabilityIntegrationResult({
    kind: 'integration-record-watch-result',
    requestId: extraction.payload.requestId,
    recordChange,
  })).toBe(true);
  expect(onRecordChange).toHaveBeenCalledWith(recordChange);
});
