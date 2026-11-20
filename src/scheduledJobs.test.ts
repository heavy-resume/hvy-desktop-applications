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
    state.appSettings = { ...state.appSettings, scheduledDocuments: { [file.documentId]: { name: 'jobs.hvy', idleMinutes: 5, jobs: [], choices: {}, scheduledFrom: {}, lastResults: {} } } };
    // Opening the job's document makes it the open document, as the app does.
    mainMocks.selectDocumentTab.mockImplementation(async () => {
      state.document = { documentId: file.documentId, versionId: file.workingVersionId, source: file, dirty: false, mounted: { document: {} } } as never;
    });

    await runScheduledJobNow(file.documentId, 'fetch');
    expect(state.scheduledJobRuns[file.documentId]).toEqual({ job: 'Fetch' });

    updateRuntimeDocumentFile(file, { path: '/workspace/notes/jobs.hvy', name: 'jobs.hvy', extension: '.hvy' });
    await vi.advanceTimersByTimeAsync(6 * 60_000);

    expect(mainMocks.saveCurrentDocument).toHaveBeenCalled();
    expect(mainMocks.closeCurrentDocument).toHaveBeenCalledWith({ discard: true });
    expect(state.scheduledJobRuns).toEqual({});
  });

  it('starts one of two jobs due at once, holding the lock while it decides and starts, and Run now waits for it', async () => {
    const files = ['/workspace/a.hvy', '/workspace/b.hvy'].map((path) => runtimeDocumentForFile({ path, name: path.split('/').pop()!, extension: '.hvy' }));
    // Both due, a's the longer overdue.
    const scheduled = (name: string, from: number) => ({ name, idleMinutes: 0, jobs: [{ id: 'fetch', name: 'Fetch', timing: { every: 60 } }], choices: { fetch: { on: true } }, scheduledFrom: { fetch: from }, lastResults: {} });
    state.appSettings = { ...state.appSettings, scheduledJobsAtOnce: 1, scheduledDocuments: Object.fromEntries(files.map((file, index) => [file.documentId, scheduled(file.name, index * 60_000)])) };
    // Opening a job's document takes a while: the lock is held all that time.
    let opened: () => void = () => undefined;
    mainMocks.selectDocumentTab.mockReset();
    mainMocks.selectDocumentTab.mockImplementation((path: string) => new Promise<void>((resolve) => {
      opened = () => {
        const file = files.find((candidate) => candidate.path === path || candidate.workingVersionId === path)!;
        state.document = { documentId: file.documentId, versionId: file.workingVersionId, source: file, dirty: false, mounted: { document: {} } } as never;
        resolve();
      };
    }));
    const tick = vi.mocked(window.setInterval).mock.calls.at(-1)![0] as () => void;

    tick();
    tick();
    let ranNow = false;
    void runScheduledJobNow(files[1].documentId, 'fetch').then(() => {
      ranNow = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(mainMocks.selectDocumentTab).toHaveBeenCalledTimes(1);
    expect(ranNow).toBe(false);

    opened();
    await vi.advanceTimersByTimeAsync(0);
    // The first job is busy, so the next due one waits; Run now, pressed meanwhile, goes once the lock is free.
    expect(Object.keys(state.scheduledJobRuns)).toEqual([files[0].documentId]);
    expect(mainMocks.selectDocumentTab).toHaveBeenCalledTimes(2);
    opened();
    await vi.advanceTimersByTimeAsync(0);
    // Then back to the tab that was open.
    opened();
    await vi.advanceTimersByTimeAsync(0);
    expect(ranNow).toBe(true);
    expect(Object.keys(state.scheduledJobRuns)).toEqual([files[0].documentId, files[1].documentId]);
  });

  it('keeps a due job waiting while the user works, however long, and starts it once they are idle', async () => {
    const file = runtimeDocumentForFile({ path: '/workspace/waits.hvy', name: 'waits.hvy', extension: '.hvy' });
    state.appSettings = { ...state.appSettings, scheduledJobsAtOnce: 1, scheduledDocuments: { [file.documentId]: { name: 'waits.hvy', idleMinutes: 5, jobs: [{ id: 'fetch', name: 'Fetch', timing: { every: 60 } }], choices: { fetch: { on: true } }, scheduledFrom: { fetch: 0 }, lastResults: {} } } };
    mainMocks.selectDocumentTab.mockReset();
    mainMocks.selectDocumentTab.mockImplementation(async () => {
      state.document = { documentId: file.documentId, versionId: file.workingVersionId, source: file, dirty: false, mounted: { document: {} } } as never;
    });
    const tick = vi.mocked(window.setInterval).mock.calls.at(-1)![0] as () => void;
    const input = vi.mocked(window.addEventListener).mock.calls.find(([type]) => type === 'keydown')![1] as () => void;

    // Two hours of the user typing every minute: it waits, and nothing is recorded as skipped.
    for (let minute = 0; minute < 120; minute += 1) {
      input();
      tick();
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(state.scheduledJobWaits).toEqual({ [`${file.documentId}\u0000fetch`]: 'you to be idle' });
    expect(state.appSettings.scheduledDocuments[file.documentId].lastResults).toEqual({});

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.appSettings.scheduledDocuments[file.documentId].lastResults.fetch?.outcome).toBe('triggered');
    expect(state.scheduledJobWaits).toEqual({});
  });
});
