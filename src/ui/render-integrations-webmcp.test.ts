import { describe, expect, it } from 'vitest';
import { state } from '../state';
import { renderIntegrationPageErrorDialog, renderIntegrationWebMcpReviewDialog } from './render-integrations';

describe('integration page errors', () => {
  it('renders validation failures as an explicit modal', () => {
    const html = renderIntegrationPageErrorDialog({ ...state, integrationPageError: 'Use a valid local page.' });
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('Couldn’t add web page');
    expect(html).toContain('Use a valid local page.');
    expect(html).toContain('data-action="close-integration-page-error"');
  });
});

describe('WebMCP review dialog', () => {
  it('shows literal annotations and aligned scripting and MCP permissions', () => {
    const profile = state.integrationRegistry.profiles[0];
    const html = renderIntegrationWebMcpReviewDialog({
      ...state,
      integrationWebMcpReviewProfileId: profile.id,
      integrationWebMcpReviewTool: {
        origin: 'https://example.com',
        name: 'example.read',
        description: 'Read an example.',
        inputSchema: { type: 'object' },
        annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
      },
    });
    expect(html).toContain('<dt>Read Only</dt><dd>True</dd>');
    expect(html).toContain('Input Schema (advanced)');
    expect(html).toContain('Allow calling via HVY Scripting');
    expect(html).toContain('Controls sandboxed HVY Scripting. Power Scripting is unrestricted and does not use this permission.');
    expect(html).toContain('Allow calling via HVY Galaxy MCP Server');
    expect(html).toContain('integration-webmcp-permission');
    expect(html).toContain('Enable and Allow');
    expect(html).not.toContain('Can change page or account data');
    expect(html).not.toContain('The exact tool descriptor is bound');
  });
});
