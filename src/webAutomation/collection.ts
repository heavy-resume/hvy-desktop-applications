import type { Clock } from './clock';
import { errorMessage, WebAutomationError } from './errors';
import type { AutomationEmit } from './events';
import type { BrowserHost, PageInspection, PatternMatch } from './host';
import type { WorkerLease, WorkerScheduler } from './scheduler';
import {
  canonicalUrl,
  recordKey,
  validateRecord,
  type CollectedRecord,
  type CollectedRecordProvenance,
  type CollectedRecordState,
  type RecordKeyStrategy,
} from './records';
import { hostMatches, patternFingerprints, resolveSitePattern, urlMatchesRule, type SitePatternDefinition } from './sitePatterns';

/**
 * Receives a run's records. Runs never store anything; a record sink, a
 * script, or MCP decides what records mean. `isKnown` lets a run skip pages
 * whose records the consumer would ignore.
 */
export interface RecordConsumer {
  onRecord(record: CollectedRecord): void;
  isKnown?(key: string): boolean;
  /** What it holds of an item already (its fields), for an item read again without them (`extract`): kept, as its list's are. */
  fieldsOf?(key: string): Record<string, unknown> | null | Promise<Record<string, unknown> | null>;
  /** Where an item it holds came from (its record's provenance), for an item read again (`extract`). */
  provenanceOf?(key: string): CollectedRecordProvenance | null | Promise<CollectedRecordProvenance | null>;
  /**
   * Whether a run reads the page of an item it has just written as listed: false leaves it listed, its page read only
   * when asked for (`extract`). Read unless it says.
   */
  readsPage?(key: string): boolean | Promise<boolean>;
  /** A run (`extract`) is about to read this item's page; its record is written once it has. */
  reading?(key: string): void;
  /** Gets ready before the run reads anything (a database to open and check); failing fails the run with its reason. */
  open?(): Promise<void>;
  /** After the run: the records it was given are written, or the run fails with why one wasn't. */
  close?(): Promise<void>;
}

/**
 * A field a collection's records have. Patterns fill fields by `id`, which
 * never changes once created; `label` is what the user sees and can be
 * renamed. A required field that is missing or too short makes a record
 * `invalid`.
 */
export interface CollectionField {
  id: string;
  label: string;
  /** `long-text` fields are picked as a container and keep their line breaks. */
  kind: 'text' | 'long-text';
  required?: boolean;
  minLength?: number;
}

/**
 * Where a run starts: a list of items, such as a company's careers page or a
 * job board search. `values` fills fields the pages do not show (a careers
 * page rarely names its own company); a value read from a page wins.
 */
export interface StartPage {
  id: string;
  url: string;
  values?: Record<string, string>;
  /** False when collecting everything skips this start page; it can still be collected on its own. */
  included?: false;
  /** This page's own limits; without them, the collection's (its default limits). */
  maxPages?: number;
  maxItems?: number;
  stopAtKnownPage?: boolean;
}

/** The value every collected record has: its page's URL. It is not a configurable field. */
export const RECORD_URL_FIELD = 'url';

/**
 * A site setup: how to read one kind of page, such as Greenhouse job boards
 * or one company's careers page. Its patterns name it (`siteId`), and their
 * scope rules say which addresses it reads, so a start page is read by
 * whichever setup matches it; nothing ties the two together.
 */
export interface CollectionSite {
  id: string;
  name: string;
  /** Who published it, and its version, when it was not set up here: a pasted setup with the same id updates it. */
  from?: { name: string; version: number };
}

/** The document snapshot stored in a galaxy.web-collection block. Its patterns are its own: runs use nothing else. */
export interface CollectionDefinition {
  capabilityId: string;
  name: string;
  /** What one item is called when setting up a site, such as "job" ("Pick an example job row"). Defaults to "item". */
  itemName?: string;
  fields: CollectionField[];
  startPages: StartPage[];
  sites: CollectionSite[];
  patterns: SitePatternDefinition[];
  /** Default limits for each start page: list pages read, following Next, and new items read. */
  maxPages: number;
  maxItems: number;
  /**
   * Stop following Next at a list page whose items are all already in the document: on a list with the newest first,
   * the rest are older. Off unless set.
   */
  stopAtKnownPage?: boolean;
  /**
   * False when a run reads only the lists: each new item is written as listed (what its list shows), and its own page is
   * read later, when asked for (`extract`). Read in the same run unless set.
   */
  readItemPages?: false;
  followLinksToOtherSites: boolean;
  /** Record identity. Defaults to the canonical URL of the record's page. */
  key?: RecordKeyStrategy;
  /** Query parameters ignored when canonicalizing URLs (defaults cover tracking parameters). */
  ignoredQueryParameters?: string[];
}

export type CollectionRunStatus = 'running' | 'needs-attention' | 'done' | 'stopped' | 'failed';

/**
 * One start page's part of a run. A start page's lists are read first (every page, with Next), so how much there is to collect
 * is known before any item's page is visited.
 */
export interface StartPageProgress {
  status: 'waiting' | 'reading' | 'collecting' | 'done' | 'stopped' | 'failed';
  /** List pages read. */
  pages: number;
  /** Items found on them. */
  found: number;
  /** Of those, already in the document: skipped. */
  known: number;
  /** Of those, to be read. */
  toCollect: number;
  /** Of those, written as listed only, for their pages to be read later (a run that reads only lists). */
  listed: number;
  /** Of those, written as listed, their pages left unread as the consumer asked (`readsPage`). */
  leftUnread: number;
  /** Read so far: collected or with a problem. */
  read: number;
  collected: number;
  problems: number;
  /** The item being read now: its title from the list, or its address. */
  current: string | null;
}

