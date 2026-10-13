import { setWebCapabilityProfileBinding } from '../webCapabilities';
import { recordAuthorization, reviewAuthorization, type AuthorizationReview } from './authorization';
import type { Clock, Random } from './clock';
import {
  collectionAuthorizationParts,
  CollectionService,
  testSitePattern,
  type CollectionDefinition,
  type CollectionRunState,
  type RecordConsumer,
  type SitePatternTestResult,
} from './collection';
import type { SitePatternDefinition } from './sitePatterns';
import { WebAutomationError } from './errors';
import type { VisualDocument } from '../../../heavy-file-format/src/types';
import { createLocalDocumentChannel, createWebMcpDocumentChannel, readDocumentTextFromChannel, webMcpDocumentPage } from './documentChannel';
import { createEventChannel, type AutomationEvent } from './events';
import type { BrowserHost } from './host';
import { DEFAULT_QUEUE_CONFIG, DurableQueue, type QueueConfig, type QueueEntry, type QueueResult, type QueueState } from './queue';
import { WorkerScheduler, type SchedulerOptions, type SchedulerState } from './scheduler';
import { SessionService, type SessionState } from './session';
import type { AutomationSettingsStore } from './settings';
import { ApiTransport, WebApiService, type WebApiCapability, type WebApiResult } from './webApi';

/** A plugin method the queue can target, resolved through the plugin-to-plugin call interface. */
export interface PluginCallTarget {
  pluginId: string;
  method: string;
  args: Record<string, unknown>;
}

/** The document's doc.plugins.call: the same scripting methods a script reaches. */
export type PluginCall = (pluginId: string, method: string, args: Record<string, unknown>) => unknown;

/** App-level dependencies: one browser host, scheduler, and session state shared by every open document. */
export interface WebAutomationRuntimeDeps {
  host: BrowserHost;
  clock: Clock;
  random: Random;
  settings: AutomationSettingsStore;
  /** Opens a workspace HVY document, for document-text endpoint inputs bound to a local file. */
  openWorkspaceDocument(path: string): Promise<VisualDocument>;
  /** The user's local site pattern library (integration registry). */
  patternLibrary?: () => SitePatternDefinition[];
  scheduler?: Omit<SchedulerOptions, 'host' | 'clock' | 'random' | 'emit'>;
}

/** Document-level dependencies. */
export interface WebAutomationDocumentDeps {
  documentPath: string;
  /** How queues call their target plugin. */
  callPlugin: PluginCall;
}

export function createWebAutomationRuntime(deps: WebAutomationRuntimeDeps) {
  const events = createEventChannel(deps.clock);
  const emit = events.emit;
  const scheduler = new WorkerScheduler({ ...deps.scheduler, host: deps.host, clock: deps.clock, random: deps.random, emit });
  const transport = new ApiTransport({ scheduler, host: deps.host, clock: deps.clock, emit });
  const sessions = new SessionService({ host: deps.host, transport, settings: deps.settings, clock: deps.clock, emit });
  // A document-text source is read when the call runs, through the channel its binding names.
  const readDocumentText = async (source: string, profileId: string): Promise<string> => {
    const pageUrl = webMcpDocumentPage(source);
    const channel = pageUrl
      ? createWebMcpDocumentChannel((name, args) => transport.invokeWebMcpTool(profileId, pageUrl, name, args))
      : createLocalDocumentChannel(await deps.openWorkspaceDocument(source));
    return readDocumentTextFromChannel(channel);
  };
  const webApi = new WebApiService({ transport, sessions, settings: deps.settings, readDocumentText });
  return {
    deps,
    events,
    emit,
    scheduler,
    transport,
    sessions,
    webApi,

    // UI: pattern builder and Site patterns manager, "Test on another site".
    testSitePattern(profileId: string, pattern: SitePatternDefinition, url: string): Promise<SitePatternTestResult> {
      return testSitePattern({ scheduler, host: deps.host }, profileId, pattern, url);
    },
  };
}

export type WebAutomationRuntime = ReturnType<typeof createWebAutomationRuntime>;

/** Everything a UI renders. Plain JSON: no functions, no class instances. */
export interface WebAutomationState {
  sessions: SessionState[];
  scheduler: SchedulerState;
  runs: CollectionRunState[];
  queues: Record<string, QueueState>;
}

/**
 * The only functions a UI may call for web automation. Each entry point names
 * the UI that will call it. Scenarios in faux/ drive exactly these.
 */
