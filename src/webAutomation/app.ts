import { getActiveStateRuntime, getRefreshReaderBlock, getRenderApp, runWithStateRuntime } from '../../../heavy-file-format/src/state';
import { runPluginDocumentHooks } from '../../../heavy-file-format/src/plugins/hooks';
import type { VisualDocument } from '../../../heavy-file-format/src/types';
import { saveAppSettings } from '../backend';
import { state } from '../state';
import { systemClock } from './clock';
import { setDocumentAutomationOpener, openDocumentAutomation, WEB_AUTOMATION_PLUGINS, type DocumentAutomation } from './documentAutomation';
import type { CollectionRunState } from './collection';
import { createWebAutomationRuntime, type AutomationEvent, type WebAutomationRuntime } from './entryPoints';
import { WebAutomationError } from './errors';
import type { BrowserHost } from './host';
import type { AccountSummary, AutomationSettings, AutomationSettingsStore } from './settings';

/**
 * Web automation in the app: one runtime over the browser host, and each
 * open document's automation, opened the first time its plugins render or
 * are called (inside the document's state runtime).
 */

let host: BrowserHost | null = null;
let runtime: WebAutomationRuntime | null = null;
// Account summaries are refreshed by the session probe, so they are not persisted.
let accounts: Record<string, AccountSummary> = {};
const openedByDocument = new WeakMap<object, DocumentAutomation>();
// Each open document's path, kept current when a document is renamed or moved.
const documentPaths = new Map<object, string>();

export const WEB_AUTOMATION_PLUGIN_IDS = new Set(WEB_AUTOMATION_PLUGINS.map((plugin) => plugin.id));

/** Web automation's settings, kept in the app settings beside Galaxy's other web capability settings. */
const settings: AutomationSettingsStore = {
  get: (): AutomationSettings => ({
    authorizations: state.appSettings.webServiceApprovals,
    accounts,
  }),
  update: (change) => {
    const next = change(settings.get());
    accounts = next.accounts;
    state.appSettings = { ...state.appSettings, webServiceApprovals: next.authorizations };
    void saveAppSettings(state.appSettings).then((saved) => {
      state.appSettings = saved;
    });
  },
};

/** The browser host web automation runs on. Until one is set, documents get no web automation plugins. */
export function setWebAutomationHost(next: BrowserHost): void {
  host = next;
  runtime = null;
}

export function hasWebAutomationHost(): boolean {
  return host !== null;
}

/** The delay scale a development build sets (VITE_WEB_AUTOMATION_DELAY_SCALE); production always paces fully. */
function developmentDelayScale(): number {
  const scale = import.meta.env.DEV ? Number(import.meta.env.VITE_WEB_AUTOMATION_DELAY_SCALE ?? 1) : 1;
  return Number.isFinite(scale) && scale >= 0 ? scale : 1;
}

function appRuntime(): WebAutomationRuntime {
  if (!host) throw new WebAutomationError('invalid_request', 'Web automation needs a browser host.');
  runtime ??= createWebAutomationRuntime({
    host,
    clock: systemClock,
    random: Math.random,
    settings,
    profiles: () => state.integrationRegistry.profiles.map(({ id, name }) => ({ id, name })),
    createId: () => crypto.randomUUID(),
    // Development only: VITE_WEB_AUTOMATION_DELAY_SCALE shortens (or lengthens) the delays between page loads.
    // How many pages are collected at once (App Settings): read as each page's turn comes, so a change applies next.
    scheduler: { navigationDelayScale: developmentDelayScale(), collectionLimits: () => state.appSettings.webCollectionLimits },
  });
  recentEvents.length = 0;
  runtime.events.subscribe((event) => {
    recentEvents.push(event);
    if (recentEvents.length > RECENT_EVENT_LIMIT) recentEvents.splice(0, recentEvents.length - RECENT_EVENT_LIMIT);
  });
  return runtime;
}

// The last automation events, oldest first: what Background activity lists, so a stall shows what it was doing.
const RECENT_EVENT_LIMIT = 200;
const recentEvents: AutomationEvent[] = [];

/** The section and block of the component-list a CLI path such as /body/jobs/job-list names (top-level sections). */
function componentListAt(document: VisualDocument, listPath: string): { sectionKey: string; blockId: string } | null {
  const [root, sectionId, blockId] = listPath.split('/').filter(Boolean);
  if (root !== 'body' || !sectionId || !blockId) return null;
  const section = document.sections.find((candidate) => candidate.customId === sectionId);
  const block = section?.blocks.find((candidate) => candidate.schema.id === blockId);
  return section && block ? { sectionKey: section.key, blockId: block.id } : null;
}

