import { controlIntegrationBrowser } from './integrationBrowser';
import { actionPatternPayload, createCustomPageIntegration, onIntegrationRegistrySaved, saveIntegrationRegistry, type IntegrationDefinition } from './integrationRegistry';
import { handlers, rerender } from './main';
import { state } from './state';
import { patternsFromSetup, setupIntegrations } from './siteSetupPatterns';
import type { SitePatternDefinition } from './webAutomation/sitePatterns';
import { setSiteSetupOpener, type SiteSetupRequest } from './webAutomation/siteSetupOpener';
import { openListedItem, openProfilePage } from './webAutomation/app';
import { itemLink } from './webAutomation/collection';
import { recordValues, type InspectorRecord } from './webAutomation/nativeHost';

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
  // Set up again on another place it reads: the list page is this place, keeping what was picked on the other. An item
  // page added as an example (one a run couldn't read) leaves the list where it was.
  const list = previousList
    ? request.itemExample ? previousList : { ...previousList, pages: previousList.pages.map((page, index) => (index === 0 ? { ...page, url: request.url } : page)) }
    : { ...createCustomPageIntegration(`${item} list`, request.url), siteSetup: true as const };
  const itemPage = existing.find((integration) => integration.id !== list.id) ?? null;
  for (const integration of [list, ...(itemPage ? [itemPage] : [])]) addToRegistry(integration);
  active = { request, integrationIds: new Set([list.id, ...(itemPage ? [itemPage.id] : [])]), listId: list.id, itemId: itemPage?.id ?? null };
  state.siteSetup = {
    collectionName: request.collection.name,
    documentName: state.document?.source.name ?? '',
    itemName: itemName(request),
    siteName: request.site.name,
    url: list.pages[0].url,
    listIntegrationId: list.id,
    itemIntegrationId: itemPage?.id ?? null,
    fields: request.collection.fields.map((field) => ({ id: field.id, label: field.label })),
    prompts: null,
    pending: null,
    error: null,
  };
  state.selectedIntegrationId = list.id;
  handlers.openIntegrations();
  if (request.itemExample) addItemExample(request.url);
}

/**
 * An item page a run couldn't read, as another example of the setup's item page: it is opened, one more page of the
 * item's record type (so its setup reads that address too), and its fields are picked, as the first example's were.
 * The examples picked before are kept. A setup with no item page yet starts it here.
 */
function addItemExample(url: string): void {
  const session = active;
  if (!session || !state.siteSetup) return;
  const name = itemName(session.request);
  const itemPage = sessionIntegration(session.itemId);
  const posting = itemPage?.actions[0];
  if (!itemPage || !posting?.pattern) {
    setItemPage(createCustomPageIntegration(`${capitalized(name)} page`, url));
    const started = sessionIntegration(session.itemId);
    if (started) buildRecordType(started, `${capitalized(name)} page`, pagePrompts(name));
    return;
  }
  const page = itemPage.pages.find((candidate) => candidate.url === url)
    ?? { ...createCustomPageIntegration(`${capitalized(name)} page`, url).pages[0], id: `${itemPage.id}-page-${crypto.randomUUID()}` };
  if (!itemPage.pages.includes(page)) {
    itemPage.pages = [...itemPage.pages, page];
    saveIntegrationRegistry(state.integrationRegistry);
  }
  state.selectedIntegrationId = itemPage.id;
  state.siteSetup.prompts = pagePrompts(name);
  handlers.editIntegrationAction(itemPage.id, posting.id, { pageId: page.id });
}

/**
 * What the browser says to pick, on the list page and on one item's own page. A list's rows start with the box around
 * one row (it is what finds the others); an item's page has one record, so its fields are picked first, and the box is
 * the one around them (`box` null).
 */
function rowPrompts(item: string): { box: string | null; fields: string } {
  return {
    box: `Pick the box around one ${item} in the list, with everything you want from it inside.`,
    fields: `Pick what to read from this ${item} (its title gives the link to it)`,
  };
}

