import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntegrationPageDefinition, IntegrationProfileDefinition } from './integrationRegistry';
import { approveIntegrationWebMcpTool, type IntegrationWebMcpToolDescriptor } from './integrationWebMcp';

const openIntegrationPage = vi.hoisted(() => vi.fn());
const isIntegrationBrowserOpen = vi.hoisted(() => vi.fn());
const controlIntegrationBrowser = vi.hoisted(() => vi.fn());

vi.mock('./integrationBrowser', () => ({
  openIntegrationPage,
  isIntegrationBrowserOpen,
  controlIntegrationBrowser,
}));

import { discoverIntegrationWebMcpTools, handleIntegrationWebMcpResult, invokeIntegrationWebMcpTool } from './integrationWebMcpRuntime';

const descriptor: IntegrationWebMcpToolDescriptor = {
  origin: 'https://example.com',
  name: 'items.read',
  description: 'Read items.',
  inputSchema: { type: 'object' },
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
};

const approval = approveIntegrationWebMcpTool({}, {
  capabilityId: 'capability',
  integrationId: 'integration',
  pageId: 'page',
  profileId: 'profile',
  descriptor,
  scriptingEnabled: false,
  mcpExposed: false,
  approvedAt: '2026-09-04T00:00:00.000Z',
}).capability;

const page: IntegrationPageDefinition = {
  id: 'page',
  name: 'Example',
  url: 'https://example.com/',
  allowedOrigins: ['https://example.com'],
  editable: true,
};

const profile: IntegrationProfileDefinition = {
  id: 'profile',
  name: 'Personal',
  providerId: 'browser',
  browserStoreId: 'store',
};

describe('WebMCP runtime fresh-page invocation', () => {
  beforeEach(() => {
    openIntegrationPage.mockReset().mockResolvedValue(undefined);
    isIntegrationBrowserOpen.mockReset().mockResolvedValue(false);
    controlIntegrationBrowser.mockReset().mockResolvedValue(undefined);
  });

  it('asks a newly opened page to wait for its selected tool to register', async () => {
    const result = invokeIntegrationWebMcpTool(approval, page, profile, { query: 'new document' }, true);
    await vi.waitFor(() => expect(openIntegrationPage).toHaveBeenCalledOnce());
    const extraction = openIntegrationPage.mock.calls[0][5] as {
      kind: string;
      payload: { requestId: string; waitForTools: boolean; focusMainOnResult: boolean };
    };
    expect(extraction).toMatchObject({
      kind: 'webmcp-invocation',
      payload: { waitForTools: true, focusMainOnResult: true },
    });
    expect(handleIntegrationWebMcpResult({
      kind: 'integration-webmcp-result',
      requestId: extraction.payload.requestId,
      value: { items: [] },
      isJson: true,
      descriptor,
      page: { origin: 'https://example.com', pathname: '/' },
    })).toBe(true);
    await expect(result).resolves.toMatchObject({ value: { items: [] }, descriptor });
  });

  it('navigates an existing profile to the configured page before scanning tools', async () => {
    isIntegrationBrowserOpen.mockResolvedValue(true);
    const result = discoverIntegrationWebMcpTools(page, profile);
    await vi.waitFor(() => expect(openIntegrationPage).toHaveBeenCalledOnce());
    expect(openIntegrationPage).toHaveBeenCalledWith(
      page.url,
      page.allowedOrigins,
      profile.id,
      profile.browserStoreId,
      false,
      expect.objectContaining({
        kind: 'webmcp-discovery',
        payload: expect.objectContaining({ waitForTools: true }),
      }),
      false,
      profile.name,
    );
    expect(controlIntegrationBrowser).not.toHaveBeenCalledWith('discover-webmcp-tools', profile.id, expect.anything());
    const extraction = openIntegrationPage.mock.calls[0][5] as { payload: { requestId: string } };
    expect(handleIntegrationWebMcpResult({
      kind: 'integration-webmcp-tools',
      requestId: extraction.payload.requestId,
      tools: [descriptor],
      page: { origin: 'https://example.com', pathname: '/' },
    })).toBe(true);
    await expect(result).resolves.toEqual([descriptor]);
  });

  it('navigates an existing profile to the approved page before invoking a tool', async () => {
    isIntegrationBrowserOpen.mockResolvedValue(true);
    const result = invokeIntegrationWebMcpTool(approval, page, profile, {}, false, undefined, false);
    await vi.waitFor(() => expect(openIntegrationPage).toHaveBeenCalledOnce());
    const extraction = openIntegrationPage.mock.calls[0][5] as { payload: { requestId: string } };
    expect(handleIntegrationWebMcpResult({
      kind: 'integration-webmcp-result',
      requestId: extraction.payload.requestId,
      value: { items: [] },
      isJson: true,
      descriptor,
      page: { origin: 'https://example.com', pathname: '/' },
    })).toBe(true);
    await expect(result).resolves.toMatchObject({ value: { items: [] }, descriptor });
  });

});
