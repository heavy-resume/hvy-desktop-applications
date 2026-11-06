import { describe, expect, it } from 'vitest';
import { createCustomPageIntegration, type IntegrationActionDefinition, type IntegrationDefinition } from './integrationRegistry';
import { patternsFromSetup, setupIntegrations, type SetupSource } from './siteSetupPatterns';
import { recordValues } from './webAutomation/nativeHost';

function field(label: string) {
  return { id: `field-${label}`, label, cardinality: 'single' as const, optional: false, snapshot: { selected: { shape: label } } };
}

/** A page set up in the Integrations manager: a record type from `examples` examples, its fields assigned by id. */
function setupPage(url: string, examples: number, fields: string[], commandNames: string[] = []): IntegrationDefinition {
  const integration = createCustomPageIntegration('Page', url);
  const page = integration.pages[0];
  page.commands = commandNames.map((name, index) => ({ id: `command-${index}`, name, scope: 'page', steps: [{ gesture: 'click', target: {} }] }) as NonNullable<typeof page.commands>[number]);
  const action: IntegrationActionDefinition = {
    id: `action-${integration.id}`,
    integrationId: integration.id,
    name: 'Job',
    description: '',
    pageIds: [page.id],
    script: '',
    resultSchema: {},
    permissions: ['dom:read'],
    version: 1,
    pattern: { recordLabel: 'Job', minimumConfidence: 0.8, parents: Array.from({ length: examples }, (_, index) => ({ example: index })), fields: fields.map(field) },
  };
  return { ...integration, actions: [action], siteSetup: true };
}

