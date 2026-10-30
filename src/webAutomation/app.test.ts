import { describe, expect, it, vi } from 'vitest';
import { clearPluginAuthorization } from '../../../heavy-file-format/src/plugins/authorization/plugin-authorization-policy';
import { runWithStateRuntime } from '../../../heavy-file-format/src/state';
import { deserializeDocument, serializeDocument } from '../../../heavy-file-format/src/serialization';
import { defaultAppSettings } from '../backend';
import { defaultIntegrationRegistry } from '../integrationRegistry';
import { state, type AppState } from '../state';
import { mockAnalysisService } from '../test/webAutomation/analysisService';
import { createDocumentState } from '../test/webAutomation/documentHost';
import { EVALUATE_QUEUE, mockQueueBlocks } from '../test/webAutomation/flow';
import { buildSearchDocument } from '../test/webAutomation/listingDocument';
import { mockWebSites } from '../test/webAutomation/sites';
import { capabilityOrigin } from './webApi';
import { MockHost } from '../test/webAutomation/mockHost';
import { relocatedDocumentSettings } from '../documentSettingsRelocation';
import { relocateWebAutomationDocument, releaseWebAutomation, saveWebAutomationQueues, setOpenDocumentCheck, setWebAutomationHost } from './app';
import { resolveDocumentAutomation } from './documentAutomation';

vi.mock('../backend', async (importOriginal) => ({
  ...await importOriginal<typeof import('../backend')>(),
  saveAppSettings: async (settings: unknown) => settings,
}));

const DOCUMENT_PATH = '/workspace/Jobs.hvy';
const api = mockAnalysisService();

/** A document as the app mounts it: its own state runtime, with both web plugins allowed in the file. */
function mountedDocument(text?: string) {
  const document = text
    ? deserializeDocument(text, '.hvy')
    : buildSearchDocument({ webApi: structuredClone(api.capability), queues: mockQueueBlocks(api) });
  const stateRuntime = createDocumentState(document, { getAcceptance: () => true, onAcceptanceChanged: () => undefined });
  // The plugins render or are called inside the document's state runtime; that is where the app opens its automation.
  const open = () => runWithStateRuntime(stateRuntime, () => resolveDocumentAutomation({ rawDocument: document }));
  return { document, stateRuntime, open };
}