/** A page a run opened and could not read, and why. */
export interface CollectionProblem {
  /** A start page itself, or an item one listed. */
  kind: 'start-page' | 'item';
  url: string;
  /** The item's title, when the list showed one. */
  title: string | null;
  problem: string;
  /** An item's: the site setup whose list it was found on, so it can be added to that setup as another example. */
  siteId?: string;
  /** An item's: what its list showed of it, kept when it is read again (`extract`). */
  values?: Record<string, unknown>;
}

/** An item to read on its own page, as a run reads one its list showed: its address, and what the list showed of it. */
export interface ExtractItem {
  url: string;
  /**
   * What its list showed (its title, its company): kept, and what its page shows is added to it. Without it, what the
   * consumer holds of the item already (`fieldsOf`).
   */
  values?: Record<string, unknown>;
  /** The site setup whose list showed it, for its problem. */
  siteId?: string;
}

export interface CollectionRunState {
  runId: string;
  capabilityId: string;
  profileId: string;
  status: CollectionRunStatus;
  page: number;
  collected: number;
  skipped: number;
  /** Items written as listed only: their pages not read in this run. */
  listed: number;
  /** Items written as listed, their pages left unread as the consumer asked (`readsPage`). */
  leftUnread: number;
  problems: number;
  /** Start pages this run could not read at all, by start page id: a site to set up, not an item. */
  startPageProblems: Record<string, string>;
  /** Every page this run opened and could not read, and why, in the order it found them: what "with problems" counts. */
  problemPages: CollectionProblem[];
  /** The items it wrote as listed only, in the order it found them, for their pages to be read (`extract`): what "listed" counts. */
  listedItems: ExtractItem[];
  /** Each start page's progress, by start page id. */
  startPages: Record<string, StartPageProgress>;
  /**
   * The page waiting for the user. An item's page that doesn't look as its site setup expects names that setup
   * (`siteId`), so it can be added to it as another example.
   */
  attention: { workerId: string; url: string; reason: string; siteId?: string } | null;
  error: string | null;
}

export function isNavigationAllowed(definition: CollectionDefinition, url: string, linkFromListing: boolean): boolean {
  const origin = new URL(url).origin;
  if (definition.startPages.some((startPage) => new URL(startPage.url).origin === origin)) return true;
  if (definition.patterns.some((pattern) => pattern.appliesTo.some((rule) => urlMatchesRule(rule, url)))) return true;
  return linkFromListing && definition.followLinksToOtherSites;
}

export interface SitePatternTestResult {
  url: string;
  /** Whether a page or frame URL rule covers the URL; null when the pattern has none. */
  scopeMatched: boolean | null;
  /** Whether the fingerprint matched; null when the pattern has none. */
  fingerprintMatched: boolean | null;
  confidence: number | null;
  records: number;
  passes: boolean;
  attention: string | null;
}

/** A list row's item: its link field, against the list page's address. */
export function itemLink(pattern: SitePatternDefinition, values: Record<string, unknown>, listingUrl: string): string | null {
  const value = values[pattern.linkFieldId ?? ''];
  return typeof value === 'string' ? new URL(value, listingUrl).href : null;
}

/**
 * Site setup, picking an example item: the row's item opened as a run opens it, in a worker of the profile: the list
 * page loaded, then the row's link (`itemLink`) followed from it, each in turn on the site. Its address is where the
 * worker ended up (after any redirects), so the example is picked on the page runs read.
 */
export async function openListedItem(
  deps: { scheduler: WorkerScheduler; host: BrowserHost },
  profileId: string,
  listUrl: string,
  link: string,
): Promise<{ url: string }> {
  return deps.scheduler.run({ profileId, kind: 'collection', origin: new URL(listUrl).origin, label: `Open ${link}`, interactive: true }, async (lease) => {
    // Opened because the user just picked it, as their own click would: without the delay between a run's loads.
    await lease.paced(listUrl, () => deps.host.navigate(lease.workerId, listUrl), { delay: false });
    await lease.paced(link, () => deps.host.navigate(lease.workerId, link), { delay: false });
    const opened = await deps.host.inspect(lease.workerId, { patterns: [], fingerprints: {} });
    return { url: opened.url };
  });
}

/** How long a click on what opens an item has to go somewhere before it is taken to have opened nothing. */
export const OPENED_BY_CLICK_MS = 3_000;
const OPEN_BY_CLICK_COMMAND_ID = 'open-item-by-click';

/**
 * Site setup, picking an example item whose opener has no link (the page's script opens it): in a worker of the
 * profile, the list page loaded, the row found again by its values, and its opener clicked, as a one-step command in
 * the row. The item is where the page went within `OPENED_BY_CLICK_MS`; null when it went nowhere.
 */
