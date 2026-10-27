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
  type CollectedRecordState,
  type RecordKeyStrategy,
} from './records';
import { patternFingerprints, resolveSitePattern, urlMatchesRule, type SitePatternDefinition } from './sitePatterns';

/**
 * Receives a run's records. Runs never store anything; a record sink, a
 * script, or MCP decides what records mean. `isKnown` lets a run skip pages
 * whose records the consumer would ignore.
 */
export interface RecordConsumer {
  onRecord(record: CollectedRecord): void;
  isKnown?(key: string): boolean;
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
  /** What one item is called when setting up a site, such as "job" ("Point at the job rows"). Defaults to "item". */
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
}

export interface CollectionRunState {
  runId: string;
  capabilityId: string;
  profileId: string;
  status: CollectionRunStatus;
  page: number;
  collected: number;
  skipped: number;
  problems: number;
  /** Start pages this run could not read at all, by start page id: a site to set up, not an item. */
  startPageProblems: Record<string, string>;
  /** Every page this run opened and could not read, and why, in the order it found them: what "with problems" counts. */
  problemPages: CollectionProblem[];
  /** Each start page's progress, by start page id. */
  startPages: Record<string, StartPageProgress>;
  attention: { workerId: string; url: string; reason: string } | null;
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
  /** The page waiting for the user now, and those waiting behind it: a run asks about one page at a time. */
  attentionTurn: Promise<void>;
  consumer: RecordConsumer;
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
  }) {}

  getState(): CollectionRunState[] {
    return [...this.runs.values()].map((run) => structuredClone(run.state));
  }

  start(definition: CollectionDefinition, profileId: string, consumer: RecordConsumer, startPages = definition.startPages): { runId: string; done: Promise<CollectionRunState> } {
    const run = this.createRun(definition, profileId, consumer);
    for (const startPage of startPages) {
      run.state.startPages[startPage.id] = { status: 'waiting', pages: 0, found: 0, known: 0, toCollect: 0, read: 0, collected: 0, problems: 0, current: null };
    }
    const done = Promise.allSettled(startPages.map((startPage) => this.deps.scheduler.run(
      { profileId, kind: 'collection', origin: new URL(startPage.url).origin, label: `${definition.name}: ${new URL(startPage.url).host}`, signal: run.controller.signal },
      (lease) => this.collectFrom(run, lease, startPage),
    ))).then((results) => this.finish(run, results));
    return { runId: run.state.runId, done };
  }

  extract(definition: CollectionDefinition, profileId: string, url: string, consumer: RecordConsumer): { runId: string; done: Promise<CollectionRunState> } {
    const run = this.createRun(definition, profileId, consumer);
    const done = Promise.allSettled([this.deps.scheduler.run(
      { profileId, kind: 'collection', origin: new URL(url).origin, label: `${definition.name}: ${url}`, interactive: true, signal: run.controller.signal },
      async (lease) => {
        this.assertAllowed(run, url, false);
        await lease.paced(url, () => this.deps.host.navigate(lease.workerId, url));
        await this.writeDetail(run, lease, url, await this.inspectAt(run, lease), {});
      },
    )]).then((results) => this.finish(run, results));
    return { runId: run.state.runId, done };
  }

  async show(runId: string): Promise<void> {
    const attention = this.runs.get(runId)?.state.attention;
    if (attention) await this.deps.host.showWorker(attention.workerId);
  }

  resume(runId: string): void {
    this.runs.get(runId)?.resumeAttention?.();
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
      attentionTurn: Promise.resolve(),
      consumer,
      state: { runId, capabilityId: definition.capabilityId, profileId, status: 'running', page: 0, collected: 0, skipped: 0, problems: 0, startPageProblems: {}, problemPages: [], startPages: {}, attention: null, error: null },
    };
    this.runs.set(runId, run);
    this.deps.emit('collection', `${runId} started: ${definition.name}`, { profileId });
    return run;
  }

  private finish(run: ActiveRun, results: PromiseSettledResult<unknown>[]): CollectionRunState {
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    // A start page still waiting for a worker when the run ended never started.
    for (const progress of Object.values(run.state.startPages)) if (progress.status === 'waiting') progress.status = 'stopped';
    if (run.controller.signal.aborted) run.state.status = 'stopped';
    else if (failure) {
      run.state.status = 'failed';
      run.state.error = errorMessage(failure.reason);
    } else run.state.status = 'done';
    this.deps.emit('collection', `${run.state.runId} ${run.state.status}: ${run.state.collected} collected, ${run.state.skipped} skipped, ${run.state.problems} problems`);
    return structuredClone(run.state);
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
    await lease.paced(startUrl, () => host.navigate(lease.workerId, startUrl));
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
      await lease.paced(item.link, () => host.navigate(lease.workerId, item.link));
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
        const link = typeof record.values[pattern.linkFieldId ?? ''] === 'string' ? new URL(String(record.values[pattern.linkFieldId ?? '']), listingUrl).href : null;
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
        if (progress.toCollect >= maxItems) {
          emit('collection', `${startPage.id}: reached its limit of ${maxItems} new items`);
          return queue;
        }
        const title = typeof listingValues.title === 'string' && listingValues.title ? listingValues.title : link;
        const itemCommandId = pattern.itemCommandId;
        if (itemCommandId) {
          // Side-pane board: the item opens beside the listing; there is no navigation to undo.
          progress.toCollect += 1;
          progress.current = title;
          const opened = await lease.paced(listingUrl, () => host.runCommand(lease.workerId, { pattern, commandId: itemCommandId, recordRef: record.ref }));
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
      const result = await lease.paced(listingUrl, () => host.runCommand(lease.workerId, { pattern, commandId: paginationCommandId }));
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
      const { url } = await this.deps.host.inspect(lease.workerId, { patterns: [], fingerprints: {} });
      const patterns = run.definition.patterns.filter((pattern) => pattern.appliesTo.some((rule) => rule.target !== 'page' || urlMatchesRule(rule, url)));
      const inspection = await this.deps.host.inspect(lease.workerId, {
        patterns,
        fingerprints: patternFingerprints(patterns),
      });
      if (inspection.ready) return inspection;
      await this.waitForAttention(run, lease.workerId, inspection.url, inspection.attention ?? 'page-not-ready');
    }
  }

  private async waitForAttention(run: ActiveRun, workerId: string, url: string, reason: string): Promise<void> {
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
      run.state.attention = { workerId, url, reason };
      this.deps.emit('collection', `${run.state.runId} needs attention: ${reason} at ${url}`);
      await new Promise<void>((resolve) => {
        run.resumeAttention = resolve;
      });
      run.resumeAttention = null;
      run.state.attention = null;
      run.state.status = 'running';
      await this.deps.host.hideWorker(workerId);
      this.checkStopped(run);
      this.deps.emit('collection', `${run.state.runId} resumed`);
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
  private async resolveRole(run: ActiveRun, lease: WorkerLease, inspection: PageInspection, role: SitePatternDefinition['role']): Promise<
    | { kind: 'match'; pattern: SitePatternDefinition; match: PatternMatch; inspection: PageInspection }
    | { kind: 'ambiguous'; names: string[]; inspection: PageInspection }
    | { kind: 'none'; inspection: PageInspection }
  > {
    const resolution = resolveSitePattern(run.definition.patterns, role, inspection);
    if (resolution.kind === 'ambiguous') return { kind: 'ambiguous', names: resolution.candidates.map((pattern) => pattern.name), inspection };
    if (resolution.kind === 'none') return { kind: 'none', inspection };
    let page = inspection;
    if (resolution.via === 'frame') {
      this.assertAllowed(run, resolution.frameSrc, false);
      this.deps.emit('collection', `opening frame on its own: ${resolution.frameSrc}`);
      await lease.paced(resolution.frameSrc, () => this.deps.host.navigate(lease.workerId, resolution.frameSrc));
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

  /** Whether a site setup reads this address for a role: one of its patterns' page rules covers it. */
  private covers(run: ActiveRun, url: string, role: SitePatternDefinition['role']): boolean {
    return run.definition.patterns.some((pattern) => pattern.role === role && pattern.appliesTo.some((rule) => rule.target === 'page' && urlMatchesRule(rule, url)));
  }

  /**
   * Resolves a role on a page, asking a person first when the page is one a site setup covers but does not look as it
   * expects: usually a sign-in screen, a check to prove you're human, or a cookie wall, which only a person should
   * deal with. The run waits with Needs attention (Show, Resume), then looks again once; a page that still does not
   * match (the site changed) is reported as before.
   */
  private async resolveExpected(run: ActiveRun, lease: WorkerLease, inspection: PageInspection, role: SitePatternDefinition['role']): ReturnType<CollectionService['resolveRole']> {
    const resolved = await this.resolveRole(run, lease, inspection, role);
    if (resolved.kind !== 'none' || !this.covers(run, resolved.inspection.url, role)) return resolved;
    await this.waitForAttention(run, lease.workerId, resolved.inspection.url, 'unexpected-page');
    return this.resolveRole(run, lease, await this.inspectAt(run, lease), role);
  }

  /**
   * Reads an item's own page into a record, or reports why it couldn't. A start page read this way (its list setup
   * didn't match it) reports to `startPageProblem` instead: one that isn't a whole item is the start page's problem,
   * and no item is written for it.
   */
  private async writeDetail(run: ActiveRun, lease: WorkerLease, url: string, inspection: PageInspection, listingValues: Record<string, unknown>, startPageProblem?: (problem: string) => void): Promise<void> {
    const report = (problem: string) => (startPageProblem ? startPageProblem(problem) : this.writeProblem(run, url, listingValues, problem));
    const resolved = await this.resolveExpected(run, lease, inspection, 'detail');
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
    report(`No site setup reads this page (${new URL(url).host}).`);
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
    const key = this.keyFor(run, url, values);
    const record: CollectedRecord = {
      // A record whose key fields are missing is still reported, keyed by its URL and marked invalid.
      key: key ?? canonicalUrl(url, run.definition.ignoredQueryParameters),
      url,
      values: { ...values, url },
      provenance: { sourceUrl: url, collectedAt: this.deps.clock.now(), ...(patternId ? { patternId } : {}) },
      state: key || state !== 'ok' ? state : 'invalid',
      ...(problem ? { problem } : key || state !== 'ok' ? {} : { problem: 'The record has no value for its key.' }),
    };
    if (record.state === 'ok') run.state.collected += 1;
    else {
      run.state.problems += 1;
      run.state.problemPages.push({ kind: 'item', url, title: typeof values.title === 'string' && values.title ? values.title : null, problem: record.problem ?? '' });
    }
    this.deps.emit('collection', `record ${record.state}${patternId ? ` (${patternId})` : ''} ${record.key}`);
    run.consumer.onRecord(record);
  }
}