describe('web automation in the app', () => {
  state.appSettings = defaultAppSettings();
  state.document = { source: { path: DOCUMENT_PATH } } as AppState['document'];
  setWebAutomationHost(new MockHost([]));
  // One browser profile on this machine: the document names none, and uses it without asking.
  state.integrationRegistry = { ...defaultIntegrationRegistry(), profiles: [{ id: 'service', name: 'Service', providerId: 'google', browserStoreId: 'service' }] };

  it('uses the only browser profile without asking, and keeps service approvals in the app settings', () => {
    const { automation } = mountedDocument().open();
    expect(automation.profileOf(api.capability.capabilityId)).toEqual({ id: 'service', name: 'Service' });
    automation.authorizeWebApi(api.capability);

    expect(state.appSettings.webServiceApprovals[DOCUMENT_PATH]?.[api.capability.capabilityId]).toMatchObject({ profileId: 'service', name: api.capability.name });
  });

  it('writes queues into their blocks on save, and keeps them in memory after the document closes', async () => {
    const first = mountedDocument();
    const { automation } = first.open();
    expect(first.open().automation).toBe(automation);
    automation.pauseQueue(EVALUATE_QUEUE);
    automation.enqueue(EVALUATE_QUEUE, 'job-1', { url: 'https://boards.example.test/1' });

    saveWebAutomationQueues(first.document);
    const saved = serializeDocument(first.document);
    const { idempotencyKey } = automation.listQueue(EVALUATE_QUEUE)[0];
    expect(saved).toContain(idempotencyKey);

    // The tab is closed, then the file is opened again: the app still holds the queue, so the new document reattaches it.
    setOpenDocumentCheck(() => false);
    releaseWebAutomation(first.document);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const reopened = mountedDocument(saved).open();
    expect(reopened.automation).not.toBe(automation);
    expect(reopened.automation.listQueue(EVALUATE_QUEUE)).toMatchObject([{ key: 'job-1', idempotencyKey }]);
  });

  it('keeps the automation, and so its scripts\' handlers, when the same document is remounted, and follows it to the new mount', async () => {
    const mounted = mountedDocument();
    const { automation } = mounted.open();
    // Switching mode remounts the document: the app still holds it, and the old mount's state is torn down.
    setOpenDocumentCheck((document) => document === mounted.document);
    releaseWebAutomation(mounted.document);
    await new Promise((resolve) => setTimeout(resolve, 0));
    clearPluginAuthorization(mounted.stateRuntime);
    const remounted = createDocumentState(mounted.document, { getAcceptance: () => true, onAcceptanceChanged: () => undefined });
    const lookup = runWithStateRuntime(remounted, () => resolveDocumentAutomation({ rawDocument: mounted.document }));

    expect(lookup.automation).toBe(automation);
    // The plugin is allowed in the new mount's state, so the automation's calls go through.
    automation.authorizeWebApi(api.capability);
    await expect(automation.probeSession(api.capability)).resolves.toMatchObject({ profileId: 'service' });
  });

  it('follows a renamed document: its approval and queues stay with it (its profile is in the document)', async () => {
    const renamed = '/workspace/Renamed Jobs.hvy';
    state.appSettings = defaultAppSettings();
    state.document = { source: { path: DOCUMENT_PATH } } as AppState['document'];
    const mounted = mountedDocument();
    const { automation } = mounted.open();
    automation.authorizeWebApi(api.capability);
    automation.pauseQueue(EVALUATE_QUEUE);
    automation.enqueue(EVALUATE_QUEUE, 'job-1', { url: 'https://boards.example.test/1' });
    // UI: File > Save.
    saveWebAutomationQueues(mounted.document);
    const saved = serializeDocument(mounted.document);
    const { idempotencyKey } = automation.listQueue(EVALUATE_QUEUE)[0];

    // The rename, as Galaxy's rename handler applies it.
    state.appSettings = relocatedDocumentSettings(state.appSettings, DOCUMENT_PATH, renamed);
    relocateWebAutomationDocument(DOCUMENT_PATH, renamed);
    state.document = { source: { path: renamed } } as AppState['document'];

    expect(automation.reviewWebApi(api.capability)).toMatchObject({ reason: 'authorized' });
    await expect(automation.probeSession(api.capability)).resolves.toMatchObject({ profileId: 'service' });

    // Closed and opened again under its new name: the queue still in memory is reattached to it.
    setOpenDocumentCheck(() => false);
    releaseWebAutomation(mounted.document);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mountedDocument(saved).open().automation.listQueue(EVALUATE_QUEUE)).toMatchObject([{ key: 'job-1', idempotencyKey }]);
  });
  it('switching tabs away and back calls nothing again: the file\'s script handlers already heard it is signed in', async () => {
    state.appSettings = defaultAppSettings();
    state.document = { source: { path: DOCUMENT_PATH } } as AppState['document'];
    const host = new MockHost(mockWebSites(api));
    setWebAutomationHost(host);
    host.completeLogin('service', capabilityOrigin(api.capability));
    const first = mountedDocument();
    const { automation } = first.open();
    automation.authorizeWebApi(api.capability);
    await expect(automation.probeSession(api.capability)).resolves.toMatchObject({ status: 'signed-in' });
    // The document's load script registers its handler on each mount, and on signed-in loads the account's data.
    const heard: string[] = [];
    const load = (opened: { automation: typeof automation }) => opened.automation.onSessionChange(api.capability, 'resume-list', (session) => heard.push(session.status));
    load(first.open());
    expect(heard).toEqual(['signed-in']);

    // UI: another tab, then back. The saved file is read again, so a fresh copy mounts, and its load script runs again.
    setOpenDocumentCheck((document) => document === first.document);
    releaseWebAutomation(first.document);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = mountedDocument(serializeDocument(first.document));
    const back = second.open();
    expect(back.automation).not.toBe(automation);
    load(back);
    expect(heard).toEqual(['signed-in']);

    // UI: the tab closed, and the file opened again: a fresh start, so it hears again.
    setOpenDocumentCheck(() => false);
    releaseWebAutomation(second.document);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const reopened = mountedDocument(serializeDocument(second.document)).open();
    load(reopened);
    expect(heard).toEqual(['signed-in', 'signed-in']);

    // The copies it replaced are closed, so a change is heard once.
    await reopened.automation.signOut(api.capability);
    expect(heard).toEqual(['signed-in', 'signed-in', 'signed-out']);
  });

  it('drops queued work the file never saved when it is closed without saving and opened again', async () => {
    const mounted = mountedDocument();
    const { automation } = mounted.open();
    automation.pauseQueue(EVALUATE_QUEUE);
    automation.enqueue(EVALUATE_QUEUE, 'job-1', { url: 'https://boards.example.test/1' });

    // UI: the tab closed, discarding the changes; the file opened again as it was saved.
    setOpenDocumentCheck(() => false);
    releaseWebAutomation(mounted.document);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const reopened = mountedDocument(serializeDocument(mountedDocument().document)).open();
    expect(reopened.automation.listQueue(EVALUATE_QUEUE)).toEqual([]);
  });
});