export async function openListedItemByClick(
  deps: { scheduler: WorkerScheduler; host: BrowserHost; clock: Clock },
  profileId: string,
  listUrl: string,
  pattern: SitePatternDefinition,
  values: Record<string, unknown>,
): Promise<{ url: string } | null> {
  const matcher = pattern.matcher as { pattern: { opener?: unknown }; commands: Record<string, unknown> };
  const command = { id: OPEN_BY_CLICK_COMMAND_ID, name: 'Open item', scope: 'record', steps: [{ gesture: 'click', target: matcher.pattern.opener }] };
  const clicking = { ...pattern, matcher: { ...matcher, commands: { ...matcher.commands, [OPEN_BY_CLICK_COMMAND_ID]: command } } };
  return deps.scheduler.run({ profileId, kind: 'collection', origin: new URL(listUrl).origin, label: `Open an item on ${listUrl}`, interactive: true }, async (lease) => {
    const listed = await lease.paced(listUrl, () => deps.host.navigate(lease.workerId, listUrl), { delay: false });
    const inspection = await deps.host.inspect(lease.workerId, { patterns: [pattern], fingerprints: patternFingerprints([pattern]) });
    const row = inspection.matches[pattern.id]?.records.find((record) => JSON.stringify(record.values) === JSON.stringify(values));
    if (!row) throw new Error('That item wasn’t in the list when it was loaded again. Pick it again.');
    const clicked = await deps.host.runCommand(lease.workerId, { pattern: clicking, commandId: OPEN_BY_CLICK_COMMAND_ID, recordRef: row.ref });
    if (clicked.status !== 'executed') return null;
    const deadline = deps.clock.now() + OPENED_BY_CLICK_MS;
    for (;;) {
      const at = await deps.host.inspect(lease.workerId, { patterns: [], fingerprints: {} });
      if (at.url !== listed.url) return { url: at.url };
      if (deps.clock.now() >= deadline) return null;
      await deps.clock.sleep(250);
    }
  });
}

/**
 * Pattern builder "Test on another site": loads a URL in a worker of the
 * chosen profile and checks both scope and structural confidence there.
 */
export async function testSitePattern(
  deps: { scheduler: WorkerScheduler; host: BrowserHost },
  profileId: string,
  pattern: SitePatternDefinition,
  url: string,
): Promise<SitePatternTestResult> {
  return deps.scheduler.run({ profileId, kind: 'collection', origin: new URL(url).origin, label: `Test ${pattern.name}`, interactive: true }, async (lease) => {
    await lease.paced(url, () => deps.host.navigate(lease.workerId, url));
    const inspection = await deps.host.inspect(lease.workerId, { patterns: [pattern], fingerprints: patternFingerprints([pattern]) });
    const urlRules = pattern.appliesTo.filter((rule) => rule.target !== 'fingerprint');
    const hasFingerprint = pattern.appliesTo.some((rule) => rule.target === 'fingerprint');
    const scopeMatched = urlRules.length ? urlRules.some((rule) => urlMatchesRule(rule, url)) : null;
    const fingerprintMatched = hasFingerprint ? Boolean(inspection.fingerprintMatches[pattern.id]) : null;
    const match = inspection.matches[pattern.id];
    const confidence = match?.confidence ?? null;
    return {
      url,
      scopeMatched,
      fingerprintMatched,
      confidence,
      records: match?.records.length ?? 0,
      passes: inspection.ready && (scopeMatched === true || fingerprintMatched === true) && (confidence ?? 0) >= pattern.minimumConfidence,
      attention: inspection.ready ? null : inspection.attention ?? 'page-not-ready',
    };
  });
}

interface ActiveRun {
  state: CollectionRunState;
  definition: CollectionDefinition;
  controller: AbortController;
  resumeAttention: (() => void) | null;
  /** The user let the page waiting for them go (`skip`): it is reported, not looked at again. */
  skipAttention: boolean;
  /** The user opened the waiting page in its own window: the worker loads it again on Resume, to see what they did. */
  reloadAfterAttention: boolean;
  /** The page waiting for the user now, and those waiting behind it: a run asks about one page at a time. */
  attentionTurn: Promise<void>;
  consumer: RecordConsumer;
  /** Each item's site setup (its list's), for its problem. */
  itemSites: Map<string, string>;
  /** An `extract` run's items not opened yet, and those whose page is open and being read: each item's key by its URL. */
  waiting: Map<string, string>;
  reading: Map<string, string>;
}

/** The items a collection's runs are reading on their own pages (`extract`), by key: still to open, and open now. */
export interface ItemsInProgress {
  waiting: string[];
  reading: string[];
}

type ListingResolution = { pattern: SitePatternDefinition; match: PatternMatch } | null;

export class CollectionService {
  private readonly runs = new Map<string, ActiveRun>();
  private nextRunId = 1;

  constructor(private readonly deps: {
    scheduler: WorkerScheduler;
    host: BrowserHost;
    clock: Clock;
    emit: AutomationEmit;
    /** Runs no one is watching (a site setup's Test): a page that needs the user is reported, not waited on. */
    unattended?: boolean;
  }) {}

  getState(): CollectionRunState[] {
    return [...this.runs.values()].map((run) => structuredClone(run.state));
  }

  start(definition: CollectionDefinition, profileId: string, consumer: RecordConsumer, startPages = definition.startPages): { runId: string; done: Promise<CollectionRunState> } {
    const run = this.createRun(definition, profileId, consumer);
    for (const startPage of startPages) {
      run.state.startPages[startPage.id] = { status: 'waiting', pages: 0, found: 0, known: 0, toCollect: 0, listed: 0, leftUnread: 0, read: 0, collected: 0, problems: 0, current: null };
    }
    const done = this.withConsumer(run, () => Promise.allSettled(startPages.map((startPage) => this.deps.scheduler.run(
      { profileId, kind: 'collection', origin: new URL(startPage.url).origin, label: `${definition.name}: ${new URL(startPage.url).host}`, signal: run.controller.signal },
      (lease) => this.collectFrom(run, lease, startPage),
    )))).then((results) => this.finish(run, results));
    return { runId: run.state.runId, done };
  }

