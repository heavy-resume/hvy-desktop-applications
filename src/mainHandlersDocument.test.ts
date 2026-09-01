import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});

const hvyMocks = vi.hoisted(() => ({
  applyMountedRecoveryState: vi.fn(),
  getMountedRecoveryState: vi.fn(() => '{"version":1,"activeEditor":{}}'),
}));

const mainMocks = vi.hoisted(() => ({
  captureMountScrollRatio: vi.fn(() => ({ top: 0, left: 0, topPosition: 0, leftPosition: 0 })),
  documentSessions: new Map(),
  mountCurrentDocument: vi.fn(),
  mountRoot: {},
  pendingMountDocument: null,
  preserveCurrentDocumentSession: vi.fn(),
  rerender: vi.fn(),
  restoreMountScrollRatio: vi.fn(),
  saveCurrentDocument: vi.fn(),
  selectDocumentTab: vi.fn(),
  setDocumentDirty: vi.fn(),
  updateCurrentDocumentSession: vi.fn(),
  writeDocumentModePreference: vi.fn(),
  writeHotReloadSessionSnapshot: vi.fn(),
}));

vi.mock('./hvy', () => ({
  applyMountedRecoveryState: hvyMocks.applyMountedRecoveryState,
  getMountedRecoveryState: hvyMocks.getMountedRecoveryState,
}));

vi.mock('./main', () => mainMocks);

import { createDocumentHandlers } from './mainHandlersDocument';
import { state } from './state';

describe('document handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mainMocks.documentSessions.clear();
    state.document = null;
    state.pendingWorkspaceFileOperation = null;
    state.workspaceFileOperationPromptOpen = false;
    state.workspaceClipboard = null;
  });

  it('restores the active editor session across regular and advanced mode remounts', async () => {
    const document = { sections: [] };
    const previousMount = { document, mount: {} };
    const advancedMount = { document, mount: {} };
    const regularMount = { document, mount: {} };
    state.document = {
      documentId: '/workspace/example.hvy',
      path: '/workspace/example.hvy',
      name: 'example.hvy',
      extension: '.hvy',
      mode: 'editor',
      dirty: true,
      readOnly: false,
      hiddenFromAI: false,
      isNew: false,
      metaOpen: false,
      mounted: previousMount,
      recoveryBackupId: null,
      recoveryModified: false,
    } as unknown as NonNullable<typeof state.document>;
    mainMocks.mountCurrentDocument.mockImplementationOnce(async () => {
      state.document!.mounted = advancedMount as never;
    });

    const handlers = createDocumentHandlers(vi.fn());
    handlers.setMode?.('advanced');

    await vi.waitFor(() => {
      expect(hvyMocks.applyMountedRecoveryState).toHaveBeenCalledWith(
        advancedMount,
        '{"version":1,"activeEditor":{}}',
      );
    });
    expect(hvyMocks.getMountedRecoveryState).toHaveBeenCalledWith(previousMount);
    expect(state.document.mode).toBe('advanced');

    mainMocks.mountCurrentDocument.mockImplementationOnce(async () => {
      state.document!.mounted = regularMount as never;
    });
    handlers.setMode?.('editor');

    await vi.waitFor(() => {
      expect(hvyMocks.applyMountedRecoveryState).toHaveBeenCalledWith(
        regularMount,
        '{"version":1,"activeEditor":{}}',
      );
    });
    expect(hvyMocks.getMountedRecoveryState).toHaveBeenCalledWith(advancedMount);
    expect(state.document.mode).toBe('editor');
    expect(mainMocks.restoreMountScrollRatio).toHaveBeenCalledTimes(2);
  });

  it('uses tab selection when a workspace file is opened', () => {
    const handlers = createDocumentHandlers(vi.fn());

    handlers.selectFile?.('/workspace/example.hvy');

    expect(mainMocks.selectDocumentTab).toHaveBeenCalledWith('/workspace/example.hvy');
  });

  it('does nothing when the active recovery tab belongs to the selected workspace file', () => {
    state.document = {
      documentId: 'recovery:example',
      path: '/workspace/example.hvy',
      name: 'example.hvy',
      extension: '.hvy',
      mode: 'editor',
      dirty: true,
      readOnly: false,
      hiddenFromAI: false,
      isNew: false,
      metaOpen: false,
      mounted: null,
      recoveryBackupId: 'example',
      recoveryModified: false,
      virtual: 'recoveryDraft',
    };
    const handlers = createDocumentHandlers(vi.fn());

    handlers.selectFile?.('/workspace/example.hvy');

    expect(mainMocks.selectDocumentTab).not.toHaveBeenCalled();
  });

  it('selects an inactive recovery tab instead of reopening its file from disk', () => {
    mainMocks.documentSessions.set('recovery:example', {
      documentId: 'recovery:example',
      path: '/workspace/example.hvy',
      dirty: true,
      virtual: 'recoveryDraft',
    });
    const handlers = createDocumentHandlers(vi.fn());

    handlers.selectFile?.('/workspace/example.hvy');

    expect(mainMocks.selectDocumentTab).toHaveBeenCalledWith('recovery:example');
  });

  it('prompts before copying a dirty open workspace file', async () => {
    const document = { sections: [] };
    state.document = {
      documentId: '/workspace/example.hvy',
      path: '/workspace/example.hvy',
      name: 'example.hvy',
      extension: '.hvy',
      mode: 'editor',
      dirty: true,
      readOnly: false,
      hiddenFromAI: false,
      isNew: false,
      metaOpen: false,
      mounted: { document, mount: {} },
      recoveryBackupId: null,
      recoveryModified: false,
    } as unknown as NonNullable<typeof state.document>;
    const handlers = createDocumentHandlers(vi.fn());

    handlers.copyWorkspaceFile?.('/workspace/example.hvy', 'example.hvy');

    await vi.waitFor(() => expect(state.workspaceFileOperationPromptOpen).toBe(true));
    expect(mainMocks.preserveCurrentDocumentSession).toHaveBeenCalled();
    expect(mainMocks.selectDocumentTab).toHaveBeenCalledWith('/workspace/example.hvy');
    expect(state.pendingWorkspaceFileOperation).toEqual({
      kind: 'copyClipboard',
      path: '/workspace/example.hvy',
      name: 'example.hvy',
    });
  });

  it('resumes the pending copy after saving', async () => {
    const document = { sections: [] };
    state.document = {
      documentId: '/workspace/example.hvy',
      path: '/workspace/example.hvy',
      name: 'example.hvy',
      extension: '.hvy',
      mode: 'editor',
      dirty: true,
      readOnly: false,
      hiddenFromAI: false,
      isNew: false,
      metaOpen: false,
      mounted: { document, mount: {} },
      recoveryBackupId: null,
      recoveryModified: false,
    } as unknown as NonNullable<typeof state.document>;
    mainMocks.saveCurrentDocument.mockImplementationOnce(async () => {
      state.document!.dirty = false;
    });
    const handlers = createDocumentHandlers(vi.fn());
    handlers.copyWorkspaceFile?.('/workspace/example.hvy', 'example.hvy');
    await vi.waitFor(() => expect(state.workspaceFileOperationPromptOpen).toBe(true));

    handlers.saveBeforeWorkspaceFileOperation?.();

    await vi.waitFor(() => expect(state.workspaceClipboard).toEqual({
      mode: 'copy',
      path: '/workspace/example.hvy',
      name: 'example.hvy',
    }));
    expect(state.pendingWorkspaceFileOperation).toBeNull();
    expect(state.workspaceFileOperationPromptOpen).toBe(false);
  });
});
