import { describe, expect, it } from 'vitest';
import { state } from '../state';
import { approveIntegrationWebMcpTool, webMcpCapabilityId, type IntegrationWebMcpToolDescriptor } from '../integrationWebMcp';
import { renderIntegrationPageErrorDialog, renderIntegrationRecordSourceDialog, renderIntegrationsDialog, renderIntegrationWebMcpInvokeDialog, renderIntegrationWebMcpResultDialog, renderIntegrationWebMcpReviewDialog } from './render-integrations';

const integrationRegistry = {
  version: 1 as const,
  profiles: state.integrationRegistry.profiles,
  integrations: [{
    id: 'integration', name: 'Example', profileProviderId: 'browser', editable: true,
    pages: [{ id: 'page', name: 'Example', url: 'https://example.com/', allowedOrigins: ['https://example.com'], editable: true }],
    actions: [],
  }],
};

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
      integrationWebMcpResultForRecordType: true,
      integrationWebMcpResultCapabilityId: capabilityId,
      integrationWebMcpResult: { items: [{ id: 'one', title: 'First' }] },
      integrationWebMcpRecordBuilderOpen: true,
    });
    expect(html).toContain('data-action="request-save-webmcp-record-type"');
    expect(html).toContain('data-form="save-webmcp-record-type"');
    expect(html).toContain('integration-webmcp-record-builder-backdrop');
    expect(html).toContain('aria-label="WebMCP result" aria-hidden="true" inert');
    expect(html).toContain('name="recordsPath" value="/items" data-action="select-webmcp-record-path" checked');
    expect(html).toContain('id, title');
    expect(html).toContain('<input type="checkbox" name="recordField" value="id" checked>');
    expect(html).toContain('name="fieldLabel:title" value="title"');
    expect(html).toContain('data-action="close-webmcp-result">Cancel</button>');
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

