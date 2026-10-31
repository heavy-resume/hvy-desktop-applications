import { recordAuthorization, reviewAuthorization, revokeAuthorization, type AuthorizationReview } from './authorization';
import type { Clock, Random } from './clock';
import {

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
import { MAX_DOCUMENT_TEXT } from './servedDocuments';
import { exportDocumentSourceMarkdown } from '../../../heavy-file-format/src/document-source-markdown';
import { createEventChannel, type AutomationEvent } from './events';
import type { BrowserHost } from './host';
import { resolveProfile, type BrowserProfile } from './profiles';
import { DEFAULT_QUEUE_CONFIG, DurableQueue, type QueueConfig, type QueueEntry, type QueueResult, type QueueState, type QueueTarget } from './queue';
import { WorkerScheduler, type SchedulerOptions, type SchedulerState } from './scheduler';
import { SessionService, type SessionState, type SessionStatus } from './session';
import { loadPublishedService, type PublishedService } from './serviceManifests';
import type { AutomationSettingsStore } from './settings';
import { WEB_API_PLUGIN_ID, WEB_COLLECTION_PLUGIN_ID } from './configs';
import { ApiTransport, capabilityOrigin, WebApiService, type CallOptions, type WebApiCapability, type WebApiResult } from './webApi';

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
  /** The browser profiles on this machine (Galaxy's profile registry). */
  profiles(): BrowserProfile[];
  /** New idempotency keys for queue entries (crypto.randomUUID in the app). */
  createId(): string;
  scheduler?: Omit<SchedulerOptions, 'host' | 'clock' | 'random' | 'emit'>;
}

/** Document-level dependencies. */
export interface WebAutomationDocumentDeps {
  /** The document's current path: it changes when the document is renamed or moved. */
  documentPath(): string;
  /** How queues call their target plugin. */
  callPlugin: PluginCall;
  /** Whether a plugin is allowed in this file (the reference implementation's per-file plugin authorization). */
  isPluginAuthorized(pluginId: string): boolean;
  /** The origin of the document's web API block with this capability id, as its block is now. */
  webApiOrigin(capabilityId: string): string | null;
  /** The browser profile the document names for its web plugin instance with this capability id (its own, or the file's). */
  profileName(capabilityId: string): string | null;
  /** The capability id of the web plugin instance whose site a URL is on (a web API's origins, a collection's start pages), if any. */
  linkOwner(url: string): string | null;
}

