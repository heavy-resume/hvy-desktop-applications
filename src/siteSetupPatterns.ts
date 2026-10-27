import type { IntegrationDefinition } from './integrationRegistry';
import { sitePatternsFromIntegrations } from './webAutomation/integrationPatterns';
import type { SitePatternDefinition } from './webAutomation/sitePatterns';

/** What a pattern was set up from: the page it came from in the Integrations manager. */
export interface SetupSource {
  integration?: IntegrationDefinition;
}

/**
 * The pages a site setup's patterns came from, so setting it up again continues where it left off: `list` is the one
 * its list pattern came from.
 */
export function setupIntegrations(patterns: SitePatternDefinition[]): { integrations: IntegrationDefinition[]; list: IntegrationDefinition | null } {
  const byId = new Map<string, IntegrationDefinition>();
  let listId: string | null = null;
  for (const pattern of patterns) {
    const source = pattern.source as SetupSource | undefined;
    if (!source?.integration?.id) continue;
    byId.set(source.integration.id, { ...source.integration, siteSetup: true });
    if (pattern.role === 'listing') listId ??= source.integration.id;
  }
  return { integrations: [...byId.values()], list: (listId && byId.get(listId)) || null };
}

/**
 * A setup session's pages as a site setup's patterns, each keeping the page it
 * came from as its source. Ids start with the setup's id, so two setups of
 * the same site stay apart. The list page (`listId`) reads rows; the others read one item's page.
 */
export function patternsFromSetup(siteId: string, integrations: IntegrationDefinition[], listId: string): SitePatternDefinition[] {
  return integrations.flatMap((integration) => {
    const { siteSetup: _siteSetup, ...page } = integration;
    const source: SetupSource = { integration: page };
    return sitePatternsFromIntegrations({ version: 1, integrations: [integration], profiles: [] }, new Set([listId]))
      .map((pattern) => ({ ...pattern, id: `${siteId}:${pattern.id}`, siteId, source }));
  });
}
