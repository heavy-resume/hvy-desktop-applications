import { controlIntegrationBrowser, openIntegrationPage } from './integrationBrowser';
import { actionPatternPayload, createCustomPageIntegration, matcherSnapshot, onIntegrationRegistrySaved, saveIntegrationRegistry, type IntegrationDefinition } from './integrationRegistry';
import { handlers, rerender } from './main';
import { state } from './state';
import { patternsFromSetup, setupIntegrations } from './siteSetupPatterns';
import type { SitePatternDefinition } from './webAutomation/sitePatterns';
import { setSiteMatchingViewer, setSiteSetupOpener, type SiteMatchingRequest, type SiteSetupRequest } from './webAutomation/siteSetupOpener';
import { listSetupExamples, openListedItem, openListedItemByClick, openProfilePage, readSetupExamples } from './webAutomation/app';
import type { CollectionDefinition, CollectionRunState, ExtractItem } from './webAutomation/collection';
import { withSiteSetups } from './webAutomation/siteSetups';
import { matcherOf, recordValues, type InspectorRecord } from './webAutomation/nativeHost';

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
let active: {
  request: SiteSetupRequest;
  integrationIds: Set<string>;
  listId: string;
  itemId: string | null;
  /** The item page opened from the list just now, while its fields are picked: what Wrong page takes back. */
  openedItem: OpenedItem | null;
  /** The list's items open without a link (their page's script opens them), which runs can't follow yet. */
  openerWithoutLink: boolean;
  /** Test: the items found on the list, to read. */
  testItems: ExtractItem[];
} | null = null;

/** How many of the list's items Test reads. */
const TEST_ITEMS = 2;

/** What opening an item from the list added: its page to the item page's record type, or (`pageId` null) the item page itself. */
interface OpenedItem {
  integrationId: string;
  pageId: string | null;
}

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
  active = { request, integrationIds: new Set([list.id, ...(itemPage ? [itemPage.id] : [])]), listId: list.id, itemId: itemPage?.id ?? null, openedItem: null, openerWithoutLink: false, testItems: [] };
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
    offerWrongPage: false,
    pending: null,
    error: null,
    test: null,
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
function addItemExample(url: string): OpenedItem | null {
  const session = active;
  if (!session || !state.siteSetup) return null;
  const name = itemName(session.request);
  const itemPage = sessionIntegration(session.itemId);
  const posting = itemPage?.actions[0];
  if (!itemPage || !posting?.pattern) {
    setItemPage(createCustomPageIntegration(`${capitalized(name)} page`, url));
    const started = sessionIntegration(session.itemId);
    if (started) buildRecordType(started, `${capitalized(name)} page`, pagePrompts(name));
    return started ? { integrationId: started.id, pageId: null } : null;
  }
  const page = itemPage.pages.find((candidate) => candidate.url === url)
    ?? { ...createCustomPageIntegration(`${capitalized(name)} page`, url).pages[0], id: `${itemPage.id}-page-${crypto.randomUUID()}` };
  const added = !itemPage.pages.includes(page);
  if (added) {
    itemPage.pages = [...itemPage.pages, page];
    saveIntegrationRegistry(state.integrationRegistry);
  }
  state.selectedIntegrationId = itemPage.id;
  state.siteSetup.prompts = pagePrompts(name);
  handlers.editIntegrationAction(itemPage.id, posting.id, { pageId: page.id });
  return added ? { integrationId: itemPage.id, pageId: page.id } : null;
}

/**
 * What the browser says to pick, on the list page and on one item's own page. A list's rows start with the box around
 * one row (it is what finds the others); an item's page has one record, so its fields are picked first, and the box is
 * the one around them (`box` null).
 */
function rowPrompts(item: string): { box: string | null; fields: string } {
  return {
    box: `Pick the box around one ${item} in the list, with everything you want from it inside.`,
    fields: `Pick what to read from this ${item}`,
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
    prompt: `Click what opens a ${name}`,
    recordChoice: { refuse: `Click what opens one of the ${name}s boxed in green.` },
  });
}

/** Runs read a list's items by following each row's link, so a list whose items open without one gives them nothing. */
function openerWithoutLinkNote(name: string): string {
  return `Runs can't open ${name}s on this site yet: its ${name}s open without a link.`;
}

/**
 * What opens an item, clicked in one of the list's rows: kept as the list's `opener` (found in every row, its link is
 * the row's), and the item opened as a run opens it, in a worker: the list page, then the opener's link followed from
 * it, or, with no link (its page's script opens it), the opener clicked. Its fields are picked where that ended up,
 * the page runs will read, with Wrong page to take it back. Opening nothing is a pick to make again. The first item is
 * the setup's item page; each after it is one more example of it.
 */
