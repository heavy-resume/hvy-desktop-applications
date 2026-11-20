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

import { startScheduledJobs } from './scheduledJobs';
import { resetRuntimeDocuments, runtimeDocumentForFile, updateRuntimeDocumentFile } from './runtimeDocuments';
import { state } from './state';
import { runScheduledJobNow } from './webAutomation/scheduleStore';

describe('scheduled jobs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { addEventListener: vi.fn(), setInterval: vi.fn(), setTimeout: globalThis.setTimeout });
    resetRuntimeDocuments();
    mainMocks.documentSessions.clear();
    state.document = null;
    state.scheduledJobRuns = {};
    startScheduledJobs();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('saves and closes the tab it opened even when its file was renamed while the job ran', async () => {
    const file = runtimeDocumentForFile({ path: '/workspace/jobs.hvy', name: 'jobs.hvy', extension: '.hvy' });
    state.appSettings = { ...state.appSettings, scheduledDocuments: { '/workspace/jobs.hvy': { name: 'jobs.hvy', idleMinutes: 5, jobs: [], choices: {}, scheduledFrom: {}, lastResults: {} } } };
    // Opening the job's document makes it the open document, as the app does.
    mainMocks.selectDocumentTab.mockImplementation(async () => {
      state.document = { documentId: file.documentId, versionId: file.workingVersionId, source: file, dirty: false, mounted: { document: {} } } as never;
    });

    await runScheduledJobNow('/workspace/jobs.hvy', 'fetch');
    expect(state.scheduledJobRuns[file.documentId]).toEqual({ job: 'Fetch' });

    updateRuntimeDocumentFile(file, { path: '/workspace/notes/jobs.hvy', name: 'jobs.hvy', extension: '.hvy' });
    await vi.advanceTimersByTimeAsync(6 * 60_000);

    expect(mainMocks.saveCurrentDocument).toHaveBeenCalled();
    expect(mainMocks.closeCurrentDocument).toHaveBeenCalledWith({ discard: true });
    expect(state.scheduledJobRuns).toEqual({});
  });
});