function pagePrompts(item: string): { box: string | null; fields: string } {
  return {
    box: null,
    fields: `Pick what to read from the ${item}`,
  };
}

/** Builds (or rebuilds) a page's record type in the existing builder, named for its role, with its page open to pick from. */
function buildRecordType(integration: IntegrationDefinition, name: string, prompts: { box: string | null; fields: string }): void {
  state.selectedIntegrationId = integration.id;
  if (state.siteSetup) state.siteSetup.prompts = prompts;
  const action = integration.actions[0];
  if (action) {
    // Editing opens the page itself, behind the builder, as Edit does in the Integrations manager.
    handlers.editIntegrationAction(integration.id, action.id);
    return;
  }
  handlers.addActionForIntegrationPage(integration.id, integration.pages[0].id);
  state.integrationActionDraftName = name;
  rerender({ preserveMountedDocument: true });
  // A new record type has nothing picked yet: its page opens straight into picking the first example, as the step says
  // ("pick an example…"), instead of waiting for the builder's Add example. Picking starts once the page has loaded:
  // started while the browser still shows the page before (the list, when this is an item), it stays on that page.
  if (prompts.box) handlers.addIntegrationActionAnchor({ openPage: true });
  else handlers.pickIntegrationRecordFields({ openPage: true });
}

/**
 * Picking an example item, first: the list page, with the rows its setup finds boxed, to pick one of them (anywhere in
 * it). `itemPicked` hears which.
 */
function pickExampleItem(session: NonNullable<typeof active>): void {
  const list = sessionIntegration(session.listId);
  const pattern = list?.actions[0] ? actionPatternPayload(list.actions[0]) : null;
  if (!list || !pattern || !state.siteSetup) return;
  const name = itemName(session.request);
  state.siteSetup.error = null;
  void handlers.inspectIntegrationPage(list.id, list.pages[0].id, 'parent', {
    existingPattern: pattern,
    prompt: `Pick a ${name} from the list`,
    recordChoice: { refuse: `Pick one of the ${name}s boxed in green.` },
  });
}

/**
 * The row picked: its item opened as a run opens it, in a worker (the list page, then the row's link, read as a run
 * reads a row), and its fields picked where that ended up: the page runs will read. The first one is the setup's
 * item page; each after it is one more example of it.
 */
export function itemPicked(record: InspectorRecord): void {
  const session = active;
  const list = session ? sessionIntegration(session.listId) : null;
  const listing = session ? sessionPatterns(session).find((pattern) => pattern.role === 'listing') : null;
  if (!session || !list || !listing || !state.siteSetup) return;
  const name = itemName(session.request);
  const link = itemLink(listing, recordValues(record), list.pages[0].url);
  if (!link) {
    state.siteSetup.error = `That ${name}'s row has no link to open it by. Pick its title (the link to it) as one of the rows' fields.`;
    rerender({ preserveMountedDocument: true });
    return;
  }
  state.siteSetup.pending = `Opening the ${name} as a run does…`;
  rerender({ preserveMountedDocument: true });
  void openListedItem(state.selectedIntegrationProfileId, list.pages[0].url, link).then(({ url }) => {
    if (state.siteSetup) state.siteSetup.pending = null;
    addItemExample(url);
  }, (error: unknown) => {
    if (state.siteSetup) {
      state.siteSetup.pending = null;
      state.siteSetup.error = error instanceof Error ? error.message : String(error);
    }
    rerender({ preserveMountedDocument: true });
  });
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

export type SiteSetupStep = 'open-page' | 'rows' | 'pagination' | 'item-page' | 'done';

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
  if (step === 'open-page') void openProfilePage(state.selectedIntegrationProfileId, state.siteSetup.url);
  if (step === 'rows') buildRecordType(list, `${item} rows`, rowPrompts(itemName(session.request)));
  if (step === 'pagination') handlers.addCommandForIntegrationPage(list.id, list.pages[0].id, true);
  if (step === 'item-page') pickExampleItem(session);
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
