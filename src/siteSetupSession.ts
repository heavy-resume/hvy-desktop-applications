import { controlIntegrationBrowser } from './integrationBrowser';
import { fetchIntegrationRecords } from './integrationRecords';
import { createCustomPageIntegration, onIntegrationRegistrySaved, saveIntegrationRegistry, type IntegrationDefinition } from './integrationRegistry';
import { handlers, rerender } from './main';
import { state } from './state';
import { patternsFromSetup, setupIntegrations } from './siteSetupPatterns';
import type { SitePatternDefinition } from './webAutomation/sitePatterns';
import { setSiteSetupOpener, type SiteSetupRequest } from './webAutomation/siteSetupOpener';

/**
 * Setting up a site for a document's collection, by pointing at it in the
 * Integrations manager. The pages are integrations kept in memory only
 * (`siteSetup`); **Done** converts them to the setup's patterns and hands them
 * to the reader, which saves them. Closing the manager without it changes
 * nothing. Each pattern keeps the page it came from as its `source`, so the
 * setup can be done again.
 */

/**
 * A session sets up one site: its list page (the address it is set up on) and, once the list's rows are picked, one
 * item's own page. `integrationIds` keeps every page the session has had, so one it drops takes its patterns along.
 */
let active: { request: SiteSetupRequest; integrationIds: Set<string>; listId: string; itemId: string | null } | null = null;

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function itemName(request: SiteSetupRequest): string {
  return request.collection.itemName?.trim() || 'item';
}

function addToRegistry(integration: IntegrationDefinition): void {
  state.integrationRegistry = { ...state.integrationRegistry, integrations: [...state.integrationRegistry.integrations, integration] };
}

function sessionIntegration(id: string | null | undefined): IntegrationDefinition | null {
  return state.integrationRegistry.integrations.find((integration) => integration.id === id) ?? null;
}

function startSiteSetup(request: SiteSetupRequest): void {
  endSiteSetup();
  const item = capitalized(itemName(request));
  const { integrations: existing, list: previousList } = setupIntegrations(request.patterns);
  // Set up again on another place it reads: the list page is this place, keeping what was picked on the other.
  const list = previousList
    ? { ...previousList, pages: previousList.pages.map((page, index) => (index === 0 ? { ...page, url: request.url } : page)) }
    : { ...createCustomPageIntegration(`${item} list`, request.url), siteSetup: true as const };
  const itemPage = existing.find((integration) => integration.id !== list.id) ?? null;
  for (const integration of [list, ...(itemPage ? [itemPage] : [])]) addToRegistry(integration);
  active = { request, integrationIds: new Set([list.id, ...(itemPage ? [itemPage.id] : [])]), listId: list.id, itemId: itemPage?.id ?? null };
  state.siteSetup = {
    collectionName: request.collection.name,
    documentName: state.document?.source.name ?? '',
    itemName: itemName(request),
    siteName: request.site.name,
    url: request.url,
    listIntegrationId: list.id,
    itemIntegrationId: itemPage?.id ?? null,
    fields: request.collection.fields.map((field) => ({ id: field.id, label: field.label })),
    pending: null,
    error: null,
  };
  state.selectedIntegrationId = list.id;
  handlers.openIntegrations();
}

/** Builds (or rebuilds) a page's record type in the existing builder, named for its role, with its page open to pick from. */
function buildRecordType(integration: IntegrationDefinition, name: string): void {
  state.selectedIntegrationId = integration.id;
  const action = integration.actions[0];
  if (action) {
    // Editing opens the page itself, behind the builder, as Edit does in the Integrations manager.
    handlers.editIntegrationAction(integration.id, action.id);
    return;
  }
  const opened = handlers.openIntegrationPage(integration.id, integration.pages[0].id);
  handlers.addActionForIntegrationPage(integration.id, integration.pages[0].id);
  state.integrationActionDraftName = name;
  rerender({ preserveMountedDocument: true });
  // A new record type has nothing picked yet: the page goes straight into picking the first example, as the step
  // says ("pick an example…"), instead of waiting for the builder's Add example. It starts once the open is done, as
  // Add example would: one busy task at a time.
  void opened.then(() => handlers.addIntegrationActionAnchor());
}

/** The first item link the picked rows find on the list page, as the item page to pick from. */
async function openFirstItemPage(session: NonNullable<typeof active>): Promise<void> {
  const list = sessionIntegration(session.listId);
  const action = list?.actions[0];
  const profile = state.integrationRegistry.profiles.find((candidate) => candidate.id === state.selectedIntegrationProfileId);
  if (!list || !action || !profile) throw new Error('Pick an example row first.');
  const result = await fetchIntegrationRecords(list.id, list.pages[0], action, profile);
  const records = (result.records ?? []) as Array<{ targets?: Array<{ href?: string | null }> }>;
  const href = records.flatMap((record) => record.targets ?? []).map((target) => target.href).find((value): value is string => Boolean(value));
  if (!href) throw new Error(`No ${itemName(session.request)} link was found in the rows. Use a different page.`);
  setItemPage(createCustomPageIntegration(`${capitalized(itemName(session.request))} page`, new URL(href, list.pages[0].url).href));
}

