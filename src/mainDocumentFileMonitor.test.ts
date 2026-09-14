import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState } from './state';
const mocks = vi.hoisted(() => ({
  readDocumentFile: vi.fn(),
  openDocument: vi.fn(),
  clearRecoveryDraftsForDocument: vi.fn(),
  renderAllAroundDocument: vi.fn(),
}));
vi.mock('./backend', async (importOriginal) => ({ ...await importOriginal<typeof import('./backend')>(), ...mocks, isElectronRuntime: () => false, isTauriRuntime: () => false }));
vi.mock('./main', () => ({ ...mocks, runBusy: async (_label: string, task: () => Promise<void>) => task() }));
import { state } from './state';
import { dismissExternalFileChange, reloadExternalFileChange } from './mainDocumentFileMonitor';

beforeEach(() => {
  vi.clearAllMocks();
  state.document = { source: { path: '/test.hvy', name: 'test.hvy' }, mode: 'editor', dirty: true } as AppState['document'];
  state.externalFileChangePath = '/test.hvy';
});

describe('reload external document changes', () => {
  it('rereads the file and explicitly bypasses cached sessions, preserving the editor mode', async () => {
    const file = { path: '/test.hvy', name: 'test.hvy', bytes: [1, 2] };
    mocks.readDocumentFile.mockResolvedValue(file);
    await reloadExternalFileChange();
    expect(mocks.readDocumentFile).toHaveBeenCalledWith('/test.hvy');
    expect(mocks.openDocument).toHaveBeenCalledWith(file, { source: state.document!.source, reloadFromDisk: true, initialMode: 'editor' });
    expect(mocks.clearRecoveryDraftsForDocument).toHaveBeenCalledWith('/test.hvy', 'test.hvy');
  });
  it('keeps local edits when the prompt is dismissed', () => {
    dismissExternalFileChange();
    expect(state.externalFileChangePath).toBeNull();
    expect(state.document!.dirty).toBe(true);
    expect(mocks.openDocument).not.toHaveBeenCalled();
    expect(mocks.clearRecoveryDraftsForDocument).not.toHaveBeenCalled();
  });
  it('does not reload another tab if the active document changed', async () => {
    state.externalFileChangePath = '/other.hvy';
    await reloadExternalFileChange();
    expect(mocks.readDocumentFile).not.toHaveBeenCalled();
  });
});
