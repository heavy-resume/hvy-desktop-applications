import type { Clock } from './clock';
import { errorMessage, WebAutomationError } from './errors';
import type { AutomationEmit } from './events';
import type { BrowserHost, PageInspection, PatternMatch } from './host';
import { findJsonLdEntities, normalizeJsonLdEntity } from './jsonLd';
import type { WorkerLease, WorkerScheduler } from './scheduler';
import {
  canonicalUrl,
  recordKey,
  validateRecord,
  type CollectedRecord,
  type CollectedRecordState,
  type RecordKeyStrategy,
  type RequiredField,
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

/** The document snapshot stored in a galaxy.web-collection block. */
export interface CollectionDefinition {
  capabilityId: string;
  name: string;
  startUrls: string[];
  patterns: SitePatternDefinition[];
  maxPages: number;
  maxItems: number;
  followLinksToOtherSites: boolean;
  /** Extracted field ID → record value name. Unmapped fields keep their ID. */
  fieldMap?: Record<string, string>;
  /** Values a record must have to be valid; otherwise it is emitted with state `invalid`. */
  requiredFields?: RequiredField[];
  /** Record identity. Defaults to the canonical URL of the record's page. */
  key?: RecordKeyStrategy;
  /** Query parameters ignored when canonicalizing URLs (defaults cover tracking parameters). */
  ignoredQueryParameters?: string[];
  /** Fallback when no detail pattern matches: read this schema.org type from the page's JSON-LD. */
  jsonLd?: { type: string };
}

export type CollectionRunStatus = 'running' | 'needs-attention' | 'done' | 'stopped' | 'failed';

export interface CollectionRunState {
  runId: string;
  capabilityId: string;
  profileId: string;
  status: CollectionRunStatus;
  page: number;
  collected: number;
  skipped: number;
  problems: number;
  attention: { workerId: string; url: string; reason: string } | null;
  error: string | null;
}

export function collectionAuthorizationParts(definition: CollectionDefinition): Record<string, unknown> {
  return {
    sites: {
      startUrls: [...definition.startUrls].sort(),
      rules: definition.patterns.map((pattern) => ({ id: pattern.id, appliesTo: pattern.appliesTo })).sort((left, right) => left.id.localeCompare(right.id)),
      followLinksToOtherSites: definition.followLinksToOtherSites,
    },
    patterns: definition.patterns.map((pattern) => ({
      id: pattern.id,
      role: pattern.role,
      fields: pattern.fields,
      linkFieldId: pattern.linkFieldId ?? null,
      paginationCommandId: pattern.paginationCommandId ?? null,
      itemCommandId: pattern.itemCommandId ?? null,
      matcher: pattern.matcher ?? null,
    })).sort((left, right) => left.id.localeCompare(right.id)),
    extraction: {
      jsonLdType: definition.jsonLd?.type ?? null,
      key: definition.key ?? { kind: 'url' },
      ignoredQueryParameters: definition.ignoredQueryParameters ?? null,
    },
  };
}

export function isNavigationAllowed(definition: CollectionDefinition, url: string, linkFromListing: boolean): boolean {
  const origin = new URL(url).origin;
  if (definition.startUrls.some((startUrl) => new URL(startUrl).origin === origin)) return true;
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
    await lease.pace(url);
    await deps.host.navigate(lease.workerId, url);
    const inspection = await deps.host.inspect(lease.workerId, { patternIds: [pattern.id], fingerprints: patternFingerprints([pattern]) });
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
    /**
     * The user's local pattern library. Used only after the document's own
     * patterns find nothing, and never to widen where a run may navigate.
     */
    patternLibrary?: () => SitePatternDefinition[];
  }) {}

  /** Library patterns not shadowed by a document pattern with the same ID. */
  private libraryPatterns(run: ActiveRun): SitePatternDefinition[] {
    const own = new Set(run.definition.patterns.map((pattern) => pattern.id));
    return (this.deps.patternLibrary?.() ?? []).filter((pattern) => !own.has(pattern.id));
  }

  getState(): CollectionRunState[] {
    return [...this.runs.values()].map((run) => structuredClone(run.state));
  }

  start(definition: CollectionDefinition, profileId: string, consumer: RecordConsumer, startUrls = definition.startUrls): { runId: string; done: Promise<CollectionRunState> } {
    const run = this.createRun(definition, profileId, consumer);
    const done = Promise.allSettled(startUrls.map((startUrl) => this.deps.scheduler.run(
      { profileId, kind: 'collection', origin: new URL(startUrl).origin, label: `${definition.name}: ${new URL(startUrl).host}`, signal: run.controller.signal },
      (lease) => this.collectFrom(run, lease, startUrl),
    ))).then((results) => this.finish(run, results));
    return { runId: run.state.runId, done };
  }

  extract(definition: CollectionDefinition, profileId: string, url: string, consumer: RecordConsumer): { runId: string; done: Promise<CollectionRunState> } {
    const run = this.createRun(definition, profileId, consumer);
    const done = Promise.allSettled([this.deps.scheduler.run(
      { profileId, kind: 'collection', origin: new URL(url).origin, label: `${definition.name}: ${url}`, interactive: true, signal: run.controller.signal },
      async (lease) => {
        this.assertAllowed(run, url, false);
        await lease.pace(url);
        await this.deps.host.navigate(lease.workerId, url);
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
      consumer,
      state: { runId, capabilityId: definition.capabilityId, profileId, status: 'running', page: 0, collected: 0, skipped: 0, problems: 0, attention: null, error: null },
    };
    this.runs.set(runId, run);
    this.deps.emit('collection', `${runId} started: ${definition.name}`, { profileId });
    return run;
  }

  private finish(run: ActiveRun, results: PromiseSettledResult<unknown>[]): CollectionRunState {
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
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

  private async collectFrom(run: ActiveRun, lease: WorkerLease, startUrl: string): Promise<void> {
    const { host, emit } = this.deps;
    this.assertAllowed(run, startUrl, false);
    await lease.pace(startUrl);
    await host.navigate(lease.workerId, startUrl);
    const start = await this.resolveRole(run, lease, await this.inspectAt(run, lease), 'listing');
    if (start.kind !== 'match') {
      // Not a listing we know: treat the start URL as a single item.
      await this.writeDetail(run, lease, startUrl, start.inspection, {});
      return;
    }
    let inspection = start.inspection;
    let listing: ListingResolution = { pattern: start.pattern, match: start.match };
    const seen = new Set<string>();
    for (let page = 1; ; page += 1) {
      run.state.page = page;
      const listingUrl = inspection.url;
      const pattern: SitePatternDefinition = listing.pattern;
      let newLinks = 0;
      for (const record of listing.match.records) {
        this.checkStopped(run);
        if (run.state.collected + run.state.problems >= run.definition.maxItems) {
          emit('collection', `${run.state.runId} reached maxItems (${run.definition.maxItems})`);
          return;
        }
        const link = typeof record.values[pattern.linkFieldId ?? ''] === 'string' ? new URL(String(record.values[pattern.linkFieldId ?? '']), listingUrl).href : null;
        if (!link) continue;
        const linkKey = canonicalUrl(link, run.definition.ignoredQueryParameters);
        if (seen.has(linkKey)) continue;
        seen.add(linkKey);
        newLinks += 1;
        const listingValues = this.mapFields(run, pattern, record.values, pattern.linkFieldId);
        // A key from listing values alone lets the consumer skip the page; field keys
        // that only appear on the detail page are checked by the consumer when it receives the record.
        const knownKey = this.keyFor(run, link, listingValues);
        if (knownKey && run.consumer.isKnown?.(knownKey)) {
          run.state.skipped += 1;
          emit('collection', `skip known ${knownKey}`);
          continue;
        }
        if (pattern.itemCommandId) {
          // Side-pane board: the item opens beside the listing; there is no navigation to undo.
          await lease.pace(listingUrl);
          const opened = await host.runCommand(lease.workerId, { patternId: pattern.id, commandId: pattern.itemCommandId, recordRef: record.ref });
          if (opened.status !== 'executed') {
            this.writeProblem(run, link, listingValues, `The item command returned ${opened.status}.`);
            continue;
          }
          await this.writeDetail(run, lease, link, await this.inspectAt(run, lease), listingValues);
          continue;
        }
        if (!isNavigationAllowed(run.definition, link, true)) {
          emit('collection', `skip out of scope ${link}`);
          continue;
        }
        await lease.pace(link);
        await host.navigate(lease.workerId, link);
        await this.writeDetail(run, lease, link, await this.inspectAt(run, lease), listingValues);
        await lease.pace(listingUrl);
        await host.back(lease.workerId);
        inspection = await this.inspectAt(run, lease);
        listing = this.matchPattern(inspection, pattern);
        if (!listing) {
          emit('collection', `listing not restored after back; reopening ${listingUrl}`);
          await lease.pace(listingUrl);
          await host.navigate(lease.workerId, listingUrl);
          inspection = await this.inspectAt(run, lease);
          listing = this.matchPattern(inspection, pattern);
        }
        if (!listing) {
          await this.waitForAttention(run, lease.workerId, listingUrl, 'listing-not-restored');
          inspection = await this.inspectAt(run, lease);
          listing = this.matchPattern(inspection, pattern);
          if (!listing) throw new Error(`The listing at ${listingUrl} could not be restored.`);
        }
      }
      if (page >= run.definition.maxPages || !pattern.paginationCommandId || newLinks === 0) return;
      this.checkStopped(run);
      await lease.pace(listingUrl);
      const result = await host.runCommand(lease.workerId, { patternId: pattern.id, commandId: pattern.paginationCommandId });
      if (result.status !== 'executed') {
        emit('collection', `no next page (${result.status})`);
        return;
      }
      emit('collection', `page ${page + 1}`);
      inspection = await this.inspectAt(run, lease);
      listing = this.matchPattern(inspection, pattern);
      if (!listing) return;
    }
  }

  private async inspectAt(run: ActiveRun, lease: WorkerLease): Promise<PageInspection> {
    const patterns = [...run.definition.patterns, ...this.libraryPatterns(run)];
    for (;;) {
      this.checkStopped(run);
      const inspection = await this.deps.host.inspect(lease.workerId, {
        patternIds: patterns.map((pattern) => pattern.id),
        fingerprints: patternFingerprints(patterns),
      });
      if (inspection.ready) return inspection;
      await this.waitForAttention(run, lease.workerId, inspection.url, inspection.attention ?? 'page-not-ready');
    }
  }

  private async waitForAttention(run: ActiveRun, workerId: string, url: string, reason: string): Promise<void> {
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
    const own = resolveSitePattern(run.definition.patterns, role, inspection);
    const resolution = own.kind === 'none' ? resolveSitePattern(this.libraryPatterns(run), role, inspection) : own;
    if (own.kind === 'none' && resolution.kind === 'match') this.deps.emit('collection', `using library pattern "${resolution.pattern.name}"`);
    if (resolution.kind === 'ambiguous') return { kind: 'ambiguous', names: resolution.candidates.map((pattern) => pattern.name), inspection };
    if (resolution.kind === 'none') return { kind: 'none', inspection };
    let page = inspection;
    if (resolution.via === 'frame') {
      this.assertAllowed(run, resolution.frameSrc, false);
      this.deps.emit('collection', `opening frame on its own: ${resolution.frameSrc}`);
      await lease.pace(resolution.frameSrc);
      await this.deps.host.navigate(lease.workerId, resolution.frameSrc);
      page = await this.inspectAt(run, lease);
    }
    const matched = this.matchPattern(page, resolution.pattern);
    if (!matched) {
      this.deps.emit('collection', `${resolution.pattern.name} is below its confidence threshold at ${page.url}`);
      return { kind: 'none', inspection: page };
    }
    return { kind: 'match', pattern: matched.pattern, match: matched.match, inspection: page };
  }

  private mapFields(run: ActiveRun, pattern: SitePatternDefinition, values: Record<string, unknown>, omitFieldId?: string): Record<string, unknown> {
    return Object.fromEntries(pattern.fields
      .filter((field) => field.id !== omitFieldId && values[field.id] !== undefined)
      .map((field) => [run.definition.fieldMap?.[field.id] ?? field.id, values[field.id]]));
  }

  private async writeDetail(run: ActiveRun, lease: WorkerLease, url: string, inspection: PageInspection, listingValues: Record<string, unknown>): Promise<void> {
    const resolved = await this.resolveRole(run, lease, inspection, 'detail');
    if (resolved.kind === 'ambiguous') {
      this.writeProblem(run, url, listingValues, `Several patterns could apply: ${resolved.names.join(', ')}.`);
      return;
    }
    if (resolved.kind === 'match' && resolved.match.records[0]) {
      this.writeRecord(run, url, { ...listingValues, ...this.mapFields(run, resolved.pattern, resolved.match.records[0].values) }, resolved.pattern.id);
      return;
    }
    const jsonLdType = run.definition.jsonLd?.type;
    const entity = jsonLdType ? findJsonLdEntities(resolved.inspection.jsonLd, jsonLdType)[0] : undefined;
    if (jsonLdType && entity) {
      this.writeRecord(run, url, { ...listingValues, ...normalizeJsonLdEntity(jsonLdType, entity) }, `json-ld:${jsonLdType}`);
      return;
    }
    this.writeProblem(run, url, listingValues, `No pattern for ${new URL(url).host}.`);
  }

  private keyFor(run: ActiveRun, url: string, values: Record<string, unknown>): string | null {
    return recordKey(run.definition.key ?? { kind: 'url' }, url, values, run.definition.ignoredQueryParameters);
  }

  private writeRecord(run: ActiveRun, url: string, values: Record<string, unknown>, patternId: string): void {
    const problem = validateRecord(values, run.definition.requiredFields);
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
    else run.state.problems += 1;
    this.deps.emit('collection', `record ${record.state}${patternId ? ` (${patternId})` : ''} ${record.key}`);
    run.consumer.onRecord(record);
  }
}
