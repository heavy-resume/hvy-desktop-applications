import { describe, expect, it } from 'vitest';
import { createCustomPageIntegration } from '../integrationRegistry';
import { state } from '../state';
import { renderIntegrationsDialog } from './render-integrations';

/** A page of the setup with its record type picked: its fields, by id, from `examples` picks. */
function picked(name: string, fields: string[], examples = 1) {
  const integration = { ...createCustomPageIntegration(name, 'https://boards.example.test/jobs'), siteSetup: true as const };
  return { ...integration, actions: [{ id: `${name}-action`, name, pattern: { fields: fields.map((label) => ({ label })), parents: Array.from({ length: examples }, () => ({})) } }] };
}

describe('Set up this site', () => {
  it('tests the setup last: finds two items, then shows what reading each page gave, field by field, empty ones marked', () => {
    const list = picked('Job list', ['title']);
    const item = picked('Job page', ['title', 'description']);
    state.integrationRegistry = { ...state.integrationRegistry, integrations: [list, item] as never };
    state.integrationsDialogOpen = true;
    const description = 'You will design, build, and operate services. '.repeat(10).trim();
    state.siteSetup = {
      collectionName: 'Careers pages', documentName: 'Search.hvy', itemName: 'job', siteName: 'boards.example.test', url: 'https://boards.example.test/jobs',
      listIntegrationId: list.id, itemIntegrationId: item.id,
      fields: [{ id: 'title', label: 'Title' }, { id: 'description', label: 'Description' }],
      prompts: null, offerWrongPage: false, pending: null, error: null,
      test: null,
    };
    const before = renderIntegrationsDialog(state);
    expect(before).toContain('<h3 class="site-setup-step-title">Test</h3>');
    expect(before).toMatch(/data-step="test-find" >Find jobs</);
    expect(before).toMatch(/data-step="test-read" disabled>Read them</);
    // The item page's examples can be corrected, as the list's can.
    expect(before).toMatch(/data-step="item-examples" >Edit examples<\/button><button [^>]*data-step="item-page" >Pick another job</);

    state.siteSetup.test = { items: [{ url: 'https://boards.example.test/jobs/1', title: 'Engineer' }, { url: 'https://boards.example.test/jobs/2', title: 'Designer' }], results: null, problem: null, pending: null };
    const found = renderIntegrationsDialog(state);
    expect(found).toContain('<strong class="site-setup-test-title">Engineer</strong>');
    expect(found).toMatch(/data-step="test-read" >Read them</);

    state.siteSetup.test.results = [
      { url: 'https://boards.example.test/jobs/1', title: 'Engineer', fields: [{ label: 'Title', value: 'Engineer' }, { label: 'Description', value: description }], problem: null },
      { url: 'https://boards.example.test/jobs/2', title: 'Designer', fields: [{ label: 'Title', value: 'Designer' }, { label: 'Description', value: '' }], problem: 'Description is required.' },
    ];
    const read = renderIntegrationsDialog(state);
    expect(read).toContain(`${description.slice(0, 160)}… <small>(${description.length.toLocaleString()} characters)</small>`);
    expect(read).toContain('<dd class="site-setup-test-value site-setup-test-empty">Empty</dd>');
    expect(read).toContain('<span class="site-setup-test-problem">Description is required.</span>');
    state.siteSetup = null;
    state.integrationsDialogOpen = false;
  });
});
