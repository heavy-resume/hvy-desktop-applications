import { describe, expect, it } from 'vitest';
import { state } from '../state';
import { approveIntegrationWebMcpTool, webMcpCapabilityId, type IntegrationWebMcpToolDescriptor } from '../integrationWebMcp';
import { renderIntegrationPageErrorDialog, renderIntegrationsDialog, renderIntegrationWebMcpInvokeDialog, renderIntegrationWebMcpResultDialog, renderIntegrationWebMcpReviewDialog } from './render-integrations';

describe('integration page errors', () => {
  it('renders validation failures as an explicit modal', () => {
    const html = renderIntegrationPageErrorDialog({ ...state, integrationPageError: 'Use a valid local page.' });
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('Couldn’t add web page');
    expect(html).toContain('Use a valid local page.');
    expect(html).toContain('data-action="close-integration-page-error"');
  });
});

describe('WebMCP result dialog', () => {
  it('keeps the result payload in a bounded viewport with a separate action row', () => {
    const html = renderIntegrationWebMcpResultDialog({
      ...state,
      integrationWebMcpResultOpen: true,
      integrationWebMcpResult: { value: 'a'.repeat(1_000) },
    });
    expect(html).toContain('integration-webmcp-result-dialog');
    expect(html).toContain('integration-webmcp-result-payload');
    expect(html).toContain('dialog-actions integration-webmcp-result-actions');
    expect(html).toContain('data-action="close-webmcp-result"');
  });

  it('offers a read-only structured result as a record type and renders collection choices', () => {
    const profile = state.integrationRegistry.profiles[0];
    const integrationId = 'integration';
    const pageId = 'page';
    const descriptor: IntegrationWebMcpToolDescriptor = {
      origin: 'https://example.com', name: 'items.read', title: 'Items', description: 'Read items.',
      inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
    };
    const capabilityId = webMcpCapabilityId(integrationId, pageId, profile.id, descriptor);
    const approvals = approveIntegrationWebMcpTool({}, {
      capabilityId, integrationId, pageId, profileId: profile.id, descriptor, scriptingEnabled: false, mcpExposed: false,
    });
    const html = renderIntegrationWebMcpResultDialog({
      ...state,
      appSettings: { ...state.appSettings, integrationWebMcpApprovals: approvals },
      integrationWebMcpResultOpen: true,
      integrationWebMcpResultCapabilityId: capabilityId,
      integrationWebMcpResult: { items: [{ id: 'one', title: 'First' }] },
      integrationWebMcpRecordBuilderOpen: true,
    });
    expect(html).toContain('data-action="request-save-webmcp-record-type"');
    expect(html).toContain('data-form="save-webmcp-record-type"');
    expect(html).toContain('name="recordsPath" value="/items" data-action="select-webmcp-record-path" checked');
    expect(html).toContain('id, title');
    expect(html).toContain('<input type="checkbox" name="recordField" value="id" checked>');
    expect(html).toContain('name="fieldLabel:title" value="title"');
  });

  it('does not offer plain text or consequential results as record types', () => {
    const html = renderIntegrationWebMcpResultDialog({
      ...state,
      integrationWebMcpResultOpen: true,
      integrationWebMcpResult: 'Done',
    });
    expect(html).not.toContain('request-save-webmcp-record-type');
  });
});

describe('WebMCP record types', () => {
  it('renders a saved source as fetchable records without DOM item commands', () => {
    const profile = state.integrationRegistry.profiles[0];
    const descriptor: IntegrationWebMcpToolDescriptor = {
      origin: 'https://example.com', name: 'items.read', title: 'Items', description: 'Read items.',
      inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
    };
    const capabilityId = webMcpCapabilityId('integration', 'page', profile.id, descriptor);
    const approvals = approveIntegrationWebMcpTool({}, {
      capabilityId, integrationId: 'integration', pageId: 'page', profileId: profile.id, descriptor, scriptingEnabled: false, mcpExposed: false,
    });
    const html = renderIntegrationsDialog({
      ...state,
      integrationsDialogOpen: true,
      selectedIntegrationId: 'integration',
      selectedIntegrationProfileId: profile.id,
      appSettings: { ...state.appSettings, integrationWebMcpApprovals: approvals },
      integrationRegistry: {
        version: 1,
        profiles: [profile],
        integrations: [{
          id: 'integration', name: 'Example', profileProviderId: 'browser', editable: true,
          pages: [{ id: 'page', name: 'Example', url: 'https://example.com/', allowedOrigins: ['https://example.com'], editable: true }],
          actions: [{
            id: 'records', integrationId: 'integration', name: 'Saved items', description: '', pageIds: ['page'],
            script: 'webmcp-record-source-v1', resultSchema: {}, permissions: [], version: 1,
            source: { kind: 'webmcp', capabilityId, arguments: {}, recordsPath: '/items', fields: [{ name: 'id', label: 'id' }] },
          }],
        }],
      },
    });
    expect(html).toContain('WebMCP · Items');
    expect(html).toContain('data-action="run-integration-action"');
    expect(html).not.toContain('data-action="add-command-for-integration-action"');
    expect(html).not.toContain('data-action="edit-integration-action"');
  });
});

