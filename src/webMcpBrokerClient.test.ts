import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { approveIntegrationWebMcpTool, webMcpCapabilityId, type IntegrationWebMcpToolDescriptor } from './integrationWebMcp';
import { state } from './state';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('./integrationWebMcpRuntime', () => ({
  invokeIntegrationWebMcpTool: invoke,
  assertLiveWebMcpDescriptor: (_approval: unknown, result: { value: unknown }) => result.value,
}));

const browser = vi.hoisted(() => ({
  controlIntegrationBrowser: vi.fn(),
  openIntegrationPage: vi.fn(),
  isIntegrationBrowserOpen: vi.fn(async () => true),
}));
vi.mock('./integrationBrowser', () => browser);
import { handleWebCapabilityIntegrationResult } from './webCapabilityRuntime';
import { handleWebMcpBrokerRequest } from './webMcpBrokerClient';

const savedSettings = state.appSettings;
const savedRegistry = state.integrationRegistry;
const readDescriptor: IntegrationWebMcpToolDescriptor = {
  origin: 'https://example.com',
  name: 'account.read',
  description: 'Read the account.',
  inputSchema: { type: 'object' },
  annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
};
const actionDescriptor: IntegrationWebMcpToolDescriptor = {
  ...readDescriptor,
  name: 'account.update',
  description: 'Update the account.',
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
};

function approval(descriptor: IntegrationWebMcpToolDescriptor, mcpExposed = true) {
  const capabilityId = webMcpCapabilityId('integration', 'page', 'profile', descriptor);
  return approveIntegrationWebMcpTool({}, {
    capabilityId,
    integrationId: 'integration',
    pageId: 'page',
    profileId: 'profile',
    descriptor,
    scriptingEnabled: false,
    mcpExposed,
    approvedAt: '2026-09-04T00:00:00.000Z',
  })[capabilityId];
}

