import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { approveIntegrationWebMcpTool, webMcpCapabilityId, type IntegrationWebMcpToolDescriptor } from '../integrationWebMcp';
import { state } from '../state';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../integrationWebMcpRuntime', () => ({
  invokeIntegrationWebMcpTool: invoke,
  assertLiveWebMcpDescriptor: (_approval: unknown, result: { value: unknown }) => result.value,
}));

import { webMcpToolPlugin } from './webMcpTool';

const savedSettings = state.appSettings;
const savedRegistry = state.integrationRegistry;
const descriptor: IntegrationWebMcpToolDescriptor = {
  origin: 'https://example.com',
  name: 'account.read',
  description: 'Read the account.',
  inputSchema: { type: 'object' },
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
};
const capabilityId = webMcpCapabilityId('integration', 'page', 'profile', descriptor);

function scriptInvoke(args: Record<string, unknown>, rawDocument: object): unknown {
  return webMcpToolPlugin.scripting!.methods.invoke(args, { rawDocument } as never);
}

describe('WebMCP HVY scripting', () => {
  beforeEach(() => {
    invoke.mockReset();
    state.appSettings = {
      ...savedSettings,
      integrationWebMcpApprovals: approveIntegrationWebMcpTool({}, {
        capabilityId,
        integrationId: 'integration',
        pageId: 'page',
        profileId: 'profile',
        descriptor,
        scriptingEnabled: true,
        mcpExposed: false,
        approvedAt: '2026-09-04T00:00:00.000Z',
      }),
    };
    state.integrationRegistry = {
      version: 1,
      profiles: [{ id: 'profile', name: 'Personal', providerId: 'provider', browserStoreId: 'store' }],
      integrations: [{ id: 'integration', name: 'Example', profileProviderId: 'provider', editable: false, pages: [{ id: 'page', name: 'Account', url: 'https://example.com/', allowedOrigins: ['https://example.com'], editable: false }], actions: [] }],
    };
  });

  afterAll(() => {
    state.appSettings = savedSettings;
    state.integrationRegistry = savedRegistry;
  });

  it('returns a queued job immediately for callback scripting', async () => {
    invoke.mockResolvedValue({ value: { answer: 42 }, descriptor });
    const onComplete = vi.fn();
    const job = scriptInvoke({ capabilityId, arguments: { id: '42' }, on_complete: onComplete }, {}) as { jobId: string; status: string };
    expect(job).toMatchObject({ status: 'queued' });
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledWith({ jobId: job.jobId, status: 'completed', result: { answer: 42 } }));
  });

  it('returns an awaitable result for Power Scripting', async () => {
    invoke.mockResolvedValue({ value: 'done', descriptor });
    await expect(scriptInvoke({ capabilityId, arguments: {} }, {})).resolves.toBe('done');
  });

  it('cancels pending work when the HVY document unloads', async () => {
    let capturedSignal: AbortSignal | undefined;
    invoke.mockImplementation((_approval, _page, _profile, _args, _foreground, signal: AbortSignal) => {
      capturedSignal = signal;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    });
    const oldDocument = {};
    const documentLoad = webMcpToolPlugin.hooks!.documentLoad!;
    if (Array.isArray(documentLoad)) throw new Error('Expected one WebMCP document-load hook.');
    documentLoad.run({ document: oldDocument } as never);
    const operation = scriptInvoke({ capabilityId, arguments: {} }, oldDocument) as Promise<unknown>;
    documentLoad.run({ document: {} } as never);
    await expect(operation).rejects.toThrow('HVY document was unloaded');
    expect(capturedSignal?.aborted).toBe(true);
  });
});