/** Readers rerender on every automation event (sessions, runs, queues). */
export function subscribeWebAutomation(listener: (event: AutomationEvent) => void): () => void {
  return appRuntime().events.subscribe(listener);
}

setDocumentAutomationOpener((rawDocument) => {
  const document = rawDocument as VisualDocument;
  const stateRuntime = getActiveStateRuntime();
  const path = state.document?.source.path ?? '';
  // Coming back to a saved document's tab reads a fresh copy of it: the copy it replaces closes, so the file has one
  // automation, and one set of script handlers. Its queues and what its handlers heard are the file's, kept by path.
  for (const [replaced, replacedPath] of [...documentPaths]) {
    if (!path || replaced === document || replacedPath !== path) continue;
    openedByDocument.get(replaced)?.close();
    openedByDocument.delete(replaced);
    documentPaths.delete(replaced);
  }
  documentPaths.set(document, path);
  const opened = openDocumentAutomation(appRuntime(), {
    documentPath: () => documentPaths.get(document) ?? '',
    document,
    stateRuntime,
    // A record sink wrote items outside any script: redraw just the list it wrote to, as the reader's own controls do,
    // so the rest of the document (and where you are in it) stays as it is. The whole document is redrawn when the
    // list is not on screen to refresh (another view, or not shown). Redrawing just the list skips the document hooks a
    // full redraw ends with, so they run after it: the document's scripts see the new items, as after any other change.
    onDocumentChange: (current, listPath) => runWithStateRuntime(current, () => {
      const list = componentListAt(document, listPath);
      if (!list || !getRefreshReaderBlock()(window.document, list.sectionKey, list.blockId)) getRenderApp()();
      else void runPluginDocumentHooks('unknown');
    }),
    // A record sink wrote rows into the document's database: its table views read it again on a redraw, which ends
    // with the document hooks, so its scripts see the new rows.
    onDatabaseChange: (current) => runWithStateRuntime(current, () => getRenderApp()()),
  });
  openedByDocument.set(document, opened);
  return opened.lookup;
});

/** Document save: each queue block takes its queue's state, just before the document is serialized. */
export function saveWebAutomationQueues(document: object): void {
  openedByDocument.get(document)?.saveQueues();
}

/**
 * A link clicked in a document: one to a site its web plugins use opens in Galaxy's browser window, in their profile.
 * False when it is not one of theirs (or the document's automation is not open), so it opens in the default browser.
 */
export function openWebAutomationLink(document: object, url: string): boolean {
  return openedByDocument.get(document)?.automation.openLink(url) ?? false;
}

let isDocumentOpen: (document: object) => boolean = () => false;

/** How the app tells whether a document object is still open (in the document pane or a background tab). */
export function setOpenDocumentCheck(check: (document: object) => boolean): void {
  isDocumentOpen = check;
}

/**
 * A mount was destroyed. Remounting the same document (switching mode, or
 * coming back to its tab) keeps its automation, so its scripts' handlers stay
 * registered. Once the app no longer holds the document (its tab closed, or
 * it was replaced by a fresh copy), its queues detach: calls already sent
 * finish, and their results wait for the next open.
 */
export function releaseWebAutomation(document: object): void {
  setTimeout(() => {
    if (isDocumentOpen(document)) return;
    const path = documentPaths.get(document);
    openedByDocument.get(document)?.close();
    openedByDocument.delete(document);
    documentPaths.delete(document);
    // The file's tab closed (no copy of it is open): opening it again starts afresh.
    if (path && ![...documentPaths.values()].includes(path)) runtime?.forgetDocument(path);
  }, 0);
}

/** A document moved (renamed, moved between workspaces, or archived): its open automation and its queues follow it. */
export function relocateWebAutomationDocument(previousPath: string, nextPath: string): void {
  for (const [document, path] of documentPaths) {
    if (path === previousPath) documentPaths.set(document, nextPath);
  }
  runtime?.relocateDocument(previousPath, nextPath);
}

const UNATTENDED_PAUSES = new Set(['not_authenticated', 'not_authorized']);

/**
 * The open documents with background work waiting for the user: a collection run that needs them (a page to deal
 * with), or a queue paused until they sign in, allow it, or resume it after reopening. The document's own blocks say
 * what and offer the actions; the app marks the document's tab.
 */
export function documentsNeedingYou(): string[] {
  if (!host) return [];
  const paths: string[] = [];
  for (const [document, documentPath] of documentPaths) {
    const state = openedByDocument.get(document)?.lookup.automation.getState();
    if (!state) continue;
    const runWaits = state.runs.some((run) => run.status === 'needs-attention');
    const queueWaits = Object.values(state.queues).some((queue) => queue.entries.some((entry) => entry.status === 'queued' || entry.status === 'running' || entry.status === 'waiting-retry')
      && (queue.awaitingResume || (queue.paused && UNATTENDED_PAUSES.has(queue.pauseReason ?? ''))));
    if (runWaits || queueWaits) paths.push(documentPath);
  }
  return paths;
}