  /**
   * Reads items on their own pages, as a run reads those its lists showed: one typed in, or ones listed earlier whose
   * pages were not read, or could not be (Retry). Items on one site are read in turn, as a run reads them; one item
   * alone goes first, as asked for.
   */
  extract(definition: CollectionDefinition, profileId: string, items: ExtractItem[], consumer: RecordConsumer): { runId: string; done: Promise<CollectionRunState> } {
    const run = this.createRun(definition, profileId, consumer);
    const sites = new Map<string, ExtractItem[]>();
    for (const item of items) {
      const origin = new URL(item.url).origin;
      sites.set(origin, [...(sites.get(origin) ?? []), item]);
      if (item.siteId) run.itemSites.set(item.url, item.siteId);
      const key = this.keyFor(run, item.url, item.values ?? {});
      if (key) run.waiting.set(item.url, key);
    }
    const done = this.withConsumer(run, () => Promise.allSettled([...sites].map(([origin, siteItems]) => this.deps.scheduler.run(
      { profileId, kind: 'collection', origin, label: `${definition.name}: ${siteItems.length === 1 ? siteItems[0].url : `${siteItems.length} pages on ${new URL(origin).host}`}`, interactive: items.length === 1, signal: run.controller.signal },
      async (lease) => {
        for (const item of siteItems) {
          const key = this.keyFor(run, item.url, item.values ?? {});
          const listed = item.values ?? (key ? await run.consumer.fieldsOf?.(key) : null) ?? null;
          // Read with the site setup it came from, as its record says (or the pattern that listed or read it, in a record
          // written before records kept the setup), when not given one.
          const provenance = !run.itemSites.has(item.url) && key ? await run.consumer.provenanceOf?.(key) : null;
          const siteId = provenance?.siteId ?? run.definition.patterns.find((pattern) => pattern.id === provenance?.patternId)?.siteId;
          if (siteId) run.itemSites.set(item.url, siteId);
          // An item its list showed came from a list, where a run may follow links to other sites.
          this.assertAllowed(run, item.url, listed !== null);
          // Its turn come (after the pause between pages), the consumer is told as its page opens.
          await this.paced(run, lease, item.url, () => {
            run.waiting.delete(item.url);
            if (key) {
              run.reading.set(item.url, key);
              run.consumer.reading?.(key);
            }
            return this.deps.host.navigate(lease.workerId, item.url);
          });
          try {
            await this.writeDetail(run, lease, item.url, await this.inspectAt(run, lease), listed ?? {});
          } finally {
            run.reading.delete(item.url);
          }
        }
      },
    )))).then((results) => this.finish(run, results));
    return { runId: run.state.runId, done };
  }

  /** A run between its consumer's open and close: either failing is the run's failure. */
  private async withConsumer(run: ActiveRun, collect: () => Promise<PromiseSettledResult<unknown>[]>): Promise<PromiseSettledResult<unknown>[]> {
    try {
      await run.consumer.open?.();
    } catch (reason) {
      return [{ status: 'rejected', reason }];
    }
    const results = await collect();
    try {
      await run.consumer.close?.();
    } catch (reason) {
      return [...results, { status: 'rejected', reason }];
    }
    return results;
  }

  async show(runId: string): Promise<void> {
    const attention = this.runs.get(runId)?.state.attention;
    if (attention) await this.deps.host.showWorker(attention.workerId);
  }

  /**
   * Opens the page waiting for the user in its own window, in the run's profile, with nothing of Galaxy's in it (as a
   * person sees it: a check that you're human may refuse a page our scripts are in). The worker, which shares the
   * profile, loads the page again on Resume.
   */
  async openPage(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    const attention = run?.state.attention;
    if (!run || !attention) return;
    run.reloadAfterAttention = true;
    await this.deps.host.openUserWindow(run.state.profileId, attention.url);
  }

  /** What the collection's runs are reading on items' own pages now (`extract`), by key. */
  inProgress(capabilityId: string): ItemsInProgress {
    const runs = [...this.runs.values()].filter((run) => run.definition.capabilityId === capabilityId);
    return {
      waiting: runs.flatMap((run) => [...run.waiting.values()]),
      reading: runs.flatMap((run) => [...run.reading.values()]),
    };
  }

  resume(runId: string): void {
    this.runs.get(runId)?.resumeAttention?.();
  }

  /**
   * Lets the page waiting for the user go without looking at it again: it is reported as the run's problem (an item's
   * page with its site setup, to be added as an example and retried), and the run carries on.
   */
  skip(runId: string): void {
    const run = this.runs.get(runId);
    if (!run?.resumeAttention) return;
    run.skipAttention = true;
    run.resumeAttention();
  }

  stop(runId: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    run.controller.abort(new WebAutomationError('stopped', 'The collection was stopped.'));
    run.resumeAttention?.();
  }

  private createRun(definition: CollectionDefinition, profileId: string, consumer: RecordConsumer): ActiveRun {
    const runId = `run-${this.nextRunId++}`;
    const run: ActiveRun = {
      definition,
      controller: new AbortController(),
      resumeAttention: null,
      skipAttention: false,
      reloadAfterAttention: false,
      attentionTurn: Promise.resolve(),
      consumer,
      itemSites: new Map(),
      waiting: new Map(),
      reading: new Map(),
      state: { runId, capabilityId: definition.capabilityId, profileId, status: 'running', page: 0, collected: 0, skipped: 0, listed: 0, leftUnread: 0, problems: 0, startPageProblems: {}, problemPages: [], listedItems: [], startPages: {}, attention: null, error: null },
    };
    this.runs.set(runId, run);
    this.deps.emit('collection', `${runId} started: ${definition.name}`, { profileId });
    return run;
  }

