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

function scopeFor(page: IntegrationPageDefinition): SitePatternDefinition['appliesTo'] {
  const url = new URL(page.url);
  const folder = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1);
  return [{ target: 'page', host: url.hostname, path: `${folder}*` }];
}

function sitePattern(integration: IntegrationDefinition, page: IntegrationPageDefinition, action: IntegrationActionDefinition): SitePatternDefinition | null {
  const pattern = actionPatternPayload(action);
  if (!pattern || !action.pattern) return null;
  // A record picked from several examples repeats on its page, as rows on a list page do; one picked once is a page's
  // own record, such as a job posting.
  const listing = action.pattern.parents.length > 1;
  const fields: SitePatternField[] = action.pattern.fields.map((field) => ({ id: field.label, kind: 'text' }));
  const pageCommands = (page.commands ?? []).filter((command) => command.scope === 'page');
  const next = pageCommands.find((command) => /^next\b/i.test(command.name.trim()));
  const commands = Object.fromEntries([...pageCommands, ...(action.commands ?? [])].map((command) => [command.id, command]));
  return {
    id: `integration:${integration.id}:${action.id}`,
    name: `${integration.name}: ${action.name}`,
    role: listing ? 'listing' : 'detail',
    appliesTo: scopeFor(page),
    fields: listing ? [...fields, { id: LINK_FIELD_ID, kind: 'link' }] : fields,
    minimumConfidence: pattern.minimumConfidence,
    ...(listing ? { linkFieldId: LINK_FIELD_ID } : {}),
    ...(listing && next ? { paginationCommandId: next.id } : {}),
    matcher: { pattern, commands } satisfies IntegrationPatternMatcher,
    version: action.version,
  };
}

/** Integrations' record types as site patterns: how a site setup made by pointing is saved. */
export function sitePatternsFromIntegrations(registry: IntegrationRegistry): SitePatternDefinition[] {
  return registry.integrations.flatMap((integration) => integration.actions.flatMap((action) => {
    const page = integration.pages.find((candidate) => action.pageIds.includes(candidate.id));
    const pattern = page ? sitePattern(integration, page, action) : null;
    return pattern ? [pattern] : [];
  }));
}