export interface BackgroundQueueSummary {
  queueId: string;
  queued: number;
  running: number;
  retrying: number;
  failed: number;
  paused: boolean;
  pauseReason: string | null;
  awaitingResume: boolean;
}

export interface BackgroundRunSummary {
  runId: string;
  name: string;
  status: CollectionRunState['status'];
  collected: number;
  skipped: number;
  problems: number;
}

/** What Background activity shows. Plain data, so the app can keep it in its state and render it. */
export interface BackgroundActivity {
  /** Each browser worker: its profile, kind, and the job it is running (null when idle). */
  workers: Array<{ workerId: string; profile: string; kind: 'collection' | 'api'; label: string | null }>;
  /** Jobs waiting for a worker, in the order they will get one. */
  waitingJobs: Array<{ profile: string; kind: 'collection' | 'api'; label: string }>;
  /** Labels running or waiting more than once at the same time: the same call made twice. */
  duplicates: string[];
  /** Each open document with collection runs going or queued work. */
  documents: Array<{ path: string; runs: BackgroundRunSummary[]; queues: BackgroundQueueSummary[] }>;
  /** Newest first. */
  events: AutomationEvent[];
}

const ACTIVE_RUN_STATUSES = new Set<CollectionRunState['status']>(['running', 'needs-attention']);

export function backgroundActivity(): BackgroundActivity {
  if (!host) return { workers: [], waitingJobs: [], duplicates: [], documents: [], events: [] };
  const scheduler = appRuntime().scheduler.getState();
  const profileName = (profileId: string) => state.integrationRegistry.profiles.find(({ id }) => id === profileId)?.name ?? profileId;
  const labels = [...scheduler.workers.flatMap(({ label }) => (label ? [label] : [])), ...scheduler.waitingJobs.map(({ label }) => label)];
  const documents: BackgroundActivity['documents'] = [];
  for (const [document, path] of documentPaths) {
    const lookup = openedByDocument.get(document)?.lookup;
    if (!lookup) continue;
    const automationState = lookup.automation.getState();
    const runs = automationState.runs.filter((run) => ACTIVE_RUN_STATUSES.has(run.status)).map((run): BackgroundRunSummary => ({
      runId: run.runId,
      name: lookup.collection(run.capabilityId)?.name ?? run.capabilityId,
      status: run.status,
      collected: run.collected,
      skipped: run.skipped,
      problems: run.problems,
    }));
    const queues = Object.entries(automationState.queues).map(([queueId, queue]): BackgroundQueueSummary => {
      const count = (status: string) => queue.entries.filter((entry) => entry.status === status).length;
      return {
        queueId,
        queued: count('queued'),
        running: count('running'),
        retrying: count('waiting-retry'),
        failed: count('failed'),
        paused: queue.paused,
        pauseReason: queue.pauseReason,
        awaitingResume: queue.awaitingResume,
      };
    }).filter((queue) => queue.queued + queue.running + queue.retrying + queue.failed > 0);
    if (runs.length || queues.length) documents.push({ path, runs, queues });
  }
  return {
    workers: scheduler.workers.map(({ workerId, profileId, kind, busy, label }) => ({ workerId, profile: profileName(profileId), kind, label: busy ? label : null })),
    waitingJobs: scheduler.waitingJobs.map(({ profileId, kind, label }) => ({ profile: profileName(profileId), kind, label })),
    duplicates: [...new Set(labels.filter((label, index) => labels.indexOf(label) !== index))],
    documents,
    events: [...recentEvents].reverse(),
  };
}

function openDocumentAt(path: string): DocumentAutomation | null {
  for (const [document, documentPath] of documentPaths) if (documentPath === path) return openedByDocument.get(document) ?? null;
  return null;
}

// UI: Background activity, a collection run's "Stop".
export function stopBackgroundRun(path: string, runId: string): void {
  openDocumentAt(path)?.automation.stopCollection(runId);
}

// UI: Background activity, a queue's "Pause" and "Resume", and "Pause all".
export function pauseBackgroundQueue(path: string, queueId: string): void {
  openDocumentAt(path)?.automation.pauseQueue(queueId);
}

export function resumeBackgroundQueue(path: string, queueId: string): void {
  openDocumentAt(path)?.automation.resumeQueue(queueId);
}

export function pauseAllBackgroundQueues(): void {
  for (const { path, queues } of backgroundActivity().documents) for (const { queueId, paused } of queues) if (!paused) pauseBackgroundQueue(path, queueId);
}