export function itemPicked(record: InspectorRecord, opener: { snapshot: unknown; href: string | null }): void {
  const session = active;
  const list = session ? sessionIntegration(session.listId) : null;
  const rows = list?.actions[0];
  if (!session || !list || !rows?.pattern || !state.siteSetup) return;
  const name = itemName(session.request);
  const listUrl = list.pages[0].url;
  rows.pattern = { ...rows.pattern, opener: matcherSnapshot(opener.snapshot) };
  saveIntegrationRegistry(state.integrationRegistry);
  const listing = sessionPatterns(session).find((pattern) => pattern.role === 'listing');
  if (!listing) return;
  session.openerWithoutLink = !opener.href;
  state.siteSetup.error = null;
  state.siteSetup.pending = `Opening the ${name} as a run does…`;
  rerender({ preserveMountedDocument: true });
  const opening = opener.href
    ? openListedItem(state.selectedIntegrationProfileId, listUrl, new URL(opener.href, listUrl).href)
    : openListedItemByClick(state.selectedIntegrationProfileId, listUrl, listing, recordValues(record));
  void opening.then((opened) => {
    if (!state.siteSetup) return;
    state.siteSetup.pending = null;
    if (!opened) {
      session.openerWithoutLink = false;
      pickExampleItem(session);
      state.siteSetup.error = `That didn't open a ${name}. Click what opens one.`;
      rerender({ preserveMountedDocument: true });
      return;
    }
    state.siteSetup.offerWrongPage = true;
    session.openedItem = addItemExample(opened.url);
    if (session.openerWithoutLink) state.siteSetup.error = openerWithoutLinkNote(name);
    rerender({ preserveMountedDocument: true });
  }, (error: unknown) => {
    if (state.siteSetup) {
      state.siteSetup.pending = null;
      state.siteSetup.error = error instanceof Error ? error.message : String(error);
    }
    rerender({ preserveMountedDocument: true });
  });
}

/**
 * Wrong page, picking the fields of an item just opened from the list: what opening it added is taken back (its page,
 * or the item page it started), and the list is back to click what opens an item again.
 */
export function wrongItemPage(): void {
  const session = active;
  const opened = session?.openedItem;
  if (!session || !state.siteSetup) return;
  session.openedItem = null;
  state.integrationActionSelectionPending = false;
  state.integrationActionBuilderOpen = false;
  if (opened?.pageId) {
    const itemPage = sessionIntegration(opened.integrationId);
    if (itemPage) itemPage.pages = itemPage.pages.filter((page) => page.id !== opened.pageId);
  } else if (opened) {
    session.integrationIds.delete(opened.integrationId);
    session.itemId = null;
    state.siteSetup.itemIntegrationId = null;
    state.integrationRegistry = { ...state.integrationRegistry, integrations: state.integrationRegistry.integrations.filter((integration) => integration.id !== opened.integrationId) };
  }
  saveIntegrationRegistry(state.integrationRegistry);
  pickExampleItem(session);
  rerender({ preserveMountedDocument: true });
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

/** The collection as it would be with this setup: what Test runs. */
function sessionCollection(session: NonNullable<typeof active>): CollectionDefinition {
  const { collection, site } = session.request;
  return { ...collection, ...withSiteSetups(collection, [{ ...site, patterns: sessionPatterns(session) }]) };
}

/** Why a Test run found or read nothing: its own words, or what its page said. */
function runProblem(run: CollectionRunState): string | null {
  return run.error ?? Object.values(run.startPageProblems)[0] ?? run.problemPages[0]?.problem ?? null;
}

function shownValue(value: unknown): string {
  return fullValue(value).replace(/\s+/g, ' ').trim();
}

/** A value as it was read, its lines kept: a list's items one to a line. */
function fullValue(value: unknown): string {
  return value === undefined || value === null ? '' : (Array.isArray(value) ? value.map(String).join('\n') : String(value)).trim();
}

/** Test: a long value opened in full, or closed (null). */
export function openSetupTestValue(opened: { result: number; field: number } | null): void {
  if (!state.siteSetup?.test) return;
  state.siteSetup.test.opened = opened;
  rerender({ preserveMountedDocument: true });
}

/**
 * Test, Find: the first items on the list page, as a run with this setup lists them. Test, Read: their own pages, read
 * as a run reads them, each shown field by field, so an empty or wrong field shows before Done. Nothing is kept.
 */
function testSetup(session: NonNullable<typeof active>, step: 'test-find' | 'test-read'): void {
  const setup = state.siteSetup;
  if (!setup) return;
  const name = itemName(session.request);
  const definition = sessionCollection(session);
  const title = (item: ExtractItem) => shownValue(item.values?.title) || item.url;
  // What happened is said in the step, by its buttons.
  const failed = (error: unknown) => {
    if (!state.siteSetup?.test || active !== session) return;
    state.siteSetup.test.pending = null;
    state.siteSetup.test.problem = error instanceof Error ? error.message : String(error);
    rerender({ preserveMountedDocument: true });
  };
  if (step === 'test-find') {
    session.testItems = [];
    setup.test = { pending: `Finding ${TEST_ITEMS} ${name}s on the list…`, items: [], results: null, problem: null, opened: null };
    rerender({ preserveMountedDocument: true });
    void listSetupExamples(state.selectedIntegrationProfileId, definition, setup.url, TEST_ITEMS).then(({ items, run }) => {
      if (!state.siteSetup || active !== session) return;
      session.testItems = items.slice(0, TEST_ITEMS);
      state.siteSetup.test = {
        pending: null,
        items: session.testItems.map((item) => ({ url: item.url, title: title(item) })),
        results: null,
        problem: session.testItems.length ? null : runProblem(run) ?? `The list showed no ${name}s.`,
        opened: null,
      };
      rerender({ preserveMountedDocument: true });
    }, failed);
    return;
  }
  const items = session.testItems;
  if (!items.length || !setup.test) return;
  setup.test = { ...setup.test, pending: `Reading ${items.length === 1 ? `the ${name}’s page` : `the ${items.length} ${name}s’ pages`}…`, results: null, problem: null, opened: null };
  rerender({ preserveMountedDocument: true });
  void readSetupExamples(state.selectedIntegrationProfileId, definition, items).then(({ records, run }) => {
    if (!state.siteSetup?.test || active !== session) return;
    state.siteSetup.test.pending = null;
    state.siteSetup.test.results = items.map((item) => {
      const record = records.find((candidate) => candidate.url === item.url);
      return {
        url: item.url,
        title: shownValue(record?.values.title) || title(item),
        fields: session.request.collection.fields.map((field) => ({ label: field.label, value: shownValue(record?.values[field.id]), full: fullValue(record?.values[field.id]) })),
        problem: record ? record.problem ?? null : runProblem(run) ?? 'Its page wasn’t read.',
      };
    });
    rerender({ preserveMountedDocument: true });
  }, failed);
}

export type SiteSetupStep = 'open-page' | 'rows' | 'pagination' | 'item-page' | 'item-examples' | 'test-find' | 'test-read' | 'done';

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
  // The item page's examples, in the record type builder: one picked wrong is removed, or its fields picked again.
  const itemPage = sessionIntegration(session.itemId);
  if (step === 'item-examples' && itemPage) buildRecordType(itemPage, `${item} page`, pagePrompts(itemName(session.request)));
  if (step === 'test-find' || step === 'test-read') testSetup(session, step);
}