  private finish(run: ActiveRun, results: PromiseSettledResult<unknown>[]): CollectionRunState {
    // Items a stopped or failed run never reached are no longer coming.
    run.waiting.clear();
    run.reading.clear();
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    // A start page still waiting for a worker when the run ended never started.
    for (const progress of Object.values(run.state.startPages)) if (progress.status === 'waiting') progress.status = 'stopped';
    if (run.controller.signal.aborted) run.state.status = 'stopped';
    else if (failure) {
      run.state.status = 'failed';
      run.state.error = errorMessage(failure.reason);
    } else run.state.status = 'done';
    this.deps.emit('collection', `${run.state.runId} ${run.state.status}: ${run.state.collected} collected, ${run.state.listed} listed, ${run.state.leftUnread} left unread, ${run.state.skipped} skipped, ${run.state.problems} problems`);
    return structuredClone(run.state);
  }

  /**
   * What Stop doesn't wait for: a page still loading or being read ends the run at once, as Stop is pressed, instead of
   * when it is done. The page is left as it is; the worker's next use navigates it.
   */
  private stoppable<T>(run: ActiveRun, work: Promise<T>): Promise<T> {
    const { signal } = run.controller;
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise<T>((resolve, reject) => {
      const stopped = () => reject(signal.reason);
      signal.addEventListener('abort', stopped, { once: true });
      work.then(resolve, reject).finally(() => signal.removeEventListener('abort', stopped));
    });
  }

  /** A load in its turn on the site (after the pause between loads there), stopped as `stoppable`; stopped while it waits, it never starts. */
  private paced<T>(run: ActiveRun, lease: WorkerLease, url: string, load: () => Promise<T>): Promise<T> {
    return this.stoppable(run, lease.paced(url, () => {
      this.checkStopped(run);
      return load();
    }));
  }

  private checkStopped(run: ActiveRun): void {
    if (run.controller.signal.aborted) throw run.controller.signal.reason;
  }

  private assertAllowed(run: ActiveRun, url: string, linkFromListing: boolean): void {
    if (!isNavigationAllowed(run.definition, url, linkFromListing)) {
      throw new WebAutomationError('out_of_scope', `${new URL(url).host} is outside "${run.definition.name}".`);
    }
  }

  /**
   * Collects from one start page: its lists first, every page with Next, noting each item's link and what the list shows of
   * it (and skipping items already in the document); then each item's own page. A side-pane board's items open beside
   * the list, so they are read as the list is.
   */
  private async collectFrom(run: ActiveRun, lease: WorkerLease, startPage: StartPage): Promise<void> {
    const progress = run.state.startPages[startPage.id];
    try {
      await this.readStartPage(run, lease, startPage, progress);
      progress.status = 'done';
    } catch (error) {
      progress.status = run.controller.signal.aborted ? 'stopped' : 'failed';
      throw error;
    } finally {
      progress.current = null;
      this.deps.emit('collection', `${startPage.id}: ${progress.status}`);
    }
  }

  private async readStartPage(run: ActiveRun, lease: WorkerLease, startPage: StartPage, progress: StartPageProgress): Promise<void> {
    const { host, emit } = this.deps;
    const startUrl = startPage.url;
    // The start page's fixed values, for what its pages do not show. Values read from a page win.
    const fixed: Record<string, unknown> = { ...(startPage.values ?? {}) };
    progress.status = 'reading';
    this.assertAllowed(run, startUrl, false);
    await this.paced(run, lease, startUrl, () => host.navigate(lease.workerId, startUrl));
    const start = await this.resolveExpected(run, lease, await this.inspectAt(run, lease), 'listing');
    if (start.kind !== 'match') {
      // Not a listing we know: the start page may be one item's own page. If nothing reads it as one, the site needs
      // setting up (or its list setup no longer matches); that is the start page's problem, not an item.
      await this.tracked(run, progress, () => this.writeDetail(run, lease, startUrl, start.inspection, fixed, (problem) => {
        run.state.problems += 1;
        run.state.startPageProblems[startPage.id] = problem;
        run.state.problemPages.push({ kind: 'start-page', url: startUrl, title: null, problem });
        emit('collection', `start page ${startPage.id}: ${problem}`);
      }));
      return;
    }
    const queue = await this.readLists(run, lease, startPage, progress, fixed, start);
    progress.status = 'collecting';
    emit('collection', `${startPage.id}: ${queue.length} to collect`);
    for (const item of queue) {
      this.checkStopped(run);
      progress.current = item.title;
      emit('collection', `${startPage.id}: reading ${item.title}`);
      await this.paced(run, lease, item.link, () => host.navigate(lease.workerId, item.link));
      await this.tracked(run, progress, async () => this.writeDetail(run, lease, item.link, await this.inspectAt(run, lease), item.values));
    }
  }