/** The session's item page, replacing any earlier one (its patterns go with it). */
function setItemPage(integration: IntegrationDefinition): void {
  addToRegistry(adoptIntoSiteSetup(integration));
  saveIntegrationRegistry(state.integrationRegistry);
}

/** The session's pages as the setup's patterns. */
function sessionPatterns(session: NonNullable<typeof active>): SitePatternDefinition[] {
  const integrations = state.integrationRegistry.integrations.filter((integration) => session.integrationIds.has(integration.id));
  return patternsFromSetup(session.request.site.id, integrations, session.listId);
}

export type SiteSetupStep = 'rows' | 'next' | 'item-page' | 'open-item-page' | 'other-item-page' | 'done';

// UI: the site setup's steps in the Integrations manager, and Done.
export function runSiteSetupStep(step: SiteSetupStep): void {
  const session = active;
  if (!session || !state.siteSetup) return;
  const item = capitalized(itemName(session.request));
  const list = sessionIntegration(session.listId);
  if (!list) return;
  if (step === 'done') {
    const errors = session.request.finish(sessionPatterns(session));
    if (errors.length) {
      state.siteSetup.error = errors.join(' ');
      rerender({ preserveMountedDocument: true });
      return;
    }
    handlers.closeIntegrations();
  }
  if (step === 'rows') buildRecordType(list, `${item} rows`);
  if (step === 'next') handlers.addCommandForIntegrationPage(list.id, list.pages[0].id);
  if (step === 'item-page') {
    const itemPage = sessionIntegration(session.itemId);
    if (itemPage) buildRecordType(itemPage, `${item} page`);
  }
  if (step === 'other-item-page') handlers.requestAddIntegrationPage();
  if (step === 'open-item-page') {
    state.siteSetup.pending = `Finding a ${itemName(session.request)} on the list…`;
    state.siteSetup.error = null;
    rerender({ preserveMountedDocument: true });
    void openFirstItemPage(session).then(() => {
      if (state.siteSetup) state.siteSetup.pending = null;
      const itemPage = sessionIntegration(session.itemId);
      if (itemPage) buildRecordType(itemPage, `${item} page`);
      else rerender({ preserveMountedDocument: true });
    }, (error: unknown) => {
      if (state.siteSetup) {
        state.siteSetup.pending = null;
        state.siteSetup.error = error instanceof Error ? error.message : String(error);
      }
      rerender({ preserveMountedDocument: true });
    });
  }
}

/** After each save in the session, what the block would refuse, shown before Done. */
function checkSiteSetup(): void {
  if (!active || !state.siteSetup) return;
  const errors = active.request.check(sessionPatterns(active));
  state.siteSetup.error = errors.length ? errors.join(' ') : null;
}

/** A page added during a setup is its item page ("Use a different item"), replacing the one it had. */
export function adoptIntoSiteSetup(integration: IntegrationDefinition): IntegrationDefinition {
  if (!active) return integration;
  const item = active.itemId;
  active.integrationIds.add(integration.id);
  active.itemId = integration.id;
  if (state.siteSetup) state.siteSetup.itemIntegrationId = integration.id;
  if (item) {
    active.integrationIds.delete(item);
    state.integrationRegistry = { ...state.integrationRegistry, integrations: state.integrationRegistry.integrations.filter((candidate) => candidate.id !== item) };
  }
  return { ...integration, siteSetup: true };
}

/**
 * Closing the Integrations manager ends the setup: its pages leave memory, and the browser window it pointed in
 * closes. Only Done saved anything. Switching documents during a setup leaves both open: Done saves into the document
 * the setup came from.
 */
export function endSiteSetup(): void {
  if (!active) return;
  const ids = active.integrationIds;
  active = null;
  void controlIntegrationBrowser('close', state.selectedIntegrationProfileId);
  state.siteSetup = null;
  state.integrationRegistry = { ...state.integrationRegistry, integrations: state.integrationRegistry.integrations.filter((integration) => !ids.has(integration.id)) };
  if (ids.has(state.selectedIntegrationId)) state.selectedIntegrationId = state.integrationRegistry.integrations[0]?.id ?? '';
}

export function installSiteSetup(): void {
  setSiteSetupOpener(startSiteSetup);
  // The handler that saved rerenders, showing what the block would refuse.
  onIntegrationRegistrySaved(checkSiteSetup);
}
