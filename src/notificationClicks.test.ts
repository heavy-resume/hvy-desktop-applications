import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mainMocks = vi.hoisted(() => ({
  documentSessions: new Map<string, { documentId: string; versionId: string; source: { path: string } }>(),
  rerender: vi.fn(),
  saveCurrentDocument: vi.fn(async () => undefined),
  closeCurrentDocument: vi.fn(async () => undefined),
  selectDocumentTab: vi.fn(),
}));
const automation = vi.hoisted(() => ({
  setUnattended: vi.fn(),
  pluginAuthorization: () => 'enabled',
  automation: { activity: () => ({ outstanding: 0, lastActivityAt: 0 }) },
}));
const schedule = vi.hoisted(() => ({
  blockId: 'schedule',
  config: { jobs: [{ id: 'fetch', name: 'Fetch', script: 'fetch_due' }], paused: {}, scripts: { fetch_due: '' }, scriptLibraries: [] },
}));

vi.mock('./main', () => mainMocks);
vi.mock('./backend', async (importOriginal) => ({ ...await importOriginal<typeof import('./backend')>(), saveAppSettings: vi.fn(async (settings: unknown) => settings) }));
vi.mock('./webAutomation/app', () => ({ documentAutomationFor: () => automation }));
vi.mock('./webAutomation/documentBlocks', () => ({ readWebAutomationBlocks: () => ({ schedules: [schedule] }) }));
vi.mock('../../heavy-file-format/src/plugins/scripting/wrapper', () => ({ runUserScript: async () => ({ ok: true }) }));

import { openNotificationClick } from './notificationClicks';
import { resetRuntimeDocuments, runtimeDocumentForFile, type RuntimeDocument } from './runtimeDocuments';
import { startScheduledJobs } from './scheduledJobs';
import { state } from './state';
import { runScheduledJobNow } from './webAutomation/scheduleStore';

/** Galaxy's tabs, as the app keeps them: the current document, and the others' sessions. */
let files: RuntimeDocument[] = [];
const navigateToTarget = vi.fn();

function show(file: RuntimeDocument): void {
  const current = state.document;
  if (current && current.documentId !== file.documentId) {
    mainMocks.documentSessions.set(current.versionId, { documentId: current.documentId, versionId: current.versionId, source: current.source });
  }
  mainMocks.documentSessions.delete(file.workingVersionId);
  state.document = { documentId: file.documentId, versionId: file.workingVersionId, source: file, dirty: false, mounted: { document: {}, mount: { navigateToTarget } } } as never;
}

describe('notification clicks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { addEventListener: vi.fn(), setInterval: vi.fn(), setTimeout: globalThis.setTimeout });
    resetRuntimeDocuments();
    mainMocks.documentSessions.clear();
    mainMocks.selectDocumentTab.mockReset();
    mainMocks.saveCurrentDocument.mockClear();
    mainMocks.closeCurrentDocument.mockClear();
    navigateToTarget.mockClear();
    state.document = null;
    state.scheduledJobRuns = {};
    files = ['/workspace/jobs.hvy', '/workspace/notes.hvy'].map((path) => runtimeDocumentForFile({ path, name: path.split('/').pop()!, extension: '.hvy' }));
    // Opening a tab, or a file, makes it the current document.
    mainMocks.selectDocumentTab.mockImplementation(async (path: string) => {
      show(files.find((file) => file.path === path || file.workingVersionId === path)!);
    });
    startScheduledJobs();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const [jobs, notes] = [0, 1];
  const click = (file: RuntimeDocument, target = '') => openNotificationClick({ documentId: file.documentId, path: file.path, target });

  it('shows the target in a document that is already the current tab', async () => {
    show(files[jobs]);

    await click(files[jobs], 'new-postings');

    expect(mainMocks.selectDocumentTab).toHaveBeenCalledWith(files[jobs].workingVersionId);
    expect(state.document?.documentId).toBe(files[jobs].documentId);
    expect(navigateToTarget).toHaveBeenCalledWith('new-postings');
  });

  it('brings forward a document open in another tab, rather than opening it again', async () => {
    show(files[jobs]);
    show(files[notes]);

    await click(files[jobs]);

    expect(mainMocks.selectDocumentTab).toHaveBeenCalledWith(files[jobs].workingVersionId);
    expect(state.document?.documentId).toBe(files[jobs].documentId);
    expect(navigateToTarget).not.toHaveBeenCalled();
  });

  it('brings forward a job\'s tab still open in the background, and the job leaves it to the user', async () => {
    show(files[notes]);
    state.appSettings = { ...state.appSettings, scheduledDocuments: { [files[jobs].documentId]: { name: 'jobs.hvy', idleMinutes: 5, jobs: [], choices: {}, scheduledFrom: {}, lastResults: {} } } };
    await runScheduledJobNow(files[jobs].documentId, 'fetch');
    // The job ran in its own tab, then went back to the user's.
    expect(state.document?.documentId).toBe(files[notes].documentId);

    // The notification is clicked a while after the job started.
    await vi.advanceTimersByTimeAsync(1_000);
    await click(files[jobs], 'new-postings');
    expect(state.document?.documentId).toBe(files[jobs].documentId);
    expect(navigateToTarget).toHaveBeenCalledWith('new-postings');

    // Done and idle: a tab the user brought forward isn't saved and closed under them.
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(state.scheduledJobRuns).toEqual({});
    expect(mainMocks.closeCurrentDocument).not.toHaveBeenCalled();
    expect(state.document?.documentId).toBe(files[jobs].documentId);
  });

  it('opens again from its file a document whose job is done and its tab closed', async () => {
    show(files[notes]);

    await click(files[jobs], 'new-postings');

    expect(mainMocks.selectDocumentTab).toHaveBeenCalledWith(files[jobs].path);
    expect(state.document?.documentId).toBe(files[jobs].documentId);
    expect(navigateToTarget).toHaveBeenCalledWith('new-postings');
  });

  it('opens a document Galaxy no longer knows (sent before a restart) by its path', async () => {
    show(files[notes]);

    await openNotificationClick({ documentId: 'unknown', path: files[jobs].path, target: '' });

    expect(mainMocks.selectDocumentTab).toHaveBeenCalledWith(files[jobs].path);
  });
});