/** The record type builder is editing the setup's item page: its examples are other items from the list. */
export function editingSetupItemPage(): boolean {
  return Boolean(active?.itemId && state.siteSetup && state.integrationActionDraftIntegrationId === active.itemId && state.integrationActionDraftActionId);
}

/** After each save in the session, what the block would refuse, shown before Done. */
function checkSiteSetup(): void {
  if (!active || !state.siteSetup) return;
  const errors = [
    ...active.request.check(sessionPatterns(active)),
    ...(active.openerWithoutLink ? [openerWithoutLinkNote(itemName(active.request))] : []),
  ];
  state.siteSetup.error = errors.length ? errors.join(' ') : null;
  // What was tested is not the setup any more.
  state.siteSetup.test = null;
  active.testItems = [];
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

/** The page showing matching now: what its Add as example adds. */
let matching: SiteMatchingRequest | null = null;

/**
 * Show matching: the page opens in the browser, in the profile chosen for setting up sites, with the item page pattern
 * matched against it, to look at: how close it came, and which fields failed or overlapped.
 */
function showMatching(request: SiteMatchingRequest): void {
  const profile = state.integrationRegistry.profiles.find((candidate) => candidate.id === state.selectedIntegrationProfileId);
  const matcher = matcherOf(request.pattern);
  if (!profile || !matcher) return;
  matching = request;
  const origin = new URL(request.url).origin;
  void openIntegrationPage(request.url, [origin], profile.id, profile.browserStoreId, false, {
    kind: 'command-target',
    context: { expectedOrigin: origin, expectedOrigins: [origin] },
    inspectionKind: 'parent',
    options: { existingPattern: matcher.pattern, matchingView: true, prompt: `${capitalized(request.itemName)} page` },
  }, true, profile.name);
}

/**
 * Test, a result's Show matching: its page with the setup's item page matched against it, as Test read it, to see what
 * each field landed on. Add as example adds it as another example of the item page, as one a run couldn't read is.
 */
export function showSetupTestMatching(result: number): void {
  const session = active;
  const url = state.siteSetup?.test?.results?.[result]?.url;
  const pattern = session ? sessionPatterns(session).find((candidate) => candidate.role === 'detail') : undefined;
  if (!session || !url || !pattern) return;
  showMatching({
    url,
    itemName: itemName(session.request),
    pattern,
    addExample: () => {
      if (active !== session) return;
      session.openedItem = addItemExample(url);
      rerender({ preserveMountedDocument: true });
    },
  });
}

/** Show matching's Add as example, from the page. */
export function addMatchingExample(): void {
  const request = matching;
  matching = null;
  request?.addExample();
}

export function installSiteSetup(): void {
  setSiteSetupOpener(startSiteSetup);
  setSiteMatchingViewer(showMatching);
  // The handler that saved rerenders, showing what the block would refuse.
  onIntegrationRegistrySaved(checkSiteSetup);
}