export function createWebAutomation(runtime: WebAutomationRuntime, document: WebAutomationDocumentDeps) {
  const { emit, scheduler, sessions, webApi } = runtime;
  const deps = { ...runtime.deps, ...document };
  const collections = new CollectionService({ scheduler, host: deps.host, clock: deps.clock, emit, patternLibrary: deps.patternLibrary });
  const queues = new Map<string, DurableQueue>();
  const queueStates = new Map<string, QueueState>();

  function requireAuthorized(capabilityId: string, parts: Record<string, unknown>, profileId: string): void {
    const review = reviewAuthorization(deps.settings.get().authorizations, deps.documentPath, capabilityId, parts, profileId);
    if (review.reason !== 'authorized') {
      throw new WebAutomationError('not_authorized', `This document must be authorized before it can use "${capabilityId}" (${review.reason}).`);
    }
  }

  function profileFor(capabilityId: string, name: string): string {
    const profileId = deps.settings.get().profileBindings[deps.documentPath]?.[capabilityId];
    if (!profileId) throw new WebAutomationError('no_profile', `Choose a profile for "${name}".`);
    return profileId;
  }

  function queue(queueId: string): DurableQueue {
    const existing = queues.get(queueId);
    if (!existing) throw new WebAutomationError('invalid_request', `Queue "${queueId}" is not open.`);
    return existing;
  }

  return {
    // UI: every renderer (web-api, collection, and queue blocks; Background activity) reads this.
    getState(): WebAutomationState {
      return {
        sessions: sessions.getState(),
        scheduler: scheduler.getState(),
        runs: collections.getState(),
        queues: Object.fromEntries([...queues].map(([id, item]) => [id, item.getState()])),
      };
    },

    // UI: block editor and reader, "Use profile" select.
    bindProfile(capabilityId: string, profileId: string): void {
      deps.settings.update((settings) => ({
        ...settings,
        profileBindings: setWebCapabilityProfileBinding(settings.profileBindings, deps.documentPath, capabilityId, profileId),
      }));
    },

    // UI: galaxy.web-api editor and reader, "Use document" picker for a document-text input.
    bindDocumentInput(capability: WebApiCapability, endpointId: string, inputName: string, sourcePath: string | null): void {
      const slot = `${endpointId}.${inputName}`;
      deps.settings.update((settings) => {
        const forDocument = { ...(settings.documentInputBindings[deps.documentPath] ?? {}) };
        const forCapability = { ...(forDocument[capability.capabilityId] ?? {}) };
        if (sourcePath) forCapability[slot] = sourcePath;
        else delete forCapability[slot];
        forDocument[capability.capabilityId] = forCapability;
        return { ...settings, documentInputBindings: { ...settings.documentInputBindings, [deps.documentPath]: forDocument } };
      });
    },

    // UI: authorization modal, content and reauthorization reason for a galaxy.web-api block.
    reviewWebApi(capability: WebApiCapability): AuthorizationReview {
      return webApi.review(deps.documentPath, capability);
    },

    // UI: authorization modal, "Allow with [profile]" for a galaxy.web-api block.
    authorizeWebApi(capability: WebApiCapability): void {
      const profileId = profileFor(capability.capabilityId, capability.name);
      deps.settings.update((settings) => ({
        ...settings,
        authorizations: recordAuthorization(settings.authorizations, deps.documentPath, capability.capabilityId, webApi.authorizationParts(deps.documentPath, capability), profileId, deps.clock.now()),
      }));
    },

    // UI: galaxy.web-api reader, account status on first use.
    async probeSession(capability: WebApiCapability): Promise<SessionState> {
      const profileId = profileFor(capability.capabilityId, capability.name);
      requireAuthorized(capability.capabilityId, webApi.authorizationParts(deps.documentPath, capability), profileId);
      return sessions.probe(capability, profileId);
    },

    // UI: galaxy.web-api reader, "Sign in" button.
    async beginSignIn(capability: WebApiCapability): Promise<void> {
      const profileId = profileFor(capability.capabilityId, capability.name);
      requireAuthorized(capability.capabilityId, webApi.authorizationParts(deps.documentPath, capability), profileId);
      await sessions.beginSignIn(capability, profileId);
    },

    // UI: galaxy.web-api reader, "Sign out" button.
    async signOut(capability: WebApiCapability): Promise<void> {
      await sessions.signOut(capability, profileFor(capability.capabilityId, capability.name));
    },

    // UI: galaxy.web-api reader, endpoint form "Run"; scripting doc.plugins.call("galaxy.web-api", "call", …).
    callEndpoint(capability: WebApiCapability, endpointId: string, input: Record<string, unknown>): Promise<WebApiResult> {
      return webApi.call(deps.documentPath, capability, endpointId, input);
    },

    // UI: authorization modal, content and reauthorization reason for a galaxy.web-collection block.
    reviewCollection(definition: CollectionDefinition): AuthorizationReview {
      return reviewAuthorization(
        deps.settings.get().authorizations,
        deps.documentPath,
        definition.capabilityId,
        collectionAuthorizationParts(definition),
        profileFor(definition.capabilityId, definition.name),
      );
    },

    // UI: authorization modal, "Allow with [profile]" for a galaxy.web-collection block.
    authorizeCollection(definition: CollectionDefinition): void {
      const profileId = profileFor(definition.capabilityId, definition.name);
      deps.settings.update((settings) => ({
        ...settings,
        authorizations: recordAuthorization(settings.authorizations, deps.documentPath, definition.capabilityId, collectionAuthorizationParts(definition), profileId, deps.clock.now()),
      }));
    },

    // UI: galaxy.web-collection reader, "Collect"; scripting collect({ … }). Records go to the consumer (usually a record sink).
    startCollection(definition: CollectionDefinition, consumer: RecordConsumer, onlyStartUrls?: string[]): { runId: string; done: Promise<CollectionRunState> } {
      const profileId = profileFor(definition.capabilityId, definition.name);
      requireAuthorized(definition.capabilityId, collectionAuthorizationParts(definition), profileId);
      const startUrls = onlyStartUrls ?? definition.startUrls;
      if (startUrls.some((url) => !definition.startUrls.includes(url))) {
        throw new WebAutomationError('invalid_request', 'Only approved start URLs can be collected.');
      }
      return collections.start(definition, profileId, consumer, startUrls);
    },

    // UI: galaxy.web-collection reader, single item URL entry; scripting extract({ url }).
    extractItem(definition: CollectionDefinition, url: string, consumer: RecordConsumer): { runId: string; done: Promise<CollectionRunState> } {
      const profileId = profileFor(definition.capabilityId, definition.name);
      requireAuthorized(definition.capabilityId, collectionAuthorizationParts(definition), profileId);
      return collections.extract(definition, profileId, url, consumer);
    },

    // UI: Needs attention item, "Show".
    showAttention(runId: string): Promise<void> {
      return collections.show(runId);
    },

    // UI: Needs attention window, "Resume".
    resumeAttention(runId: string): void {
      collections.resume(runId);
    },

    // UI: galaxy.web-collection reader and Background activity, "Stop".
    stopCollection(runId: string): void {
      collections.stop(runId);
    },

    // Document load: openDocumentAutomation opens each queue block with its saved state.
    openQueue(queueId: string, target: PluginCallTarget, config: QueueConfig = DEFAULT_QUEUE_CONFIG, persisted?: QueueState): void {
      const item = new DurableQueue({
        id: queueId,
        config,
        clock: deps.clock,
        random: deps.random,
        emit,
        target: async (input) => deps.callPlugin(target.pluginId, target.method, { ...target.args, input }),
        onChange: (state) => queueStates.set(queueId, state),
      });
      if (persisted) item.restore(persisted);
      queues.set(queueId, item);
    },

    // UI: scripting doc.plugins.call(queue, "enqueue", …), called from an item's Evaluate form.
    enqueue(queueId: string, key: string, input: unknown): { added: boolean } {
      return queue(queueId).enqueue(key, input);
    },

    // UI: scripting doc.plugins.call(queue, "on_result", { handler }), registered by the document load script.
    onQueueResult(queueId: string, handler: (result: QueueResult) => void): void {
      queue(queueId).onResult(handler);
    },

    // UI: queue reader, "Resume" (also after reopening a document with waiting entries).
    resumeQueue(queueId: string): void {
      queue(queueId).resume();
    },

    // UI: queue reader, "Pause".
    pauseQueue(queueId: string): void {
      queue(queueId).pause();
    },

    // UI: queue reader, failed entry "Retry".
    retryQueueEntry(queueId: string, key: string): void {
      queue(queueId).retry(key);
    },

    // UI: queue reader, entry "Cancel".
    cancelQueueEntry(queueId: string, key: string): void {
      queue(queueId).cancel(key);
    },

    // UI: queue reader, entry list.
    listQueue(queueId: string): QueueEntry[] {
      return queue(queueId).list();
    },

    // Document close: DocumentAutomation.close.
    closeDocument(): void {
      for (const run of collections.getState()) collections.stop(run.runId);
      for (const item of queues.values()) item.dispose();
    },

    /** Persisted queue state for saving with the document. */
    persistedQueue(queueId: string): QueueState | null {
      return queueStates.get(queueId) ?? null;
    },

    isQueueIdle(queueId: string): boolean {
      return queue(queueId).isIdle();
    },
  };
}

export type WebAutomation = ReturnType<typeof createWebAutomation>;
export type { AutomationEvent };