  /** Reads every list page of a start page, with Next: the items to visit, in order. Items already known are skipped. */
  private async readLists(
    run: ActiveRun,
    lease: WorkerLease,
    startPage: StartPage,
    progress: StartPageProgress,
    fixed: Record<string, unknown>,
    start: { pattern: SitePatternDefinition; match: PatternMatch; inspection: PageInspection },
  ): Promise<Array<{ link: string; title: string; values: Record<string, unknown> }>> {
    const { host, emit } = this.deps;
    const queue: Array<{ link: string; title: string; values: Record<string, unknown> }> = [];
    const seen = new Set<string>();
    // This page's limits, or the collection's defaults: new items to read from it, and list pages to walk.
    const maxItems = startPage.maxItems ?? run.definition.maxItems;
    const maxPages = startPage.maxPages ?? run.definition.maxPages;
    const stopAtKnown = startPage.stopAtKnownPage ?? run.definition.stopAtKnownPage ?? false;
    let inspection = start.inspection;
    let listing: ListingResolution = { pattern: start.pattern, match: start.match };
    for (let page = 1; ; page += 1) {
      run.state.page = page;
      progress.pages = page;
      const listingUrl = inspection.url;
      const pattern: SitePatternDefinition = listing.pattern;
      let newLinks = 0;
      let knownOnPage = 0;
      for (const record of listing.match.records) {
        this.checkStopped(run);
        const link = itemLink(pattern, record.values, listingUrl);
        if (!link) continue;
        const linkKey = canonicalUrl(link, run.definition.ignoredQueryParameters);
        if (seen.has(linkKey)) continue;
        seen.add(linkKey);
        newLinks += 1;
        progress.found += 1;
        const listingValues = { ...fixed, ...this.mapFields(pattern, record.values) };
        // A key from listing values alone lets the consumer skip the page; field keys
        // that only appear on the detail page are checked by the consumer when it receives the record.
        const knownKey = this.keyFor(run, link, listingValues);
        if (knownKey && run.consumer.isKnown?.(knownKey)) {
          run.state.skipped += 1;
          progress.known += 1;
          knownOnPage += 1;
          emit('collection', `skip known ${knownKey}`);
          continue;
        }
        if (progress.toCollect + progress.listed >= maxItems) {
          emit('collection', `${startPage.id}: reached its limit of ${maxItems} new items`);
          return queue;
        }
        const title = typeof listingValues.title === 'string' && listingValues.title ? listingValues.title : link;
        if (pattern.siteId) run.itemSites.set(link, pattern.siteId);
        const itemCommandId = pattern.itemCommandId;
        if (itemCommandId) {
          // Side-pane board: the item opens beside the listing; there is no navigation to undo. It is read as the list
          // is, even in a run that reads only lists: only the list opens it.
          progress.toCollect += 1;
          progress.current = title;
          const opened = await this.paced(run, lease, listingUrl, () => host.runCommand(lease.workerId, { pattern, commandId: itemCommandId, recordRef: record.ref }));
          await this.tracked(run, progress, async () => {
            if (opened.status !== 'executed') this.writeProblem(run, link, listingValues, `The item command returned ${opened.status}.`);
            else await this.writeDetail(run, lease, link, await this.inspectAt(run, lease), listingValues);
          });
          continue;
        }
        if (!isNavigationAllowed(run.definition, link, true)) {
          emit('collection', `skip out of scope ${link}`);
          continue;
        }
        // In the document as soon as its list shows it, before its page is read: later in this run, or, in a run that reads
        // only lists, when asked for. One keyed by what only its page shows is read in this run either way: written now,
        // it would be another item than its page's.
        if (knownKey) this.emitRecord(run, link, listingValues, 'listed', pattern.id, undefined);
        if (knownKey && run.definition.readItemPages === false) {
          progress.listed += 1;
          run.state.listed += 1;
          run.state.listedItems.push({ url: link, values: listingValues, ...(pattern.siteId ? { siteId: pattern.siteId } : {}) });
          continue;
        }
        if (knownKey && run.consumer.readsPage && !(await run.consumer.readsPage(knownKey))) {
          progress.leftUnread += 1;
          run.state.leftUnread += 1;
          emit('collection', `leave unread ${knownKey}`);
          continue;
        }
        queue.push({ link, title, values: listingValues });
        progress.toCollect += 1;
      }
      // A page that adds nothing (Next on the last page often shows it again) is not one of the start page's pages.
      if (newLinks === 0 && page > 1) progress.pages = page - 1;
      emit('collection', `${startPage.id}: page ${progress.pages}, ${progress.found} found, ${progress.known} already listed`);
      const paginationCommandId = pattern.paginationCommandId;
      if (page >= maxPages || !paginationCommandId || newLinks === 0) return queue;
      if (stopAtKnown && knownOnPage === newLinks) {
        emit('collection', `${startPage.id}: every item on page ${page} is already listed, so the rest are too`);
        return queue;
      }
      this.checkStopped(run);
      const result = await this.paced(run, lease, listingUrl, () => host.runCommand(lease.workerId, { pattern, commandId: paginationCommandId, pageNumber: page + 1 }));
      if (result.status !== 'executed') {
        emit('collection', `no next page (${result.status})`);
        return queue;
      }
      emit('collection', `page ${page + 1}`);
      inspection = await this.inspectAt(run, lease);
      listing = this.matchPattern(inspection, pattern);
      if (!listing) return queue;
    }
  }

  /** Reads one item (or reports its problem), counting it for its start page. */
  private async tracked(run: ActiveRun, progress: StartPageProgress, read: () => Promise<void>): Promise<void> {
    const before = { collected: run.state.collected, problems: run.state.problems };
    try {
      await read();
    } finally {
      const collected = run.state.collected - before.collected;
      const problems = run.state.problems - before.problems;
      progress.collected += collected;
      progress.problems += problems;
      progress.read += collected + problems;
    }
  }

