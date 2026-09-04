import { describe, expect, it } from 'vitest';
import {
  approvalMatchesDescriptor,
  approveIntegrationWebMcpTool,
  normalizeIntegrationWebMcpApprovals,
  normalizeWebMcpToolDescriptor,
  webMcpCapabilityId,
  webMcpDescriptorHash,
  webMcpToolsForContext,
  type IntegrationWebMcpToolDescriptor,
} from './integrationWebMcp';

const descriptor: IntegrationWebMcpToolDescriptor = {
  origin: 'https://example.com',
  name: 'account.lookup',
  title: 'Look up account',
  description: 'Returns account details.',
  inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
};

describe('WebMCP approvals', () => {
  it('normalizes descriptors and accepts trustworthy local fixture origins', () => {
    expect(normalizeWebMcpToolDescriptor({ ...descriptor, origin: 'http://127.0.0.1:4312/path' })?.origin).toBe('http://127.0.0.1:4312');
    expect(normalizeWebMcpToolDescriptor({ ...descriptor, origin: 'http://example.com' })).toBeNull();
    expect(normalizeWebMcpToolDescriptor({ ...descriptor, name: 'invalid name' })).toBeNull();
  });

  it('preserves an optional structured output schema', () => {
    const outputSchema = { type: 'object', properties: { items: { type: 'array' } } };
    expect(normalizeWebMcpToolDescriptor({ ...descriptor, outputSchema })?.outputSchema).toEqual(outputSchema);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(normalizeWebMcpToolDescriptor({ ...descriptor, outputSchema: circular })).toBeNull();
  });

  it('hashes descriptors deterministically regardless of object key order', () => {
    const reordered = {
      annotations: { consequentialHint: false, untrustedContentHint: true, readOnlyHint: true },
      inputSchema: { required: ['id'], properties: { id: { type: 'string' } }, type: 'object' },
      description: descriptor.description,
      title: descriptor.title,
      name: descriptor.name,
      origin: descriptor.origin,
    } as IntegrationWebMcpToolDescriptor;
    expect(webMcpDescriptorHash(reordered)).toBe(webMcpDescriptorHash(descriptor));
  });

  it('binds approval to the integration page and profile while keeping its ID stable across review changes', () => {
    const capabilityId = webMcpCapabilityId('integration', 'page', 'profile-a', descriptor);
    const changed = { ...descriptor, description: 'Changed description.' };
    expect(webMcpCapabilityId('integration', 'page', 'profile-a', changed)).toBe(capabilityId);
    expect(webMcpCapabilityId('integration', 'page', 'profile-b', descriptor)).not.toBe(capabilityId);
    const approvals = approveIntegrationWebMcpTool({}, {
      capabilityId,
      integrationId: 'integration',
      pageId: 'page',
      profileId: 'profile-a',
      descriptor,
      scriptingEnabled: true,
      mcpExposed: false,
      approvedAt: '2026-09-03T00:00:00.000Z',
    });
    expect(approvalMatchesDescriptor(approvals[capabilityId], descriptor)).toBe(true);
    expect(approvalMatchesDescriptor(approvals[capabilityId], changed)).toBe(false);
    expect(approvalMatchesDescriptor(approvals[capabilityId], { ...descriptor, inputSchema: { type: 'object' } })).toBe(false);
    expect(approvalMatchesDescriptor(approvals[capabilityId], { ...descriptor, annotations: { ...descriptor.annotations, consequentialHint: true } })).toBe(false);
  });

  it('recomputes saved hashes and rejects non-JSON schemas', () => {
    const capabilityId = webMcpCapabilityId('integration', 'page', 'profile', descriptor);
    const approvals = normalizeIntegrationWebMcpApprovals({
      [capabilityId]: {
        capabilityId,
        integrationId: 'integration',
        pageId: 'page',
        profileId: 'profile',
        descriptor,
        descriptorHash: 'forged',
        scriptingEnabled: true,
        mcpExposed: true,
        approvedAt: '2026-09-03T00:00:00.000Z',
      },
    });
    expect(approvals[capabilityId].descriptorHash).toBe(webMcpDescriptorHash(descriptor));
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(normalizeWebMcpToolDescriptor({ ...descriptor, inputSchema: circular })).toBeNull();
  });

  it('restores reviewed tools for their page and profile until a fresh scan replaces them', () => {
    const capabilityId = webMcpCapabilityId('integration', 'page', 'profile-a', descriptor);
    const approvals = approveIntegrationWebMcpTool({}, {
      capabilityId,
      integrationId: 'integration',
      pageId: 'page',
      profileId: 'profile-a',
      descriptor,
      scriptingEnabled: true,
      mcpExposed: true,
    });
    expect(webMcpToolsForContext(approvals, 'integration', 'page', 'profile-a')).toEqual([descriptor]);
    expect(webMcpToolsForContext(approvals, 'integration', 'page', 'profile-b')).toEqual([]);
    expect(webMcpToolsForContext(approvals, 'integration', 'page', 'profile-a', [])).toEqual([]);
  });
});
