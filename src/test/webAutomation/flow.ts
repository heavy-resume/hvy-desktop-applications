import { canonicalUrl } from '../../webAutomation/records';
import { deserializeDocumentBytes, serializeDocument, serializeDocumentBytes } from '../../../../heavy-file-format/src/serialization';
import type { VisualDocument } from '../../../../heavy-file-format/src/types';
import type { VisualBlock } from '../../../../heavy-file-format/src/editor/types';
import { createCliItemStore, type CliItemStoreConfig } from '../../webAutomation/cliItemStore';
import { createMemoryItemStore, createRecordSink, DEFAULT_RECORD_SINK_CONFIG, updateItemFields, type DocumentItem, type RecordSinkConfig } from '../../webAutomation/recordSink';
import { seededRandom } from '../../webAutomation/clock';
import type { CollectionDefinition, CollectionRunState, RecordConsumer } from '../../webAutomation/collection';
import { createWebAutomationRuntime, type WebAutomation, type WebAutomationRuntimeDeps } from '../../webAutomation/entryPoints';
import { openDocumentAutomation, registerWebAutomationPlugins, type DocumentAutomation } from '../../webAutomation/documentAutomation';
import { executeHvyCliCommandSync } from '../../../../heavy-file-format/src/cli-core';
import { WEB_API_PLUGIN_ID, WEB_AUTOMATION_SCHEMA_VERSION, WEB_COLLECTION_PLUGIN_ID, WEB_PROFILE_CONTEXT_PLUGIN_ID } from '../../webAutomation/configs';
import type { StateRuntime } from '../../../../heavy-file-format/src/state';
import { createDocumentState } from './documentHost';
import { pluginAcceptanceKey } from '../../pluginManager';
import type { QueueResult } from '../../webAutomation/queue';
import { readWebAutomationBlocks } from '../../webAutomation/documentBlocks';
import { contextProfileName, isProfileContext } from '../../webAutomation/profileContexts';
import { withDocumentProfile } from '../../webAutomation/profiles';
import { visitBlocks } from '../../../../heavy-file-format/src/block-traversal';
import { createMemorySettingsStore } from '../../webAutomation/settings';
import type { SitePatternDefinition } from '../../webAutomation/sitePatterns';
import { withSiteSetups, type SiteSetup } from '../../webAutomation/siteSetups';
import type { WebApiCapability, WebApiResult } from '../../webAutomation/webApi';
import { mockAnalysisService, type MockAnalysisServiceState } from './analysisService';
import { MockHost } from './mockHost';
import type { MockApiIntegration } from './integration';
import { mockWebSites } from './sites';
import { buildSearchDocument } from './listingDocument';
import { VirtualClock } from './virtualClock';

export const DOCUMENT_PATH = '/workspace/Search.hvy';
export const BOARDS_PROFILE = 'boards';
export const SERVICE_PROFILE = 'service';
/** The browser profiles on the flow's machine, by id, and the names a document uses for them. */
const PROFILE_NAMES: Record<string, string> = { [BOARDS_PROFILE]: 'Boards', [SERVICE_PROFILE]: 'Service' };
export const EVALUATE_QUEUE = 'evaluate';
export const STATUS_QUEUE = 'status';

/** The flow's queue blocks: evaluations, then status polls when the service has them, calling its web API block. */
export function mockQueueBlocks<State>(api: MockApiIntegration<State>) {
  const target = (endpointId: string) => ({ pluginId: 'galaxy.web-api', method: 'call', args: { capabilityId: api.capability.capabilityId, endpointId } });
  return [
    { queueId: EVALUATE_QUEUE, target: target(api.createEndpointId), config: { minIntervalMs: 5_000, jitterMs: 2_000 } },
    ...(api.statusEndpointId ? [{ queueId: STATUS_QUEUE, target: target(api.statusEndpointId), config: { minIntervalMs: 15_000, jitterMs: 2_000 } }] : []),
  ];
}

