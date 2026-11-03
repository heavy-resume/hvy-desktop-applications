import type { IntegrationDefinition } from './integrationRegistry';
import { expandedPattern, sitePatternsFromIntegrations, type IntegrationPatternMatcher } from './webAutomation/integrationPatterns';
import type { SitePatternDefinition } from './webAutomation/sitePatterns';

/** What a pattern was set up from: the page it came from in the Integrations manager. */
export interface SetupSource {
  integration?: IntegrationDefinition;
}

/**
 * An integration as a setup's source keeps it: its pages, names, fields, and commands, without the picks (each record
 * type's examples and its fields' snapshots), which its patterns' matchers hold already. `withPicks` puts them back.
 */
function withoutPicks(integration: IntegrationDefinition): IntegrationDefinition {
  return {
    ...integration,
    actions: integration.actions.map((action) => {
      if (!action.pattern) return action;
      const { scope: _scope, ...pattern } = action.pattern;
      return {
        ...action,
        pattern: {
          ...pattern,
          parents: [],
          fields: pattern.fields.map(({ snapshots: _snapshots, negativeSnapshots: _negative, exampleSnapshots: _examples, ...field }) => ({ ...field, snapshot: null })),
        },
      };
    }),
  };
}

/** A source integration with its record types' picks again, from the patterns made from it (by action id). */
function withPicks(integration: IntegrationDefinition, patterns: SitePatternDefinition[]): IntegrationDefinition {
  return {
    ...integration,
    actions: integration.actions.map((action) => {
      const matcher = patterns.find((pattern) => pattern.id.endsWith(`:${action.id}`))?.matcher as IntegrationPatternMatcher | undefined;
      if (!action.pattern || !matcher) return action;
      const picked = expandedPattern(matcher.pattern);
      return {
        ...action,
        pattern: {
          ...action.pattern,
          minimumConfidence: picked.minimumConfidence,
          ...(picked.scope ? { scope: picked.scope } : {}),
          parents: picked.parents,
          fields: action.pattern.fields.map((field, index) => {
            const target = picked.targets[index];
            return target
              ? { ...field, snapshot: target.snapshot, snapshots: target.snapshots, negativeSnapshots: target.negativeSnapshots, exampleSnapshots: target.exampleSnapshots }
              : field;
          }),
        },
      };
    }),
  };
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
    byId.set(source.integration.id, { ...withPicks(source.integration, patterns), siteSetup: true });
    if (pattern.role === 'listing') listId ??= source.integration.id;
  }
  return { integrations: [...byId.values()], list: (listId && byId.get(listId)) || null };
}

/**
 * A setup session's pages as a site setup's patterns, each keeping the page it
 * came from as its source (without the picks its matcher holds). Ids start with the setup's id, so two setups of
 * the same site stay apart. The list page (`listId`) reads rows; the others read one item's page.
 */
export function patternsFromSetup(siteId: string, integrations: IntegrationDefinition[], listId: string): SitePatternDefinition[] {
  return integrations.flatMap((integration) => {
    const { siteSetup: _siteSetup, ...page } = integration;
    const source: SetupSource = { integration: withoutPicks(page) };
    return sitePatternsFromIntegrations({ version: 1, integrations: [integration], profiles: [] }, new Set([listId]))
      .map((pattern) => ({ ...pattern, id: `${siteId}:${pattern.id}`, siteId, source }));
  });
}