describe('record type source chooser', () => {
  const readTool: IntegrationWebMcpToolDescriptor = {
    origin: 'https://example.com', name: 'items.read', title: 'Items', description: 'Read items.',
    inputSchema: { type: 'object' },
    annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  };

  it('offers web page records and lets the user scan in place when no WebMCP tools are known', () => {
    const html = renderIntegrationRecordSourceDialog({
      ...state,
      integrationRegistry,
      selectedIntegrationProfileId: integrationRegistry.profiles[0].id,
      integrationRecordSourceDialogOpen: true,
      integrationRecordSourceIntegrationId: 'integration',
      integrationRecordSourcePageId: 'page',
    });
    expect(html).toContain('Where do the records come from?');
    expect(html).toContain('data-action="choose-web-page-record-type"');
    expect(html).toContain('data-action="choose-webmcp-record-type" disabled');
    expect(html).toContain('data-action="discover-webmcp-tools"');
    expect(html).toContain('>Scan tools</button>');
    expect(html).toContain('No reviewed or scanned WebMCP tools are available');
    expect(html.match(/class="integration-record-source-option"/g)).toHaveLength(2);
    expect(html.match(/class="integration-record-source-actions"/g)).toHaveLength(2);
  });

  it('offers an already reviewed tool without requiring another scan', () => {
    const profile = integrationRegistry.profiles[0];
    const capabilityId = webMcpCapabilityId('integration', 'page', profile.id, readTool);
    const approvals = approveIntegrationWebMcpTool({}, {
      capabilityId, integrationId: 'integration', pageId: 'page', profileId: profile.id,
      descriptor: readTool, scriptingEnabled: true, mcpExposed: false,
    });
    const common = {
      ...state,
      integrationRegistry,
      appSettings: { ...state.appSettings, integrationWebMcpApprovals: approvals },
      selectedIntegrationProfileId: profile.id,
      integrationRecordSourceDialogOpen: true,
      integrationRecordSourceIntegrationId: 'integration',
      integrationRecordSourcePageId: 'page',
      integrationWebMcpPageId: null,
      integrationWebMcpProfileId: null,
      integrationWebMcpTools: [],
    };
    const sourceHtml = renderIntegrationRecordSourceDialog(common);
    expect(sourceHtml).toContain('Choose from 1 available tool');
    expect(sourceHtml).toContain('data-action="choose-webmcp-record-type">Choose</button>');
    expect(sourceHtml).not.toContain('>Scan tools</button>');

    const pickerHtml = renderIntegrationRecordSourceDialog({ ...common, integrationRecordSourceStep: 'webmcp' });
    expect(pickerHtml).toContain('Ready to configure');
    expect(pickerHtml).toContain('data-tool-index="0" >Configure</button>');
  });

  it('enables WebMCP after scanning and distinguishes read-only tools in the picker', () => {
    const common = {
      ...state,
      integrationRegistry,
      selectedIntegrationProfileId: integrationRegistry.profiles[0].id,
      integrationRecordSourceDialogOpen: true,
      integrationRecordSourceIntegrationId: 'integration',
      integrationRecordSourcePageId: 'page',
      integrationWebMcpPageId: 'page',
      integrationWebMcpProfileId: integrationRegistry.profiles[0].id,
      integrationWebMcpTools: [readTool, { ...readTool, name: 'items.delete', title: 'Delete items', annotations: { ...readTool.annotations, readOnlyHint: false } }],
    };
    const sourceHtml = renderIntegrationRecordSourceDialog(common);
    expect(sourceHtml).toContain('Choose from 2 available tools');
    expect(sourceHtml).toContain('data-action="choose-webmcp-record-type">Choose</button>');

    const pickerHtml = renderIntegrationRecordSourceDialog({ ...common, integrationRecordSourceStep: 'webmcp' });
    expect(pickerHtml).toContain('Choose a WebMCP tool');
    expect(pickerHtml).toContain('data-tool-index="0" >Select</button>');
    expect(pickerHtml).toContain('data-tool-index="1" disabled>Select</button>');
    expect(pickerHtml).toContain('Not read only');
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

  it('labels invocation as record configuration when entered from the record type chooser', () => {
    const profile = state.integrationRegistry.profiles[0];
    const integrationId = 'integration';
    const pageId = 'page';
    const capabilityId = webMcpCapabilityId(integrationId, pageId, profile.id, descriptor);
    const approvals = approveIntegrationWebMcpTool({}, {
      capabilityId, integrationId, pageId, profileId: profile.id, descriptor, scriptingEnabled: false, mcpExposed: false,
    });
    const html = renderIntegrationWebMcpInvokeDialog({
      ...state,
      appSettings: { ...state.appSettings, integrationWebMcpApprovals: approvals },
      integrationWebMcpInvokeCapabilityId: capabilityId,
      integrationWebMcpInvokeForRecordType: true,
    });
    expect(html).toContain('Configure example.read');
    expect(html).toContain('Read records');
    expect(html).not.toContain('Run Test');
  });

  it('keeps a visible record-reading dialog while a newly opened page initializes', () => {
    const profile = state.integrationRegistry.profiles[0];
    const integrationId = 'integration';
    const pageId = 'page';
    const capabilityId = webMcpCapabilityId(integrationId, pageId, profile.id, descriptor);
    const approvals = approveIntegrationWebMcpTool({}, {
      capabilityId, integrationId, pageId, profileId: profile.id, descriptor, scriptingEnabled: false, mcpExposed: false,
    });
    const html = renderIntegrationWebMcpInvokeDialog({
      ...state,
      appSettings: { ...state.appSettings, integrationWebMcpApprovals: approvals },
      integrationWebMcpInvokeCapabilityId: capabilityId,
      integrationWebMcpInvokeForRecordType: true,
      integrationWebMcpPending: true,
    });
    expect(html).toContain('integration-webmcp-pending-dialog');
    expect(html).toContain('Reading records…');
    expect(html).toContain('waiting for its WebMCP tools');
  });

  it('keeps invocation errors in the configuration dialog so they are not silent', () => {
    const profile = state.integrationRegistry.profiles[0];
    const integrationId = 'integration';
    const pageId = 'page';
    const capabilityId = webMcpCapabilityId(integrationId, pageId, profile.id, descriptor);
    const approvals = approveIntegrationWebMcpTool({}, {
      capabilityId, integrationId, pageId, profileId: profile.id, descriptor, scriptingEnabled: false, mcpExposed: false,
    });
    const html = renderIntegrationWebMcpInvokeDialog({
      ...state,
      appSettings: { ...state.appSettings, integrationWebMcpApprovals: approvals },
      integrationWebMcpInvokeCapabilityId: capabilityId,
      integrationWebMcpInvokeForRecordType: true,
      integrationWebMcpError: 'Tool registration failed.',
    });
    expect(html).toContain('WebMCP failed');
    expect(html).toContain('Tool registration failed.');
    expect(html).toContain('Read records');
  });
});
