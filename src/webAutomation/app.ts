import { getActiveStateRuntime, getRefreshReaderBlock, getRenderApp, runWithStateRuntime } from '../../../heavy-file-format/src/state';
import type { VisualDocument } from '../../../heavy-file-format/src/types';
import { saveAppSettings } from '../backend';
import { state } from '../state';
import { systemClock } from './clock';
import { setDocumentAutomationOpener, openDocumentAutomation, WEB_AUTOMATION_PLUGINS, type DocumentAutomation } from './documentAutomation';
import { createWebAutomationRuntime, type WebAutomationRuntime } from './entryPoints';
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
  return runtime;
}

/** The section and block of the component-list a CLI path such as /body/jobs/job-list names (top-level sections). */
function componentListAt(document: VisualDocument, listPath: string): { sectionKey: string; blockId: string } | null {
  const [root, sectionId, blockId] = listPath.split('/').filter(Boolean);
  if (root !== 'body' || !sectionId || !blockId) return null;
  const section = document.sections.find((candidate) => candidate.customId === sectionId);
  const block = section?.blocks.find((candidate) => candidate.schema.id === blockId);
  return section && block ? { sectionKey: section.key, blockId: block.id } : null;
}

/** Readers rerender on every automation event (sessions, runs, queues). */
export function subscribeWebAutomation(listener: () => void): () => void {
  return appRuntime().events.subscribe(listener);
}

setDocumentAutomationOpener((rawDocument) => {
  const document = rawDocument as VisualDocument;
  const stateRuntime = getActiveStateRuntime();
  documentPaths.set(document, state.document?.source.path ?? '');
  const opened = openDocumentAutomation(appRuntime(), {
    documentPath: () => documentPaths.get(document) ?? '',
    document,
    stateRuntime,
    // A record sink wrote items outside any script: redraw just the list it wrote to, as the reader's own controls do,
    // so the rest of the document (and where you are in it) stays as it is. The whole document is redrawn when the
    // list is not on screen to refresh (another view, or not shown).
    onDocumentChange: (current, listPath) => runWithStateRuntime(current, () => {
      const list = componentListAt(document, listPath);
      if (!list || !getRefreshReaderBlock()(window.document, list.sectionKey, list.blockId)) getRenderApp()();
    }),
  });
  openedByDocument.set(document, opened);
  return opened.lookup;
});

/** Document save: each queue block takes its queue's state, just before the document is serialized. */
export function saveWebAutomationQueues(document: object): void {
  openedByDocument.get(document)?.saveQueues();
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
    openedByDocument.get(document)?.close();
    openedByDocument.delete(document);
    documentPaths.delete(document);
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
