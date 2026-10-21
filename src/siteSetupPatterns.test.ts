import { describe, expect, it } from 'vitest';
import { createCustomPageIntegration, type IntegrationActionDefinition, type IntegrationDefinition } from './integrationRegistry';
import { patternsFromSetup, setupIntegrations, type SetupSource } from './siteSetupPatterns';

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
    const patterns = patternsFromSetup('acme', [list, job]);

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

  it('reopens a setup\'s own pages to set it up again', () => {
    const list = setupPage('https://boards.test/acme/jobs', 2, ['title']);
    const job = setupPage('https://boards.test/acme/jobs/1', 1, ['title', 'description']);
    const reopened = setupIntegrations(patternsFromSetup('acme', [list, job]));
    expect(reopened.map((integration) => integration.id)).toEqual([list.id, job.id]);
    expect(reopened.every((integration) => integration.siteSetup)).toBe(true);
  });
});
