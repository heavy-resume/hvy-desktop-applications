import { actionPatternPayload, type IntegrationActionDefinition, type IntegrationCommandDefinition, type IntegrationDefinition, type IntegrationPageDefinition, type IntegrationRegistry } from '../integrationRegistry';
import type { SitePatternDefinition, SitePatternField } from './sitePatterns';

/**
 * A site pattern's matcher when it comes from an integration set up by pointing: the
 * integration inspector's pattern, and the page and record commands it can
 * run (by ID).
 */
export interface IntegrationPatternMatcher {
  pattern: NonNullable<ReturnType<typeof actionPatternPayload>>;
  commands: Record<string, IntegrationCommandDefinition>;
}

/** The listing field holding each record's link. */
export const LINK_FIELD_ID = 'link';

type MatcherPattern = IntegrationPatternMatcher['pattern'];
type MatcherTarget = MatcherPattern['targets'][number];

const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/**
 * A pattern as a site setup keeps it: each field's snapshots once. A field's `snapshot` and `snapshots` are its first
 * example's and every example's (`exampleSnapshots`, without the examples it is absent from), so they are left out when
 * they are just that, and `expandedPattern` puts them back. A setup's picks were otherwise kept three times over.
 */
export function storedPattern(pattern: MatcherPattern): MatcherPattern {
  return {
    ...pattern,
    targets: pattern.targets.map((target) => {
      const present = (target.exampleSnapshots ?? []).filter(Boolean);
      if (!present.length || !sameJson(target.snapshots, present) || !sameJson(target.snapshot, present[0])) return target;
      const { snapshot: _snapshot, snapshots: _snapshots, ...rest } = target;
      return rest as MatcherTarget;
    }),
  };
}

/** A stored pattern as the inspector matches it: each field's `snapshot` and `snapshots` from its examples' again. */
export function expandedPattern(pattern: MatcherPattern): MatcherPattern {
  return {
    ...pattern,
    targets: pattern.targets.map((target) => {
      if (target.snapshot !== undefined) return target;
      const present = (target.exampleSnapshots ?? []).filter(Boolean);
      return { ...target, snapshot: present[0], snapshots: present };
    }),
  };
}

// A page's own kind of address: those in its folder (/acme/jobs/1 covers /acme/jobs/*). A page at the top of the site
// is its own kind: /jobs and /viewjob are a list and a job, so neither covers the other (or every address on the site),
// and a run never matches a list's setup on a job's page, or a job's on the list (which, on a large page, is slow).
function scopeFor(page: IntegrationPageDefinition): SitePatternDefinition['appliesTo'] {
  const url = new URL(page.url);
  const folder = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1);
  return [{ target: 'page', host: url.hostname, path: folder === '/' && url.pathname !== '/' ? url.pathname : `${folder}*` }];
}

/** Where a record type reads: each page it was picked on, as `scopeFor`. */
function scopesFor(pages: IntegrationPageDefinition[]): SitePatternDefinition['appliesTo'] {
  const rules = pages.flatMap(scopeFor);
  return rules.filter((rule, index) => rules.findIndex((other) => JSON.stringify(other) === JSON.stringify(rule)) === index);
}

function sitePattern(integration: IntegrationDefinition, page: IntegrationPageDefinition, action: IntegrationActionDefinition, listing: boolean): SitePatternDefinition | null {
  const pattern = actionPatternPayload(action);
  if (!pattern || !action.pattern) return null;
  const fields: SitePatternField[] = action.pattern.fields.map((field) => ({ id: field.label, kind: 'text' }));
  const pageCommands = (page.commands ?? []).filter((command) => command.scope === 'page');
  // The site setup's next page command, or (set up in the full manager) a page command named Next.
  const next = pageCommands.find((command) => command.pagination) ?? pageCommands.find((command) => /^next\b/i.test(command.name.trim()));
  const commands = Object.fromEntries([...pageCommands, ...(action.commands ?? [])].map((command) => [command.id, command]));
  return {
    id: `integration:${integration.id}:${action.id}`,
    name: `${integration.name}: ${action.name}`,
    role: listing ? 'listing' : 'detail',
    appliesTo: scopesFor(integration.pages.filter((candidate) => action.pageIds.includes(candidate.id))),
    fields: listing ? [...fields, { id: LINK_FIELD_ID, kind: 'link' }] : fields,
    minimumConfidence: pattern.minimumConfidence,
    ...(listing ? { linkFieldId: LINK_FIELD_ID } : {}),
    ...(listing && next ? { paginationCommandId: next.id } : {}),
    matcher: { pattern: storedPattern(pattern), commands } satisfies IntegrationPatternMatcher,
    version: action.version,
  };
}

/**
 * Integrations' record types as site patterns: how a site setup made by pointing is saved. The list pages' record types
 * (`listIds`) read rows; the others read one item's own page. One example is enough for either: the inspector's
 * pattern finds every row like it.
 */
export function sitePatternsFromIntegrations(registry: IntegrationRegistry, listIds: ReadonlySet<string>): SitePatternDefinition[] {
  return registry.integrations.flatMap((integration) => integration.actions.flatMap((action) => {
    const page = integration.pages.find((candidate) => action.pageIds.includes(candidate.id));
    const pattern = page ? sitePattern(integration, page, action, listIds.has(integration.id)) : null;
    return pattern ? [pattern] : [];
  }));
}