  /**
   * Inspects the page with the patterns that could apply there: those whose page rules cover its address, and every
   * frame and fingerprint pattern (which only the page itself can rule out). Matching is the slow part of an
   * inspection, so patterns for other sites are not run.
   */
  private async inspectAt(run: ActiveRun, lease: WorkerLease): Promise<PageInspection> {
    for (;;) {
      this.checkStopped(run);
      const { url } = await this.stoppable(run, this.deps.host.inspect(lease.workerId, { patterns: [], fingerprints: {} }));
      const patterns = run.definition.patterns.filter((pattern) => pattern.appliesTo.some((rule) => rule.target !== 'page' || urlMatchesRule(rule, url)));
      const inspection = await this.stoppable(run, this.deps.host.inspect(lease.workerId, {
        patterns,
        fingerprints: patternFingerprints(patterns),
      }));
      if (inspection.ready) return inspection;
      // Let go, the page is read as it is: what it doesn't show is its problem.
      if (!await this.waitForAttention(run, lease.workerId, inspection.url, inspection.attention ?? 'page-not-ready')) return inspection;
    }
  }

  /** Waits for the user to deal with a page; false when they let it go (`skip`) rather than resumed. */
  private async waitForAttention(run: ActiveRun, workerId: string, url: string, reason: string, siteId?: string): Promise<boolean> {
    if (this.deps.unattended) {
      this.deps.emit('collection', `${run.state.runId} let ${url} go: ${reason}, with no one to ask`);
      return false;
    }
    // Several pages of a run can need the user at once (two workers on a site that challenges both): the run asks
    // about one, and the next asks once the user dealt with it.
    const previous = run.attentionTurn;
    let dealtWith = () => {};
    run.attentionTurn = previous.then(() => new Promise<void>((resolve) => {
      dealtWith = resolve;
    }));
    await previous;
    try {
      this.checkStopped(run);
      run.state.status = 'needs-attention';
      run.state.attention = { workerId, url, reason, ...(siteId ? { siteId } : {}) };
      this.deps.emit('collection', `${run.state.runId} needs attention: ${reason} at ${url}`);
      await new Promise<void>((resolve) => {
        run.resumeAttention = resolve;
      });
      run.resumeAttention = null;
      run.state.attention = null;
      run.state.status = 'running';
      await this.deps.host.hideWorker(workerId);
      this.checkStopped(run);
      if (run.skipAttention) {
        run.skipAttention = false;
        run.reloadAfterAttention = false;
        this.deps.emit('collection', `${run.state.runId} let ${url} go`);
        return false;
      }
      if (run.reloadAfterAttention) {
        run.reloadAfterAttention = false;
        await this.stoppable(run, this.deps.host.navigate(workerId, url));
      }
      this.deps.emit('collection', `${run.state.runId} resumed`);
      return true;
    } finally {
      dealtWith();
    }
  }

  private matchPattern(inspection: PageInspection, pattern: SitePatternDefinition): ListingResolution {
    const match = inspection.matches[pattern.id];
    return match && match.confidence >= pattern.minimumConfidence ? { pattern, match } : null;
  }

  /**
   * Resolves the pattern for a role. A frame rule match opens the iframe's
   * src on its own (first version; in-frame extraction comes later).
   */
  private async resolveRole(run: ActiveRun, lease: WorkerLease, inspection: PageInspection, role: SitePatternDefinition['role'], siteId?: string): Promise<
    | { kind: 'match'; pattern: SitePatternDefinition; match: PatternMatch; inspection: PageInspection }
    | { kind: 'ambiguous'; names: string[]; inspection: PageInspection }
    | { kind: 'none'; inspection: PageInspection }
  > {
    // A page reached from a site setup's list (or read again, its record saying which setup) is read with that setup's
    // pattern, whatever its address: address rules are for pages no setup is known for. One it doesn't fit is resolved
    // by its address, as those are.
    const own = siteId ? run.definition.patterns.filter((pattern) => pattern.role === role && pattern.siteId === siteId) : [];
    if (own.length) {
      const uninspected = own.filter((pattern) => !(pattern.id in inspection.matches));
      const page = uninspected.length
        ? { ...inspection, matches: { ...inspection.matches, ...(await this.stoppable(run, this.deps.host.inspect(lease.workerId, { patterns: uninspected, fingerprints: {} }))).matches } }
        : inspection;
      const matched = own.map((pattern) => this.matchPattern(page, pattern)).find(Boolean);
      if (matched) return { kind: 'match', pattern: matched.pattern, match: matched.match, inspection: page };
    }
    const resolution = resolveSitePattern(run.definition.patterns, role, inspection);
    if (resolution.kind === 'ambiguous') return { kind: 'ambiguous', names: resolution.candidates.map((pattern) => pattern.name), inspection };
    if (resolution.kind === 'none') return { kind: 'none', inspection };
    let page = inspection;
    if (resolution.via === 'frame') {
      this.assertAllowed(run, resolution.frameSrc, false);
      this.deps.emit('collection', `opening frame on its own: ${resolution.frameSrc}`);
      await this.paced(run, lease, resolution.frameSrc, () => this.deps.host.navigate(lease.workerId, resolution.frameSrc));
      page = await this.inspectAt(run, lease);
    }
    const matched = this.matchPattern(page, resolution.pattern);
    if (!matched) {
      this.deps.emit('collection', `${resolution.pattern.name} is below its confidence threshold at ${page.url}`);
      return { kind: 'none', inspection: page };
    }
    return { kind: 'match', pattern: matched.pattern, match: matched.match, inspection: page };
  }

  /** The configured fields a pattern read here. An empty value is not a value: it never replaces a fixed one. */
  private mapFields(pattern: SitePatternDefinition, values: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(pattern.fields
      .filter((field) => field.kind !== 'link' && values[field.id] !== undefined && values[field.id] !== null && values[field.id] !== '')
      .map((field) => [field.id, values[field.id]]));
  }