export function createWebAutomationRuntime(deps: WebAutomationRuntimeDeps) {
  const events = createEventChannel(deps.clock);
  const emit = events.emit;
  const scheduler = new WorkerScheduler({ ...deps.scheduler, host: deps.host, clock: deps.clock, random: deps.random, emit });
  const transport = new ApiTransport({ scheduler, host: deps.host, clock: deps.clock, emit });
  const sessions = new SessionService({ host: deps.host, transport, settings: deps.settings, clock: deps.clock, emit });
  // The text a served document contributes to an input is the reference Markdown export, as the Heavy Resume
  // extension sends.
  const documentText = (document: VisualDocument): string => exportDocumentSourceMarkdown(document).slice(0, MAX_DOCUMENT_TEXT);
  const webApi = new WebApiService({
    transport,
    sessions,
    settings: deps.settings,
    createId: deps.createId,
    fetchFile: (url, options) => deps.host.fetchFile(url, options),
    exportDocumentText: documentText,
  });
  const documentQueues = new Map<string, DurableQueue>();
  const heardSessions = new Map<string, SessionStatus>();
  return {
    deps,
    /** Queues by document path and queue ID. They outlive an open document so work already sent can finish. */
    queues: documentQueues,
    /**
     * The account status each document's session handler last heard, by document path, capability, and key. It outlives
     * a mount: coming back to a document's tab mounts it again (a fresh copy, if it was saved), and its scripts register
     * their handlers again, but they have already heard this status, and what they did with it is in the document.
     */
    heardSessions,
    events,
    emit,
    scheduler,
    transport,
    sessions,
    webApi,

    // A document moved (renamed, moved between workspaces, or archived): its queues still in memory follow it, so the
    // next open reattaches them.
    relocateDocument(previousPath: string, nextPath: string): void {
      const prefix = `${previousPath}\u0000`;
      for (const map of [documentQueues, heardSessions] as Array<Map<string, unknown>>) {
        for (const [key, value] of [...map]) {
          if (!key.startsWith(prefix)) continue;
          map.delete(key);
          map.set(`${nextPath}\u0000${key.slice(prefix.length)}`, value);
        }
      }
    },

    // Document close: its tab closed, so opening it again is a fresh start, and its handlers hear the account again.
    forgetDocument(documentPath: string): void {
      for (const key of [...heardSessions.keys()]) if (key.startsWith(`${documentPath}\u0000`)) heardSessions.delete(key);
    },

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
 * the UI that will call it. The scenarios in scenarios.test.ts drive exactly these.
 */
export function createWebAutomation(runtime: WebAutomationRuntime, document: WebAutomationDocumentDeps) {
  const { emit, scheduler, sessions, webApi } = runtime;
  const deps = { ...runtime.deps, ...document };
  const collections = new CollectionService({ scheduler, host: deps.host, clock: deps.clock, emit });
  const queues = new Map<string, DurableQueue>();
  // Script callbacks for sign-in changes, by capability and key. They do not survive the document closing.
  const sessionWatchers = new Map<string, () => void>();
  // Each script handler's handover of the account's current state, by capability and key: run again once the document
  // may use the account (its service approved), since what the handler did before that was refused.
  const sessionHandovers = new Map<string, () => void>();
  // Script handlers told when a collection's output writes records, by capability and key.
  const recordWatchers = new Map<string, (keys: string[]) => void>();

  // The plugin must be allowed in this file (the reference implementation's per-file plugin authorization).
  function requirePlugin(pluginId: string, displayName: string): void {
    if (!deps.isPluginAuthorized(pluginId)) {
      throw new WebAutomationError('not_authorized', `Allow ${displayName} in this file before it is used.`);
    }
  }

  // The service approval: what this document does with your account there, tied to its configuration.
  function requireAuthorized(capabilityId: string, parts: Record<string, unknown>, profileId: string): void {
    const review = reviewAuthorization(deps.settings.get().authorizations, deps.documentPath(), capabilityId, parts, profileId);
    if (review.reason !== 'authorized') {
      throw new WebAutomationError('not_authorized', `This document must be authorized before it can use "${capabilityId}" (${review.reason}).`);
    }
  }

  /** The local profile the document's instance uses, as the document names it. Null until the user chooses one. */
  function profileOf(capabilityId: string): BrowserProfile | null {
    return resolveProfile(deps.profileName(capabilityId), deps.profiles());
  }

  function profileFor(capabilityId: string, name: string): string {
    const profile = profileOf(capabilityId);
    if (!profile) throw new WebAutomationError('no_profile', `Choose a browser profile for "${name}".`);
    return profile.id;
  }

  /**
   * A queue that calls a web API, paused because its account was signed out, resumes once that account (the site, in
   * the profile this document uses there) is signed in again: the sign-in was the user's answer. Other pauses wait
   * for Resume.
   */
  function resumeAfterSignIn(queueId: string, target: PluginCallTarget): void {
    const capabilityId = target.pluginId === WEB_API_PLUGIN_ID && typeof target.args.capabilityId === 'string' ? target.args.capabilityId : null;
    if (!capabilityId) return;
    const watcherKey = `queue\0${queueId}`;
    sessionWatchers.get(watcherKey)?.();
    sessionWatchers.set(watcherKey, sessions.onChange((state) => {
      const item = queues.get(queueId);
      const paused = item?.getState();
      if (!item || state.status !== 'signed-in' || !paused?.paused || paused.pauseReason !== 'not_authenticated') return;
      if (state.origin !== deps.webApiOrigin(capabilityId) || state.profileId !== profileOf(capabilityId)?.id) return;
      emit('queue', `${queueId}: signed in again, resuming`);
      item.resume();
    }));
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

    // UI: web plugin readers, the profile an instance uses ("Signed in · Personal"), or none yet.
    profileOf,

    // UI: the browser profile dialog, once the choice is saved in the document: for the file ("this file") or for a web
    // profile context ("a web profile context"). Every web reader redraws in it (they redraw on events), and the log
    // records it.
    profileChosen(name: string, scope: string): void {
      emit('document', `${scope} uses browser profile ${name}`);
    },

    // UI: "Sign in" modal for a galaxy.web-api block: what the document does with your account, and what changed.
    reviewWebApi(capability: WebApiCapability): AuthorizationReview {
      return webApi.review(deps.documentPath(), capability, profileFor(capability.capabilityId, capability.name));
    },

    // UI: "Web API - Allow [service]…" modal, "Allow", for a galaxy.web-api block; signing in follows if the profile is not signed in.
    authorizeWebApi(capability: WebApiCapability): void {
      const profileId = profileFor(capability.capabilityId, capability.name);
      deps.settings.update((settings) => ({
        ...settings,
        authorizations: recordAuthorization(settings.authorizations, deps.documentPath(), capability.capabilityId, webApi.authorizationParts(capability), profileId, deps.clock.now(), capability.name),
      }));
      for (const [key, handOver] of sessionHandovers) if (key.startsWith(`${capability.capabilityId}\0`)) handOver();
    },

    // UI: app settings, "Web services for this file", unchecking a service and saving. The next use asks again.
    revokeWebApi(capability: WebApiCapability): void {
      deps.settings.update((settings) => ({
        ...settings,
        authorizations: revokeAuthorization(settings.authorizations, deps.documentPath(), capability.capabilityId),
      }));
    },

    // UI: galaxy.web-api reader, account status on first use.
    async probeSession(capability: WebApiCapability): Promise<SessionState> {
      requirePlugin(WEB_API_PLUGIN_ID, 'Web API');
      const profileId = profileFor(capability.capabilityId, capability.name);
      requireAuthorized(capability.capabilityId, webApi.authorizationParts(capability), profileId);
      return sessions.probe(capability, profileId);
    },

    // UI: galaxy.web-api reader, "Sign in" button.
    async beginSignIn(capability: WebApiCapability): Promise<void> {
      requirePlugin(WEB_API_PLUGIN_ID, 'Web API');
      const profileId = profileFor(capability.capabilityId, capability.name);
      requireAuthorized(capability.capabilityId, webApi.authorizationParts(capability), profileId);
      await sessions.beginSignIn(capability, profileId);
    },

    // UI: scripting doc.plugins.call("galaxy.web-api", "on_session", { key, handler }), registered by a form's initial
    // script, such as a resume list that fills in once you sign in. The same key replaces an earlier handler. A known
    // state is handed over at once: the script may register after the account check that signed it in. A state the
    // document's handler already heard is not handed over again when the document is mounted again (see heardSessions);
    // an unsaved document has no path to remember it by, so it always hears it.
    onSessionChange(capability: WebApiCapability, key: string, handler: (state: SessionState) => void): void {
      const watcherKey = `${capability.capabilityId}\0${key}`;
      const boundProfile = () => profileOf(capability.capabilityId)?.id;
      const heardKey = () => (deps.documentPath() ? `${deps.documentPath()}\0${watcherKey}` : null);
      const tell = (state: SessionState) => {
        const heard = heardKey();
        if (heard) runtime.heardSessions.set(heard, state.status);
        handler(state);
      };
      sessionWatchers.get(watcherKey)?.();
      sessionWatchers.set(watcherKey, sessions.onChange((state) => {
        if (state.origin === capabilityOrigin(capability) && state.profileId === boundProfile()) tell(state);
      }));
      const handOver = (again: boolean) => {
        const profileId = boundProfile();
        const current = profileId ? sessions.stateFor(capability, profileId) : null;
        const heard = heardKey();
        if (current && current.status !== 'unknown' && (again || !heard || runtime.heardSessions.get(heard) !== current.status)) tell(current);
      };
      // Approving the service hands it over again: what the handler did before that was refused.
      sessionHandovers.set(watcherKey, () => handOver(true));
      handOver(false);
    },

    // UI: scripting doc.plugins.call("galaxy.web-collection", "on_records", { capabilityId, key, handler }), registered by
    // the document's load script: told the keys of the records a collection's output wrote, as it writes them, so the
    // script reads what changed when it changed. The same key replaces an earlier handler.
    onRecordsWritten(capabilityId: string, key: string, handler: (keys: string[]) => void): void {
      recordWatchers.set(`${capabilityId}\0${key}`, handler);
    },

    // A collection block's output wrote records (documentAutomation's sink).
    recordsWritten(capabilityId: string, keys: string[]): void {
      for (const [watcherKey, handler] of recordWatchers) if (watcherKey.startsWith(`${capabilityId}\0`)) handler(keys);
    },

    // UI: galaxy.web-api reader, "Sign out" button.
    async signOut(capability: WebApiCapability): Promise<void> {
      await sessions.signOut(capability, profileFor(capability.capabilityId, capability.name));
    },

    // UI: galaxy.web-api reader, endpoint form "Run"; scripting doc.plugins.call("galaxy.web-api", "call", …).
    callEndpoint(capability: WebApiCapability, endpointId: string, input: Record<string, unknown>, options: CallOptions = {}): Promise<WebApiResult> {
      requirePlugin(WEB_API_PLUGIN_ID, 'Web API');
      return webApi.call(deps.documentPath(), capability, profileFor(capability.capabilityId, capability.name), endpointId, input, options);
    },

    // Scripting galaxy.similarity rank: a query from a document the site serves (a resume's sections). Galaxy reads it;
    // the script never sees it.
    openServedDocument(capability: WebApiCapability, endpointId: string, documentId: string): Promise<VisualDocument> {
      requirePlugin(WEB_API_PLUGIN_ID, 'Web API');
      return webApi.openDocument(deps.documentPath(), capability, profileFor(capability.capabilityId, capability.name), endpointId, documentId);
    },

    // UI: galaxy.web-collection reader, "Collect"; scripting collect({ … }). Records go to the consumer (usually a record sink).
    startCollection(definition: CollectionDefinition, consumer: RecordConsumer, onlyStartUrls?: string[]): { runId: string; done: Promise<CollectionRunState> } {
      const profileId = profileFor(definition.capabilityId, definition.name);
      requirePlugin(WEB_COLLECTION_PLUGIN_ID, 'Web Collection');
      // Collecting everything skips the start pages left out of it; naming a start page collects it either way.
      const startPages = onlyStartUrls ? definition.startPages.filter((page) => onlyStartUrls.includes(page.url)) : definition.startPages.filter((page) => page.included !== false);
      if (onlyStartUrls?.some((url) => !definition.startPages.some((page) => page.url === url))) {
        throw new WebAutomationError('invalid_request', "Only the block's own start pages can be collected.");
      }
      return collections.start(definition, profileId, consumer, startPages);
    },

    // UI: galaxy.web-collection reader, single item URL entry; scripting extract({ url }).
    extractItem(definition: CollectionDefinition, url: string, consumer: RecordConsumer): { runId: string; done: Promise<CollectionRunState> } {
      const profileId = profileFor(definition.capabilityId, definition.name);
      requirePlugin(WEB_COLLECTION_PLUGIN_ID, 'Web Collection');
      return collections.extract(definition, profileId, url, consumer);
    },

    // UI: a link clicked in the document. One to a site a web plugin instance here uses (a report, a job posting) opens in
    // Galaxy's browser window, in that instance's profile, signed in as the user is there. False for any other link, or
    // before the instance has a profile: it opens in the default browser.
    openLink(url: string): boolean {
      const owner = deps.linkOwner(url);
      const profile = owner ? profileOf(owner) : null;
      if (!profile) return false;
      emit('user', `opens ${new URL(url).host} in the browser window`, { profileId: profile.id });
      void deps.host.openUserWindow(profile.id, url);
      return true;
    },

    // Document open: each web API block that uses a service's published file has it fetched. UI: "Try again" after a
    // failed fetch (`reload`), and the inline editor asking whether the page's service publishes one. Readers redraw
    // when it arrives.
    async fetchPublishedService(origin: string, reload = false): Promise<PublishedService> {
      const loaded = await loadPublishedService(origin, (url, limits) => deps.host.fetchFile(url, limits), reload);
      emit('document', loaded.status === 'failed' ? `couldn’t read ${new URL(origin).host}’s published file: ${loaded.error}` : `read ${new URL(origin).host}’s published file`);
      return loaded;
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

    // Document load: openDocumentAutomation opens each queue block, from the state saved in it. A queue still in
    // memory from an earlier open of this file is reattached with that state: what it did since for the saved entries
    // stays (a call that finished while the file was closed), and entries never saved go with the unsaved changes.
    openQueue(queueId: string, target: PluginCallTarget, config: QueueConfig = DEFAULT_QUEUE_CONFIG, saved: QueueState | null = null): void {
      const call: QueueTarget = async (input, { idempotencyKey }) => deps.callPlugin(target.pluginId, target.method, { ...target.args, input, idempotencyKey });
      const registryKey = `${deps.documentPath()}\u0000${queueId}`;
      const existing = runtime.queues.get(registryKey);
      if (existing) {
        existing.reopen(saved);
        existing.attach(call);
        queues.set(queueId, existing);
        resumeAfterSignIn(queueId, target);
        return;
      }
      const item = new DurableQueue({
        id: queueId,
        config,
        clock: deps.clock,
        random: deps.random,
        emit,
        createId: deps.createId,
        target: call,
      });
      if (saved) item.restore(saved);
      runtime.queues.set(registryKey, item);
      queues.set(queueId, item);
      resumeAfterSignIn(queueId, target);
    },

    // Document save: what the queue block keeps (DocumentAutomation.saveQueues writes it before serializing).
    savedQueueState(queueId: string): QueueState {
      return queue(queueId).savedState();
    },

    // UI: scripting doc.plugins.call(queue, "enqueue", …), called from an item's Evaluate form.
    enqueue(queueId: string, key: string, input: unknown, options: { delayMs?: number; context?: unknown; label?: string } = {}): { added: boolean } {
      return queue(queueId).enqueue(key, input, options);
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

    // UI: queue reader, entry "Run next" ("Run now" while the queue is paused).
    runQueueEntryNext(queueId: string, key: string): void {
      queue(queueId).runNext(key);
    },

    // UI: queue reader, entry "Cancel".
    cancelQueueEntry(queueId: string, key: string): void {
      queue(queueId).cancel(key);
    },

    // UI: queue reader, entry list.
    listQueue(queueId: string): QueueEntry[] {
      return queue(queueId).list();
    },

    // Document close: DocumentAutomation.close. Calls already sent finish and their results wait for the next open.
    closeDocument(): void {
      for (const run of collections.getState()) collections.stop(run.runId);
      for (const item of queues.values()) item.detach();
      for (const stop of sessionWatchers.values()) stop();
      sessionWatchers.clear();
      sessionHandovers.clear();
      recordWatchers.clear();
    },

    isQueueIdle(queueId: string): boolean {
      return queue(queueId).isIdle();
    },
  };
}

export type WebAutomation = ReturnType<typeof createWebAutomation>;
export type { AutomationEvent };
