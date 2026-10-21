import type { IntegrationDefinition } from './integrationRegistry';
import { sitePatternsFromIntegrations } from './webAutomation/integrationPatterns';
import type { SitePatternDefinition } from './webAutomation/sitePatterns';

/** What a pattern was set up from: the page it came from in the Integrations manager. */
export interface SetupSource {
  integration?: IntegrationDefinition;
}

/** The pages a site setup's patterns came from, so setting it up again continues where it left off. */
export function setupIntegrations(patterns: SitePatternDefinition[]): IntegrationDefinition[] {
  const byId = new Map<string, IntegrationDefinition>();
  for (const pattern of patterns) {
    const source = pattern.source as SetupSource | undefined;
    if (source?.integration?.id) byId.set(source.integration.id, { ...source.integration, siteSetup: true });
  }
  return [...byId.values()];
}

/**
 * A setup session's pages as a site setup's patterns, each keeping the page it
 * came from as its source. Ids start with the setup's id, so two setups of
 * the same site stay apart.
 */
export function patternsFromSetup(siteId: string, integrations: IntegrationDefinition[]): SitePatternDefinition[] {
  return integrations.flatMap((integration) => {
    const { siteSetup: _siteSetup, ...page } = integration;
    const source: SetupSource = { integration: page };
    return sitePatternsFromIntegrations({ version: 1, integrations: [integration], profiles: [] })
      .map((pattern) => ({ ...pattern, id: `${siteId}:${pattern.id}`, siteId, source }));
  });
}
