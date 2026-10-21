import { getActiveStateRuntime, getRenderApp, runWithStateRuntime } from '../../../heavy-file-format/src/state';
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
    profileBindings: state.appSettings.webCapabilityProfileBindings,
    authorizations: state.appSettings.webServiceApprovals,
    accounts,
  }),
  update: (change) => {
    const next = change(settings.get());
    accounts = next.accounts;
    state.appSettings = { ...state.appSettings, webCapabilityProfileBindings: next.profileBindings, webServiceApprovals: next.authorizations };
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

function appRuntime(): WebAutomationRuntime {
  if (!host) throw new WebAutomationError('invalid_request', 'Web automation needs a browser host.');
  runtime ??= createWebAutomationRuntime({
    host,
    clock: systemClock,
    random: Math.random,
    settings,
    createId: () => crypto.randomUUID(),
  });
  return runtime;
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
    // A record sink wrote items outside any script: rerender, as a plugin hook's requestRerender does.
    onDocumentChange: (current) => runWithStateRuntime(current, () => getRenderApp()()),
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