export interface MockFlowOptions<State> {
  seed?: number;
  scheduler?: WebAutomationRuntimeDeps['scheduler'];
  /** The signed-in service items are evaluated against. Defaults to the neutral analysis service. */
  api?: () => MockApiIntegration<State>;
  /** How the document stores collected records. */
  sink?: RecordSinkConfig;
  /**
   * The HVY document the flow opens. Defaults to a search document holding the
   * service's web API block and the flow's queue blocks. With `store`, items
   * are written into it; otherwise they are kept in memory.
   */
  document?: {
    build?(): VisualDocument;
    store?: CliItemStoreConfig;
    /** The document's own load script, run on every open in place of the flow's stand-in. */
    load?(document: VisualDocument, clock: VirtualClock, stateRuntime: StateRuntime): void;
    /** The document changed outside a script (collection wrote items or rows); a host that renders reruns its hooks. */
    changed?(): void;
  };
}

/**
 * Walks the collect → evaluate flow headless. Every step calls the same entry
 * point a UI will call; steps that stand in for a person are marked as user actions.
 */
export function createMockFlow<State = MockAnalysisServiceState>(options: MockFlowOptions<State> = {}) {
  const clock = new VirtualClock();
  const api = (options.api ?? (mockAnalysisService as unknown as () => MockApiIntegration<State>))();
  const serviceOrigin = new URL(api.capability.pageUrl).origin;
  const host = new MockHost(mockWebSites(api));
  const settings = createMemorySettingsStore();
  const pluginsReady = registerWebAutomationPlugins();
  // Stand-in for Galaxy's appSettings.pluginAcceptances, written as hvy.ts's mount callbacks write it.
  const pluginAcceptances: Record<string, string[]> = {};
  // The document's path: renaming it changes this, as Galaxy's rename does.
  let documentPath = DOCUMENT_PATH;
  const documentState = (current: VisualDocument) => createDocumentState(current, {
    getAcceptance: (request) => (pluginAcceptances[documentPath] ?? []).includes(pluginAcceptanceKey(request)),
    onAcceptanceChanged: (request) => {
      const key = pluginAcceptanceKey(request);
      const current = pluginAcceptances[documentPath] ?? [];
      pluginAcceptances[documentPath] = request.accepted ? [...new Set([...current, key])] : current.filter((candidate) => candidate !== key);
      timeline.push(`${stamp()} [settings] ${request.id} ${request.accepted ? 'allowed' : 'disallowed'} in this file`);
    },
  });
  let document = (options.document?.build ?? (() => buildSearchDocument({ webApi: structuredClone(api.capability), queues: mockQueueBlocks(api) })))();
  // The item list and the record sink collection runs are given.
  let items = options.document?.store ? createCliItemStore(document, options.document.store) : createMemoryItemStore();
  let sink = createRecordSink(items, options.sink ?? DEFAULT_RECORD_SINK_CONFIG);
  const timeline: string[] = [];
  const stamp = () => `+${(clock.now() / 1000).toFixed(1)}s`.padStart(9);
  host.log = (message) => timeline.push(`${stamp()} [host] ${message}`);

  // The document as last saved to disk, as the app saves it (its attachments, such as its database, in the bytes): what
  // an app restart reopens.
  let saved = serializeDocumentBytes(document);
  let entryIds = 0;
  const random = seededRandom(options.seed ?? 7);
  let runtime = startRuntime();

  function startRuntime() {
    const runtime = createWebAutomationRuntime({
      createId: () => `idempotency-${++entryIds}`,
      host,
      clock,
      random,
      settings,
      profiles: () => Object.entries(PROFILE_NAMES).map(([id, name]) => ({ id, name })),
      scheduler: options.scheduler,
    });
    runtime.events.subscribe((event) => timeline.push(`${stamp()} [${event.source}] ${event.message}`));
    return runtime;
  }
  let stateRuntime = documentState(document);
  let opened: DocumentAutomation = openDocumentAutomation(runtime, { documentPath: () => documentPath, document, stateRuntime, onDocumentChange: () => options.document?.changed?.(), onDatabaseChange: () => options.document?.changed?.() });
  let automation: WebAutomation = opened.automation;
  loadDocument();

  function reopen(bytes = serializeDocumentBytes(document)): void {
    document = deserializeDocumentBytes(bytes, '.hvy');
    if (options.document?.store) {
      items = createCliItemStore(document, options.document.store);
      sink = createRecordSink(items, options.sink ?? DEFAULT_RECORD_SINK_CONFIG);
    }
    stateRuntime = documentState(document);
    opened = openDocumentAutomation(runtime, { documentPath: () => documentPath, document, stateRuntime, onDocumentChange: () => options.document?.changed?.(), onDatabaseChange: () => options.document?.changed?.() });
    automation = opened.automation;
    loadDocument();
  }

  /** The document's load script, or a stand-in that registers the queues' result handlers. */
  function loadDocument(): void {
    if (options.document?.load) {
      options.document.load(document, clock, stateRuntime);
      return;
    }
    automation.onQueueResult(EVALUATE_QUEUE, (result) => handleResult(result));
    if (api.statusEndpointId) automation.onQueueResult(STATUS_QUEUE, (result) => handleResult(result));
  }

  function handleResult(result: QueueResult): void {
    // Taken out of the queue before it ran: the item stays as it was, never evaluated.
    if (result.status === 'cancelled') return;
    if (result.status === 'failed') {
      updateItemFields(items, result.key, { evaluation: 'failed', evaluationError: result.error });
      return;
    }
    const evaluation = api.readResult((result.result as WebApiResult).body);
    if (evaluation.status === 'ready') {
      updateItemFields(items, result.key, { evaluation: 'ready', resultId: evaluation.id, resultUrl: evaluation.url, ...evaluation.fields });
      timeline.push(`${stamp()} [document] item ${result.key} ${JSON.stringify(evaluation.fields)}`);
      return;
    }
    updateItemFields(items, result.key, { evaluation: 'pending', resultId: evaluation.id, resultUrl: evaluation.url });
    automation.enqueue(STATUS_QUEUE, result.key, { id: evaluation.id });
  }

  function busy(): boolean {
    const state = automation.getState();
    return state.runs.some((run) => run.status === 'running')
      || !Object.keys(state.queues).every((queueId) => automation.isQueueIdle(queueId))
      // A call made directly (a script's, not a queue's) holds an API worker, or waits for one. Collections are their
      // runs (a run waiting on the user holds its worker).
      || state.scheduler.workers.some((worker) => worker.kind === 'api' && worker.busy)
      || state.scheduler.waitingJobs.some((job) => job.kind === 'api');
  }

  /**
   * Runs virtual time until no collection is running, the queues are idle, paused, or waiting for resume, and no call is
   * in flight.
   */
  async function settle(): Promise<void> {
    await pluginsReady;
    // Fetching files, decryption, and loading the document reader are real asynchronous work the virtual clock cannot
    // see: when only such work is left, give it real time, then run virtual time again.
    for (let waits = 0; waits < 400; waits += 1) {
      await clock.runUntil(() => !busy());
      if (!busy()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  return {
    clock,
    host,
    get items() {
      return items;
    },
    /** The HVY document the flow opened. */
    get document() {
      return document;
    },
    get sink() {
      return sink;
    },
    /** A collection block's own output, the consumer its runs are given when a script passes no on_record. */
    output(capabilityId: string): RecordConsumer {
      return opened.lookup.sink(capabilityId)!;
    },
    settings,
    timeline,
    api,
    service: api.state,
    get automation() {
      return automation;
    },

    // UI: "Change profile…": Boards for every web plugin in this file, then Service for the service's block only; then
    // File > Save. The choices are written into the document, so they reopen with it. The collection is the file's
    // (its own block, when the document has one, names no profile).
    bindProfiles(_collection: CollectionDefinition, capability: WebApiCapability = api.capability): void {
      document.meta.metadata = withDocumentProfile(document.meta.metadata, PROFILE_NAMES[BOARDS_PROFILE]);
      automation.profileChosen(PROFILE_NAMES[BOARDS_PROFILE], 'this file');
      // A web profile context the document ships without a profile (one at the top of a section) gets the same choice.
      visitBlocks(document.sections, (block) => {
        if (isProfileContext(block) && !contextProfileName(block)) {
          block.schema.pluginConfig = { schemaVersion: WEB_AUTOMATION_SCHEMA_VERSION, profile: PROFILE_NAMES[BOARDS_PROFILE] };
          automation.profileChosen(PROFILE_NAMES[BOARDS_PROFILE], 'a web profile context');
        }
      });
      // The service's block goes into a container of its own, with a web profile context naming Service.
      const service = readWebAutomationBlocks(document).webApis.find(({ config }) => config.capabilityId === capability.capabilityId)!.block;
      const section = document.sections.find((candidate) => candidate.blocks.includes(service))!;
      executeHvyCliCommandSync(document, `hvy insert -1 container /body/${section.customId} --id service-profile`);
      executeHvyCliCommandSync(document, `hvy insert -1 plugin /body/${section.customId}/service-profile profile ${WEB_PROFILE_CONTEXT_PLUGIN_ID}`);
      const container = section.blocks.find((block) => block.schema.id === 'service-profile')!;
      const context = container.schema.containerBlocks!.find((block) => block.schema.id === 'profile')!;
      context.schema.pluginConfig = { schemaVersion: WEB_AUTOMATION_SCHEMA_VERSION, profile: PROFILE_NAMES[SERVICE_PROFILE] };
      section.blocks.splice(section.blocks.indexOf(service), 1);
      container.schema.containerBlocks!.push(service);
      automation.profileChosen(PROFILE_NAMES[SERVICE_PROFILE], 'a web profile context');
      opened.saveQueues();
      saved = serializeDocumentBytes(document);
    },

    // UI: a web profile context's "Choose a browser profile…" (the first in the document): the web blocks around it use it.
    chooseContextProfile(name: string): void {
      let context: VisualBlock | null = null;
      visitBlocks(document.sections, (block) => {
        if (!context && isProfileContext(block)) context = block;
      });
      context!.schema.pluginConfig = { schemaVersion: WEB_AUTOMATION_SCHEMA_VERSION, profile: name };
      automation.profileChosen(name, 'a web profile context');
    },

    // UI: first use: "Allow in this file" on both web plugins, then "Web API - Allow [service]…" and its modal's "Allow".
    approve(capability: WebApiCapability = api.capability): void {
      opened.authorizePlugin(WEB_COLLECTION_PLUGIN_ID);
      opened.authorizePlugin(WEB_API_PLUGIN_ID);
      automation.authorizeWebApi(capability);
    },

    // UI: app settings, "Web services for this file", unchecking the service and saving.
    revokeService(capability: WebApiCapability = api.capability): void {
      automation.revokeWebApi(capability);
    },

    // UI: a web plugin's block, "Allow in this file".
    authorizePlugin(pluginId: string): void {
      opened.authorizePlugin(pluginId);
    },

    // UI: a web plugin's block shows the prompt or its reader.
    pluginAuthorization(pluginId: string) {
      return opened.pluginAuthorization(pluginId);
    },

    // UI: "Sign in" modal content (galaxy.web-api block).
    reviewWebApi(capability: WebApiCapability = api.capability) {
      return automation.reviewWebApi(capability);
    },

    // UI: galaxy.web-api reader, endpoint form "Run".
    async callEndpoint(endpointId: string, input: Record<string, unknown> = {}, capability: WebApiCapability = api.capability): Promise<WebApiResult> {
      let outcome: { value?: WebApiResult; error?: unknown } | null = null;
      automation.callEndpoint(capability, endpointId, input).then((value) => {
        outcome = { value };
      }, (error: unknown) => {
        outcome = { error };
      });
      await clock.runUntil(() => outcome !== null);
      const settled = outcome as { value?: WebApiResult; error?: unknown } | null;
      if (!settled) throw new Error('The endpoint call did not finish.');
      if ('error' in settled) throw settled.error;
      return settled.value!;
    },

    // UI: galaxy.web-api reader, account status on first use.
    probe(capability: WebApiCapability = api.capability) {
      return automation.probeSession(capability);
    },

    // UI: galaxy.web-api reader, "Sign in".
    async signIn(capability: WebApiCapability = api.capability): Promise<void> {
      await automation.beginSignIn(capability);
      await settle();
    },

    // UI: galaxy.web-api reader, "Sign out".
    async signOut(capability: WebApiCapability = api.capability): Promise<void> {
      await automation.signOut(capability);
      await settle();
    },

    /** User action: finishes the site's own login form in the user window, optionally as another account. */
    async completeLogin(sessionCookie?: string): Promise<void> {
      timeline.push(`${stamp()} [user] completes the login form`);
      host.completeLogin(SERVICE_PROFILE, serviceOrigin, sessionCookie);
      await clock.runUntil(() => automation.getState().sessions.every((session) => session.status !== 'pending-login'));
    },

    /** User action: pastes site setups (or finishes setting one up); they are saved into the collection block. */
    addSiteSetups(definition: CollectionDefinition, ...setups: SiteSetup[]): CollectionDefinition {
      timeline.push(`${stamp()} [user] adds site setups ${setups.map((setup) => setup.name).join(', ')} to "${definition.name}"`);
      return { ...definition, ...withSiteSetups(definition, setups) };
    },

    // UI: pattern builder and Site patterns manager, "Test on another site".
    async testPattern(pattern: SitePatternDefinition, url: string) {
      let result: Awaited<ReturnType<typeof runtime.testSitePattern>> | null = null;
      void runtime.testSitePattern(BOARDS_PROFILE, pattern, url).then((value) => {
        result = value;
      });
      await clock.runUntil(() => result !== null);
      return result!;
    },

    // UI: galaxy.web-collection reader, "Collect".
    // UI: "Collect jobs", or a start page's own "Collect" (onlyUrls).
    async collect(collection: CollectionDefinition, onlyUrls?: string[], consumer: RecordConsumer = sink): Promise<CollectionRunState> {
      const run = automation.startCollection(collection, consumer, onlyUrls);
      await settle();
      return automation.getState().runs.find((candidate) => candidate.runId === run.runId)!;
    },

    // UI: galaxy.web-collection reader, single item URL.
    async extract(collection: CollectionDefinition, url: string): Promise<CollectionRunState> {
      const run = automation.extractItem(collection, url, sink);
      await settle();
      return automation.getState().runs.find((candidate) => candidate.runId === run.runId)!;
    },

    // UI: a link clicked in the document. True when it opened in Galaxy's browser window, in a web plugin's profile.
    openLink(url: string): boolean {
      return automation.openLink(url);
    },

    // UI: Needs attention item, "Show".
    showAttention(runId: string): Promise<void> {
      return automation.showAttention(runId);
    },

    /** User action: solves the bot challenge in the shown window. */
    solveChallenge(origin: string): void {
      timeline.push(`${stamp()} [user] solves the challenge`);
      host.solveChallenge(BOARDS_PROFILE, origin);
    },

    // UI: Needs attention window, "Resume".
    async resumeAttention(runId: string): Promise<CollectionRunState> {
      automation.resumeAttention(runId);
      await settle();
      return automation.getState().runs.find((candidate) => candidate.runId === runId)!;
    },

    // UI: galaxy.web-collection reader, "Stop".
    async stop(runId: string): Promise<CollectionRunState> {
      automation.stopCollection(runId);
      await settle();
      return automation.getState().runs.find((candidate) => candidate.runId === runId)!;
    },

    // UI: item, "Evaluate" form submit; its script calls the queue's enqueue.
    // The source document is not read here: the service's stored document is opened when each call runs.
    async evaluate(urls: string[], options: { settle?: boolean } = {}): Promise<void> {
      for (const url of urls) {
        const item = items.get(canonicalUrl(url));
        if (!item) throw new Error(`No item for ${url}.`);
        automation.enqueue(EVALUATE_QUEUE, item.key, api.createInput(item));
      }
      if (options.settle !== false) await settle();
    },

    // UI: queue reader, "Resume".
    async resumeQueue(queueId: string): Promise<void> {
      automation.resumeQueue(queueId);
      await settle();
    },

    // UI: queue reader, "Pause".
    pauseQueue(queueId: string): void {
      automation.pauseQueue(queueId);
    },

    // UI: queue reader, entry "Run next" ("Run now" while the queue is paused).
    async runQueueEntryNext(queueId: string, url: string): Promise<void> {
      const key = canonicalUrl(url);
      automation.runQueueEntryNext(queueId, key);
      // A paused queue counts as settled, so the entry running on its own is waited for here.
      await clock.runUntil(() => !['queued', 'running'].includes(automation.listQueue(queueId).find((entry) => entry.key === key)?.status ?? ''));
      await settle();
    },

    // UI: queue reader, entry "Cancel" (or "Dismiss" for one that failed).
    cancelQueueEntry(queueId: string, url: string): void {
      automation.cancelQueueEntry(queueId, canonicalUrl(url));
    },

    // UI: queue reader, failed entry "Retry".
    async retryQueueEntry(queueId: string, url: string): Promise<void> {
      automation.retryQueueEntry(queueId, canonicalUrl(url));
      await settle();
    },

    // UI: queue reader, entry list.
    listQueue(queueId: string) {
      return automation.listQueue(queueId);
    },

    /** The site's session expires or is revoked elsewhere. */
    expireSession(): void {
      host.expireSession(SERVICE_PROFILE, serviceOrigin);
    },

    /**
     * Switches away from the document and back. Queues stay in the app's
     * memory, so nothing needs saving first; calls already sent finish while
     * it is unloaded. Script callbacks do not survive.
     */
    reload(): void {
      // The same document stays open in the app, unsaved changes and all: its queues' state goes with it.
      opened.saveQueues();
      opened.close();
      timeline.push(`${stamp()} [document] closed and reopened`);
      reopen();
    },

    // UI: File > Save. Each queue block takes its queue's state, then the document is serialized.
    save(): string {
      opened.saveQueues();
      saved = serializeDocumentBytes(document);
      timeline.push(`${stamp()} [document] saved`);
      return serializeDocument(document);
    },

    // UI: document closed (tab closed or document switched off).
    closeDocument(): void {
      opened.close();
      timeline.push(`${stamp()} [document] closed`);
    },

    // UI: document opened again from its saved text.
    openDocument(): void {
      timeline.push(`${stamp()} [document] opened`);
      reopen(saved);
    },

    /**
     * The app quits and starts again: calls in flight are lost with it, and a
     * fresh runtime reopens the document as last saved, with the same
     * settings and cookies. Anything not saved is lost.
     */
    restartApp(): void {
      opened.close();
      runtime = startRuntime();
      timeline.push(`${stamp()} [app] restarted`);
      reopen(saved);
    },

    settle,
    advance: (ms: number) => clock.advance(ms),

    item(url: string): DocumentItem | null {
      return items.get(canonicalUrl(url));
    },

    print(): string {
      return timeline.join('\n');
    },
  };
}

export type MockFlow<State = MockAnalysisServiceState> = ReturnType<typeof createMockFlow<State>>;