describe('setting up a site into a collection', () => {
  it('turns the session\'s pages into the setup\'s patterns, each keeping its source', () => {
    const list = setupPage('https://boards.test/acme/jobs', 2, ['title', 'location'], ['Next']);
    const job = setupPage('https://boards.test/acme/jobs/1', 1, ['title', 'description']);
    const patterns = patternsFromSetup('acme', [list, job], list.id);

    expect(patterns.map((pattern) => [pattern.role, pattern.fields.map((entry) => `${entry.id}:${entry.kind}`), pattern.paginationCommandId ?? null])).toEqual([
      ['listing', ['title:text', 'location:text', 'link:link'], 'command-0'],
      ['detail', ['title:text', 'description:text'], null],
    ]);
    expect(patterns[0]).toMatchObject({ siteId: 'acme', id: `acme:integration:${list.id}:${list.actions[0].id}` });
    const source = patterns[0].source as SetupSource;
    expect(source.integration).toMatchObject({ id: list.id });
    // The source is saved into the document, so it is not marked as in a session.
    expect(source.integration).not.toHaveProperty('siteSetup');
  });

  it('passes what opens a row\'s item (its opener) to the list\'s matcher', () => {
    const list = setupPage('https://boards.test/acme/jobs', 1, ['company', 'title']);
    list.actions[0].pattern!.opener = { selected: { shape: 'title-link' } };
    const job = setupPage('https://boards.test/acme/jobs/1', 1, ['title']);
    const [listing] = patternsFromSetup('acme', [list, job], list.id);
    expect((listing.matcher as { pattern: { opener?: unknown } }).pattern.opener).toEqual({ selected: { shape: 'title-link' } });
  });

  it('opens a row by where its opener goes, and by its first link for a list with no opener', () => {
    const targets = [
      { label: 'company', value: 'Acme', href: 'https://boards.test/company/acme' },
      { label: 'title', value: 'Engineer', href: 'https://boards.test/acme/jobs/1' },
    ];
    // A row with the company's link before the job's: the opener is the job's.
    expect(recordValues({ parent: 'row', score: 1, targets, opener: { element: 'a.title', href: 'https://boards.test/acme/jobs/1' } }))
      .toEqual({ company: 'Acme', title: 'Engineer', link: 'https://boards.test/acme/jobs/1' });
    expect(recordValues({ parent: 'row', score: 1, targets })).toMatchObject({ link: 'https://boards.test/company/acme' });
    // An opener with no link (its page's script opens the item), or none found in the row: no link is guessed.
    expect(recordValues({ parent: 'row', score: 1, targets, opener: { element: 'div.card', href: null } })).toEqual({ company: 'Acme', title: 'Engineer' });
    expect(recordValues({ parent: 'row', score: 1, targets, opener: null })).toEqual({ company: 'Acme', title: 'Engineer' });
  });

  it('uses the page command recorded as the list\'s next page, whatever it is named', () => {
    const list = setupPage('https://boards.test/acme/jobs', 1, ['title'], ['Open filters', 'Page numbers']);
    list.pages[0].commands![1].pagination = 'page-number';
    const job = setupPage('https://boards.test/acme/jobs/1', 1, ['title', 'description']);
    const [listing] = patternsFromSetup('acme', [list, job], list.id);
    expect(listing.paginationCommandId).toBe('command-1');
    expect((listing.matcher as { commands: Record<string, { pagination?: string }> }).commands['command-1'].pagination).toBe('page-number');
  });

  it('reads an item on every page it has an example from: one added from a page a run couldn\'t read widens it', () => {
    const list = setupPage('https://boards.test/acme/jobs', 1, ['title']);
    const job = setupPage('https://boards.test/acme/jobs/1', 2, ['title', 'description']);
    const other = { ...createCustomPageIntegration('Job page', 'https://boards.test/viewjob?jk=2').pages[0], id: 'page-2' };
    job.pages.push(other);
    job.actions[0].pageIds.push(other.id);
    const [, detail] = patternsFromSetup('acme', [list, job], list.id);
    expect(detail.appliesTo).toEqual([
      { target: 'page', host: 'boards.test', path: '/acme/jobs/*' },
      // A page at the top of the site is its own kind of address, not every address on it.
      { target: 'page', host: 'boards.test', path: '/viewjob' },
    ]);
  });

  it('keeps a setup\'s picks once, in its patterns, and reopens it with them all', () => {
    const list = setupPage('https://boards.test/acme/jobs', 2, ['title', 'location']);
    // Two examples: the title picked in both, the location only in the first.
    list.actions[0].pattern!.fields = list.actions[0].pattern!.fields.map((entry, index) => {
      const examples = index === 0 ? [{ selected: { shape: 'title-1' } }, { selected: { shape: 'title-2' } }] : [{ selected: { shape: 'location-1' } }, null];
      return { ...entry, snapshot: examples[0], snapshots: examples.filter(Boolean), exampleSnapshots: examples };
    });
    const job = setupPage('https://boards.test/acme/jobs/1', 1, ['title', 'description']);
    const patterns = patternsFromSetup('acme', [list, job], list.id);
    const stored = JSON.stringify(patterns);
    // Each pick once: in the matcher, as its examples, not again as the field's snapshot and snapshots, or in the source.
    expect(stored.split('title-2').length - 1).toBe(1);
    expect(stored.split('location-1').length - 1).toBe(1);

    const reopened = setupIntegrations(patterns).integrations.find((integration) => integration.id === list.id)!;
    expect(reopened.actions[0].pattern).toEqual({ ...list.actions[0].pattern, fields: list.actions[0].pattern!.fields.map((entry) => ({ ...entry, negativeSnapshots: [] })) });
  });

  it('reopens a setup\'s own pages to set it up again', () => {
    const list = setupPage('https://boards.test/acme/jobs', 2, ['title']);
    const job = setupPage('https://boards.test/acme/jobs/1', 1, ['title', 'description']);
    const reopened = setupIntegrations(patternsFromSetup('acme', [list, job], list.id));
    expect(reopened.integrations.map((integration) => integration.id)).toEqual([list.id, job.id]);
    expect(reopened.list?.id).toBe(list.id);
    expect(reopened.integrations.every((integration) => integration.siteSetup)).toBe(true);
  });

  it('reads the list page\'s rows as the listing, even when only one row was picked', () => {
    // One example is enough: the inspector's pattern finds every row like it (Highlight matches shows which).
    const list = setupPage('https://boards.test/acme/jobs', 1, ['title']);
    const job = setupPage('https://boards.test/acme/jobs/1', 1, ['title', 'description']);
    const patterns = patternsFromSetup('acme', [list, job], list.id);
    expect(patterns.map((pattern) => [pattern.role, pattern.linkFieldId ?? null])).toEqual([['listing', 'link'], ['detail', null]]);
    expect(setupIntegrations(patterns).list?.id).toBe(list.id);
  });
});