  /**
   * Whether a site setup reads this address for a role: one of its patterns' page rules covers it, or, for a page of a
   * known setup, that setup has a pattern for the role on the page's site (its host).
   */
  private covers(run: ActiveRun, url: string, role: SitePatternDefinition['role'], siteId?: string): boolean {
    const host = new URL(url).hostname;
    return run.definition.patterns.some((pattern) => pattern.role === role && pattern.appliesTo.some((rule) => rule.target === 'page'
      && (urlMatchesRule(rule, url) || (siteId !== undefined && pattern.siteId === siteId && hostMatches(rule.host, host)))));
  }

  /**
   * Resolves a role on a page, asking a person first when the page is one a site setup covers but does not look as it
   * expects: usually a sign-in screen, a check to prove you're human, or a cookie wall, which only a person should
   * deal with. The run waits with Needs attention (Show, Resume), then looks again once; a page that still does not
   * match (the site changed) is reported as before.
   */
  private async resolveExpected(run: ActiveRun, lease: WorkerLease, inspection: PageInspection, role: SitePatternDefinition['role'], siteId?: string): ReturnType<CollectionService['resolveRole']> {
    const resolved = await this.resolveRole(run, lease, inspection, role, siteId);
    if (resolved.kind !== 'none' || !this.covers(run, resolved.inspection.url, role, siteId)) return resolved;
    // An item's page names its site setup, to be added to it as another example.
    if (!await this.waitForAttention(run, lease.workerId, resolved.inspection.url, 'unexpected-page', role === 'detail' ? siteId : undefined)) return resolved;
    return this.resolveRole(run, lease, await this.inspectAt(run, lease), role, siteId);
  }

  /**
   * Reads an item's own page into a record, or reports why it couldn't. A start page read this way (its list setup
   * didn't match it) reports to `startPageProblem` instead: one that isn't a whole item is the start page's problem,
   * and no item is written for it.
   */
  private async writeDetail(run: ActiveRun, lease: WorkerLease, url: string, inspection: PageInspection, listingValues: Record<string, unknown>, startPageProblem?: (problem: string) => void): Promise<void> {
    const report = (problem: string) => (startPageProblem ? startPageProblem(problem) : this.writeProblem(run, url, listingValues, problem));
    const resolved = await this.resolveExpected(run, lease, inspection, 'detail', run.itemSites.get(url));
    if (resolved.kind === 'ambiguous') {
      report(`Several patterns could apply: ${resolved.names.join(', ')}.`);
      return;
    }
    if (resolved.kind === 'match' && resolved.match.records[0]) {
      const values = { ...listingValues, ...this.mapFields(resolved.pattern, resolved.match.records[0].values) };
      const invalid = startPageProblem ? validateRecord(values, run.definition.fields) : null;
      if (invalid) report(`It didn’t match its site setup’s list, so it was read as one ${run.definition.itemName?.trim() || 'item'}’s page: ${invalid}`);
      else this.writeRecord(run, url, values, resolved.pattern.id);
      return;
    }
    const siteId = run.itemSites.get(url);
    report(this.covers(run, url, 'detail', siteId) ? 'It didn’t look as its site setup expects.' : `No site setup reads this page (${new URL(url).host}).`);
  }

  private keyFor(run: ActiveRun, url: string, values: Record<string, unknown>): string | null {
    return recordKey(run.definition.key ?? { kind: 'url' }, url, values, run.definition.ignoredQueryParameters);
  }

  private writeRecord(run: ActiveRun, url: string, values: Record<string, unknown>, patternId: string): void {
    const problem = validateRecord(values, run.definition.fields);
    this.emitRecord(run, url, values, problem ? 'invalid' : 'ok', patternId, problem ?? undefined);
  }

  private writeProblem(run: ActiveRun, url: string, listingValues: Record<string, unknown>, problem: string): void {
    this.emitRecord(run, url, listingValues, 'no_pattern', undefined, problem);
  }

  private emitRecord(run: ActiveRun, url: string, values: Record<string, unknown>, state: CollectedRecordState, patternId: string | undefined, problem: string | undefined): void {
    // Its record written, the item's page is read: the consumer may already ask what is in progress.
    run.reading.delete(url);
    const key = this.keyFor(run, url, values);
    const siteId = run.itemSites.get(url) ?? run.definition.patterns.find((pattern) => pattern.id === patternId)?.siteId;
    const record: CollectedRecord = {
      // A record whose key fields are missing is still reported, keyed by its URL and marked invalid.
      key: key ?? canonicalUrl(url, run.definition.ignoredQueryParameters),
      url,
      values: { ...values, url },
      provenance: { sourceUrl: url, collectedAt: this.deps.clock.now(), ...(patternId ? { patternId } : {}), ...(siteId ? { siteId } : {}) },
      state: key || state !== 'ok' ? state : 'invalid',
      ...(problem ? { problem } : key || state !== 'ok' ? {} : { problem: 'The record has no value for its key.' }),
    };
    if (record.state === 'ok') run.state.collected += 1;
    else if (record.state !== 'listed') {
      run.state.problems += 1;
      run.state.problemPages.push({ kind: 'item', url, title: typeof values.title === 'string' && values.title ? values.title : null, problem: record.problem ?? '', ...(siteId ? { siteId } : {}), values });
    }
    this.deps.emit('collection', `record ${record.state}${patternId ? ` (${patternId})` : ''} ${record.key}`);
    run.consumer.onRecord(record);
  }
}