describe('WebMCP MCP broker renderer policy', () => {
  beforeEach(() => {
    invoke.mockReset();
    browser.controlIntegrationBrowser.mockReset();
    browser.openIntegrationPage.mockReset();
    const read = approval(readDescriptor);
    const action = approval(actionDescriptor);
    const hidden = approval({ ...readDescriptor, name: 'hidden.read' }, false);
    state.appSettings = {
      ...savedSettings,
      integrationWebMcpApprovals: {
        [read.capabilityId]: read,
        [action.capabilityId]: action,
        [hidden.capabilityId]: hidden,
      },
    };
    state.integrationRegistry = {
      version: 1,
      profiles: [{ id: 'profile', name: 'Signed-in work', providerId: 'provider', browserStoreId: 'store' }],
      integrations: [{
        id: 'integration',
        name: 'Example',
        profileProviderId: 'provider',
        editable: false,
        pages: [{ id: 'page', name: 'Accounts', url: 'https://example.com/', allowedOrigins: ['https://example.com'], editable: false }],
        actions: [],
      }],
    };
  });

  afterAll(() => {
    state.appSettings = savedSettings;
    state.integrationRegistry = savedRegistry;
  });

  it('lists only explicitly exposed tools with a display label rather than a profile identifier', async () => {
    const result = await handleWebMcpBrokerRequest({ requestId: '1', operation: 'list', integrationAccess: 'read' }) as { tools: Array<Record<string, unknown>> };
    expect(result.tools.map((tool) => tool.name)).toEqual(['account.read', 'account.update']);
    expect(result.tools[0]).toMatchObject({ integration: 'Example', page: 'Accounts', profile: 'Signed-in work' });
    expect(result.tools[0]).not.toHaveProperty('profileId');
  });

  it('enforces read/action policy and resolves the stored profile binding', async () => {
    const action = Object.values(state.appSettings.integrationWebMcpApprovals).find((item) => item.descriptor.name === 'account.update')!;
    await expect(handleWebMcpBrokerRequest({ requestId: '2', operation: 'call', integrationAccess: 'read', capabilityId: action.capabilityId, arguments: {} })).rejects.toThrow('requires MCP integration action access');
    invoke.mockResolvedValue({ value: { updated: true }, isJson: true, descriptor: action.descriptor });
    await expect(handleWebMcpBrokerRequest({ requestId: '3', operation: 'call', integrationAccess: 'actions', capabilityId: action.capabilityId, arguments: { id: '42' }, profileId: 'attacker-selected' } as never)).resolves.toMatchObject({ value: { updated: true }, resultIsJson: true });
    expect(invoke.mock.calls[0][2].id).toBe('profile');
  });

  it('discovers and fetches configured page records without an HVY document or website WebMCP tools', async () => {
    const integration = state.integrationRegistry.integrations[0];
    integration.actions = [{
      id: 'messages', integrationId: integration.id, name: 'Messages', description: 'Inbox records',
      pageIds: ['page'], script: 'structural-pattern-v1', resultSchema: {}, permissions: ['dom:read'], version: 1,
      pattern: { recordLabel: 'Message', minimumConfidence: 0.8, parents: [], fields: [] },
    }];
    const discovery = await handleWebMcpBrokerRequest({ requestId: 'records-list', operation: 'list-records', integrationAccess: 'read' });
    expect(discovery).toMatchObject({
      definitions: [{ integrationId: 'integration', actionId: 'messages', pageId: 'page', name: 'Messages' }],
      profiles: [{ id: 'profile', name: 'Signed-in work' }],
    });
    browser.controlIntegrationBrowser.mockImplementation(async (command, _profile, payload) => {
      handleWebCapabilityIntegrationResult(command === 'check-page-ready'
        ? { kind: 'integration-page-readiness', context: payload.context, ready: true }
        : { kind: 'integration-extraction', context: payload.context, records: [{ subject: 'Live message' }], page: { origin: 'https://example.com', pathname: '/inbox' } });
    });
    const request = { requestId: 'records-fetch', operation: 'fetch-records' as const, integrationAccess: 'read' as const, integrationId: 'integration', actionId: 'messages', profileId: 'profile' };
    await expect(handleWebMcpBrokerRequest(request)).resolves.toMatchObject({ records: [{ subject: 'Live message' }], page: { pathname: '/inbox' } });
    expect(browser.controlIntegrationBrowser.mock.calls.map((call) => call[0])).toEqual(['check-page-ready', 'extract-pattern']);
    expect(browser.openIntegrationPage).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    await expect(handleWebMcpBrokerRequest({ ...request, integrationAccess: 'off' })).rejects.toThrow('disabled');
    await expect(handleWebMcpBrokerRequest({ ...request, pageId: 'wrong-page' })).rejects.toThrow('unavailable');
    await expect(handleWebMcpBrokerRequest({ ...request, profileId: 'missing' })).rejects.toThrow('browser profile');
  });

  it('rejects disabled access, unexposed tools, and non-object arguments', async () => {
    const hidden = Object.values(state.appSettings.integrationWebMcpApprovals).find((item) => item.descriptor.name === 'hidden.read')!;
    const read = Object.values(state.appSettings.integrationWebMcpApprovals).find((item) => item.descriptor.name === 'account.read')!;
    await expect(handleWebMcpBrokerRequest({ requestId: '4', operation: 'list', integrationAccess: 'off' })).rejects.toThrow('disabled');
    await expect(handleWebMcpBrokerRequest({ requestId: '5', operation: 'call', integrationAccess: 'actions', capabilityId: hidden.capabilityId, arguments: {} })).rejects.toThrow('not exposed');
    await expect(handleWebMcpBrokerRequest({ requestId: '6', operation: 'call', integrationAccess: 'read', capabilityId: read.capabilityId, arguments: [] } as never)).rejects.toThrow('JSON object');
  });
});
