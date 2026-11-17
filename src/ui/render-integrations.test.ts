import { describe, expect, it } from 'vitest';
import { createCustomPageIntegration } from '../integrationRegistry';
import { state } from '../state';
import { renderIntegrationsDialog, renderSiteSetupPrepareDialog } from './render-integrations';

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
    const fullDescription = `${description}\n\nWhat you bring: <care> & craft.`;
    state.siteSetup = {
      collectionName: 'Careers pages', documentName: 'Search.hvy', itemName: 'job', siteName: 'boards.example.test', url: 'https://boards.example.test/jobs',
      listIntegrationId: list.id, itemIntegrationId: item.id,
      fields: [{ id: 'title', label: 'Title' }, { id: 'description', label: 'Description' }],
      prompts: null, offerWrongPage: false, pending: null, error: null, itemProblem: null,
      test: null, rowKey: null, prepare: { open: false, test: null },
    };
    const before = renderIntegrationsDialog(state);
    expect(before).not.toContain('site-setup-row-key');
    // Getting to the list comes second, before the rows, with nothing recorded yet.
    expect(before).toMatch(/<h3 class="site-setup-step-title">Get to the list <small class="site-setup-step-optional">Optional<\/small><\/h3>/);
    expect(before.indexOf('Get to the list')).toBeLessThan(before.indexOf('Pick an example job row'));
    expect(before).toMatch(/data-action="open-site-setup-prepare" >Set up</);
    expect(before).not.toContain('site-setup-prepare-dialog');
    expect(before).toContain('<h3 class="site-setup-step-title">Test</h3>');
    expect(before).toMatch(/data-step="test-find" >Find jobs</);
    expect(before).toMatch(/data-step="test-read" disabled>Read them</);
    // The item page's examples can be corrected, as the list's can.
    expect(before).toMatch(/data-step="item-examples" >Edit examples<\/button><button [^>]*data-step="item-page" >Pick another job</);

    state.siteSetup.test = { items: [{ url: 'https://boards.example.test/jobs/1', title: 'Engineer' }, { url: 'https://boards.example.test/jobs/2', title: 'Designer' }], results: null, problem: null, pending: null, opened: null };
    const found = renderIntegrationsDialog(state);
    expect(found).toContain('<strong class="site-setup-test-title">Engineer</strong>');
    expect(found).toMatch(/data-step="test-read" >Read them</);

    state.siteSetup.test.results = [
      { url: 'https://boards.example.test/jobs/1', title: 'Engineer', fields: [{ label: 'Title', value: 'Engineer', full: 'Engineer' }, { label: 'Description', value: description, full: fullDescription }], problem: null },
      { url: 'https://boards.example.test/jobs/2', title: 'Designer', fields: [{ label: 'Title', value: 'Designer', full: 'Designer' }, { label: 'Description', value: '', full: '' }], problem: 'Description is required.' },
    ];
    const read = renderIntegrationsDialog(state);
    // A long value is cut short, and opens in full, as it was read.
    expect(read).toContain(`data-action="open-site-setup-test-value" data-result="0" data-field="1">${description.slice(0, 160)}… <small>(${description.length.toLocaleString()} characters)</small></button>`);
    expect(read).not.toContain('site-setup-value-dialog');
    state.siteSetup.test.opened = { result: 0, field: 1 };
    const opened = renderIntegrationsDialog(state);
    expect(opened).toContain('<h2>Description</h2>');
    expect(opened).toContain(`Engineer · ${fullDescription.length.toLocaleString()} characters`);
    expect(opened).toContain(`<div class="site-setup-value-full">${description}\n\nWhat you bring: &lt;care&gt; &amp; craft.</div>`);
    expect(opened).toContain('data-action="close-site-setup-test-value"');
    expect(read).toContain('<dd class="site-setup-test-value site-setup-test-empty">Empty</dd>');
    // Each result's page can be looked at with the setup matched against it.
    expect(read).toContain('data-action="show-site-setup-test-matching" data-result="1">Show matching</button>');
    expect(read).toContain('<span class="site-setup-test-problem">Description is required.</span>');
    state.siteSetup = null;
    state.integrationsDialogOpen = false;
  });
  it('says when items open by clicking, and which fields tell rows apart, each a checkbox before its label', () => {
    const list = picked('Job list', ['title', 'company']);
    const item = picked('Job page', ['description']);
    state.integrationRegistry = { ...state.integrationRegistry, integrations: [list, item] as never };
    state.integrationsDialogOpen = true;
    state.siteSetup = {
      collectionName: 'Mail', documentName: 'Search.hvy', itemName: 'job', siteName: 'mail.google.com', url: 'https://mail.google.com/mail/u/0/#label/job+spam',
      listIntegrationId: list.id, itemIntegrationId: item.id,
      fields: [{ id: 'title', label: 'Title' }, { id: 'company', label: 'Company' }, { id: 'description', label: 'Description' }],
      prompts: null, offerWrongPage: false, pending: null, error: null, itemProblem: null, test: null,
      rowKey: { choices: [{ id: 'title', label: 'Title' }, { id: 'company', label: 'Company' }], chosen: ['title'] },
      prepare: { open: false, test: null },
    };
    const html = renderIntegrationsDialog(state);
    expect(html).toContain('Jobs here open by clicking: runs click each one.');
    expect(html).toContain('<legend>Tell jobs apart by</legend>');
    expect(html).toContain('<label class="checkbox-row"><input class="hvy-galaxy-input" type="checkbox" data-action="site-setup-row-key" data-field="title" checked><span>Title</span></label>');
    expect(html).toContain('<label class="checkbox-row"><input class="hvy-galaxy-input" type="checkbox" data-action="site-setup-row-key" data-field="company" ><span>Company</span></label>');
  });

  it('shows Get to the list in a window: its steps as recorded, its ready checks, and how Test went for each', () => {
    const list = picked('Job list', ['title']);
    list.pages[0].commands = [{ id: 'get-there', name: 'Get to the list', scope: 'page', prepare: true, steps: [
      { gesture: 'type', target: { selected: { tag: 'input', accessibleName: 'Search' } }, value: 'Software engineer' },
      { gesture: 'click', target: { selected: { tag: 'input', accessibleName: 'Seattle' } } },
    ] }];
    list.pages[0].readyChecks = { urlMode: 'strict-domain', urlValue: 'boards.example.test', elements: [
      { id: 'search', name: 'Search', snapshot: {}, expectedValue: 'Software engineer' },
      { id: 'seattle', name: 'Seattle', snapshot: {}, expectedValue: 'Checked' },
    ] };
    state.integrationRegistry = { ...state.integrationRegistry, integrations: [list] as never };
    state.integrationsDialogOpen = true;
    state.siteSetup = {
      collectionName: 'Careers pages', documentName: 'Search.hvy', itemName: 'job', siteName: 'boards.example.test', url: 'https://boards.example.test/jobs',
      listIntegrationId: list.id, itemIntegrationId: null, fields: [{ id: 'title', label: 'Title' }],
      prompts: null, offerWrongPage: false, pending: null, error: null, itemProblem: null, test: null, rowKey: null,
      prepare: { open: true, test: { pending: null, problem: null, result: { ready: false, message: 'The ready check value changed: Seattle.', elements: [
        { id: 'search', name: 'Search', ready: true, value: 'Software engineer' },
        { id: 'seattle', name: 'Seattle', ready: false, reason: 'value_changed', value: 'Not checked' },
      ] } } },
    };
    const html = renderIntegrationsDialog(state) + renderSiteSetupPrepareDialog(state);
    // In the panel: one button, and what is set up.
    expect(html).toMatch(/data-action="open-site-setup-prepare" >Edit</);
    expect(html).toContain('2 steps · 2 ready checks');
    // In the window: the steps as recorded, each check with how Test went.
    expect(html).toContain('Type “Software engineer” into');
    expect(html).toContain('<strong>Search</strong> “Software engineer”</span><span class="site-setup-prepare-pass">Passed</span>');
    expect(html).toContain('<strong>Seattle</strong> “Checked”</span><span class="site-setup-test-problem">Found “Not checked”</span>');
    expect(html).toContain('The ready check value changed: Seattle.');
  });
});