describe('WebMCP review dialog', () => {
  const descriptor: IntegrationWebMcpToolDescriptor = {
    origin: 'https://example.com',
    name: 'example.read',
    description: 'Read an example.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Text to find.\nUse one phrase per line.' },
        limit: { type: 'integer', default: 10 },
        exact: { type: 'boolean' },
      },
    },
    outputSchema: { type: 'object', properties: { items: { type: 'array' } } },
    annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  };

  it('shows literal annotations and aligned scripting and MCP permissions', () => {
    const profile = state.integrationRegistry.profiles[0];
    const html = renderIntegrationWebMcpReviewDialog({
      ...state,
      integrationWebMcpReviewProfileId: profile.id,
      integrationWebMcpReviewTool: descriptor,
    });
    expect(html).toContain('<dt>Read Only</dt><dd>True</dd>');
    expect(html).toContain('Input Schema (advanced)');
    expect(html).toContain('Output Schema (advanced)');
    expect(html).toContain('Allow calling via HVY Scripting');
    expect(html).toContain('Controls sandboxed HVY Scripting. Power Scripting is unrestricted and does not use this permission.');
    expect(html).toContain('Allow calling via HVY Galaxy MCP Server');
    expect(html).toContain('integration-webmcp-permission');
    expect(html).toContain('Enable and Allow');
    expect(html).not.toContain('Can change page or account data');
    expect(html).not.toContain('The exact tool descriptor is bound');
  });

  it('loads saved permissions for review and labels the action Update', () => {
    const profile = state.integrationRegistry.profiles[0];
    const integrationId = 'integration';
    const pageId = 'page';
    const capabilityId = webMcpCapabilityId(integrationId, pageId, profile.id, descriptor);
    const approvals = approveIntegrationWebMcpTool({}, {
      capabilityId,
      integrationId,
      pageId,
      profileId: profile.id,
      descriptor,
      scriptingEnabled: true,
      mcpExposed: true,
    });
    const html = renderIntegrationWebMcpReviewDialog({
      ...state,
      appSettings: { ...state.appSettings, integrationWebMcpApprovals: approvals },
      integrationWebMcpReviewIntegrationId: integrationId,
      integrationWebMcpReviewPageId: pageId,
      integrationWebMcpReviewProfileId: profile.id,
      integrationWebMcpReviewTool: descriptor,
    });
    expect(html).toContain('name="scriptingEnabled" checked');
    expect(html).toContain('name="mcpExposed" checked');
    expect(html).toContain('>Update</button>');
  });

  it('renders schema-derived test parameters instead of a raw arguments editor', () => {
    const profile = state.integrationRegistry.profiles[0];
    const integrationId = 'integration';
    const pageId = 'page';
    const capabilityId = webMcpCapabilityId(integrationId, pageId, profile.id, descriptor);
    const approvals = approveIntegrationWebMcpTool({}, {
      capabilityId,
      integrationId,
      pageId,
      profileId: profile.id,
      descriptor,
      scriptingEnabled: false,
      mcpExposed: false,
    });
    const html = renderIntegrationWebMcpInvokeDialog({
      ...state,
      appSettings: { ...state.appSettings, integrationWebMcpApprovals: approvals },
      integrationWebMcpInvokeCapabilityId: capabilityId,
    });
    expect(html).toContain('Parameter');
    expect(html).toContain('data-argument-name="query"');
    expect(html).toContain('<textarea class="hvy-galaxy-input" data-webmcp-argument data-argument-name="query"');
    expect(html).toContain('<pre class="integration-webmcp-argument-description">Text to find.\nUse one phrase per line.</pre>');
    expect(html).toContain('data-argument-type="integer"');
    expect(html).toContain('data-argument-type="boolean"');
    expect(html).toContain('Run Test');
    expect(html).not.toContain('name="arguments"');
  });
});
