import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentKeyMetadata } from './backend';

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
  encryptMountedDocumentAsync: vi.fn(async (mounted: { document: { encryption?: unknown } }) => {
    mounted.document.encryption = {
      encrypted: true,
      algorithm: 'fernet',
      keyId: '11111111-1111-4111-8111-111111111111',
    };
  }),
  encryptMountedDocumentWithKey: vi.fn((mounted: { document: { encryption?: unknown } }, keyId: string) => {
    mounted.document.encryption = { encrypted: true, algorithm: 'fernet', keyId };
  }),
  getMountedRecoveryState: vi.fn(() => '{"version":1,"activeEditor":{}}'),
  removeMountedDocumentEncryption: vi.fn((mounted: { document: { encryption?: unknown } }) => {
    mounted.document.encryption = undefined;
  }),
}));

const backendMocks = vi.hoisted(() => ({
  listDocumentKeyMetadata: vi.fn(async (): Promise<DocumentKeyMetadata[]> => []),
  renameDocumentFile: vi.fn(),
}));

const documentKeyMocks = vi.hoisted(() => ({
  documentEncryptionKeyring: vi.fn(() => ({})),
  ensureDocumentKeysLoaded: vi.fn(async () => ({})),
  generateStoredDocumentKey: vi.fn(async (label?: string) => ({
    keyId: '11111111-1111-4111-8111-111111111111',
    algorithm: 'fernet' as const,
    key: 'test-key',
    ...(label ? { label } : {}),
  })),
}));

const documentHistoryMocks = vi.hoisted(() => ({
  clearDocumentHistory: vi.fn(async () => undefined),
}));

const embeddingMocks = vi.hoisted(() => ({
  deleteDocumentEmbeddingSidecar: vi.fn(async () => undefined),
  removeDocumentEmbeddingAttachments: vi.fn(),
}));

const mainMocks = vi.hoisted(() => ({
  captureMountScrollRatio: vi.fn(() => ({ top: 0, left: 0, topPosition: 0, leftPosition: 0 })),
  applyArchivedFileRelocations: vi.fn(),
  copyOpenWorkspaceFileToWorkspace: vi.fn(),
  backupDocumentKey: vi.fn((path: string, name: string) => `${path}:${name}`),
  clearRecoveryDraftsForDocument: vi.fn(async () => undefined),
  documentTitle: vi.fn((name: string) => name.replace(/\.[^.]+$/, '')),
  documentSessions: new Map(),
  loadWorkspace: vi.fn(),
  mountCurrentDocument: vi.fn(),
  mountRoot: {},
  pendingMountDocument: null,
  preserveCurrentDocumentSession: vi.fn(),
  removeOpenDocumentFile: vi.fn(),
  refreshOpenWorkspaceForFile: vi.fn(),
  refreshRecents: vi.fn(),
  relocateRecoveryDraftsForDocument: vi.fn(),
  rerender: vi.fn(),
  restoreMountScrollRatio: vi.fn(),
  saveCurrentDocument: vi.fn(async () => {
    if (state.document) state.document.dirty = false;
  }),
  selectDocumentTab: vi.fn(),
  setDocumentDirty: vi.fn((dirty: boolean) => {
    if (state.document) state.document.dirty = dirty;
  }),
  runBusy: vi.fn(async (_label: string, task: () => Promise<void>) => task()),
  updateHomepageDocumentPath: vi.fn(),
  updateOpenDocumentFile: vi.fn((previousPath: string, file: { path: string; name: string; extension: '.hvy' }) => {
    if (state.document?.source.path !== previousPath) return;
    state.document.source.path = file.path;
    state.document.source.name = file.name;
    state.document.source.extension = file.extension;
  }),
  updateCurrentDocumentSession: vi.fn(),
  upsertWorkspace: vi.fn(),
  workspaceFileAiAccess: vi.fn(() => ({
    archived: false,
    locked: false,
    hiddenFromAI: false,
    encryptedAIAllowed: false,
    readOnly: false,
  })),
  workspacePathForFile: vi.fn(() => null),
  writeDocumentModePreference: vi.fn(),
  writeHotReloadSessionSnapshot: vi.fn(),
}));

vi.mock('./hvy', () => ({
  applyMountedRecoveryState: hvyMocks.applyMountedRecoveryState,
  encryptMountedDocumentAsync: hvyMocks.encryptMountedDocumentAsync,
  encryptMountedDocumentWithKey: hvyMocks.encryptMountedDocumentWithKey,
  getMountedRecoveryState: hvyMocks.getMountedRecoveryState,
  removeMountedDocumentEncryption: hvyMocks.removeMountedDocumentEncryption,
}));

vi.mock('./documentHistory', () => documentHistoryMocks);

vi.mock('./embeddingIndex', () => embeddingMocks);

vi.mock('./documentKeys', () => documentKeyMocks);

vi.mock('./backend', async (importOriginal) => ({
  ...await importOriginal<typeof import('./backend')>(),
  listDocumentKeyMetadata: backendMocks.listDocumentKeyMetadata,
  renameDocumentFile: backendMocks.renameDocumentFile,
}));

vi.mock('./main', () => mainMocks);

import { createDocumentHandlers } from './mainHandlersDocument';
import { state } from './state';

function testOpenDocument(overrides: Partial<NonNullable<typeof state.document>> = {}): NonNullable<typeof state.document> {
  return {
    documentId: 'document:example',
    versionId: 'version:example',
    source: {
      documentId: 'document:example',
      workingVersionId: 'version:example',
      path: '/workspace/example.hvy',
      name: 'example.hvy',
      extension: '.hvy',
    },
    mode: 'editor',
    dirty: true,
    readOnly: false,
    hiddenFromAI: false,
    isNew: false,
    metaOpen: false,
    mounted: null,
    recoveryBackupId: null,
    recoveryModified: false,
    ...overrides,
  };
}

describe('document handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mainMocks.documentSessions.clear();
    state.document = null;
    state.pendingWorkspaceFileOperation = null;
    state.workspaceFileOperationPromptOpen = false;
    state.workspaceClipboard = null;
    state.documentEncryptionAction = null;
    state.documentEncryptionDialogOpen = false;
    state.documentEncryptionKeyId = null;
    state.documentEncryptionKeyLabel = '';
    state.documentEncryptionKeyUsage = {};
    state.documentKeyDataLoading = false;
    backendMocks.renameDocumentFile.mockReset();
  });

  it('restores the active editor session across regular and advanced mode remounts', async () => {
    const document = { sections: [] };
    const previousMount = { document, mount: {} };
    const advancedMount = { document, mount: {} };
    const regularMount = { document, mount: {} };
    state.document = testOpenDocument({
      mounted: previousMount as never,
    });
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
    state.document = testOpenDocument({
      versionId: 'recovery:example',
      recoveryBackupId: 'example',
      virtual: 'recoveryDraft',
    });
    const handlers = createDocumentHandlers(vi.fn());

    handlers.selectFile?.('/workspace/example.hvy');

    expect(mainMocks.selectDocumentTab).not.toHaveBeenCalled();
  });

  it('selects an inactive recovery tab instead of reopening its file from disk', () => {
    mainMocks.documentSessions.set('recovery:example', {
      documentId: 'document:example',
      versionId: 'recovery:example',
      source: testOpenDocument().source,
      dirty: true,
      virtual: 'recoveryDraft',
    });
    const handlers = createDocumentHandlers(vi.fn());

    handlers.selectFile?.('/workspace/example.hvy');

    expect(mainMocks.selectDocumentTab).toHaveBeenCalledWith('recovery:example');
  });

  it('prompts before copying a dirty open workspace file', async () => {
    const document = { sections: [] };
    state.document = testOpenDocument({
      mounted: { document, mount: {} } as never,
    });
    const handlers = createDocumentHandlers(vi.fn());

    handlers.copyWorkspaceFile?.('/workspace/example.hvy', 'example.hvy');

    await vi.waitFor(() => expect(state.workspaceFileOperationPromptOpen).toBe(true));
    expect(mainMocks.preserveCurrentDocumentSession).toHaveBeenCalled();
    expect(mainMocks.selectDocumentTab).toHaveBeenCalledWith('version:example');
    expect(state.pendingWorkspaceFileOperation).toEqual({
      kind: 'copyClipboard',
      path: '/workspace/example.hvy',
      name: 'example.hvy',
    });
  });

  it('resumes the pending copy after saving', async () => {
    const document = { sections: [] };
    state.document = testOpenDocument({
      mounted: { document, mount: {} } as never,
    });
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

  it('preserves the mounted document when pasting a copied workspace file', async () => {
    state.document = testOpenDocument({ dirty: false });
    state.workspaceClipboard = {
      mode: 'copy',
      path: '/workspace/example.hvy',
      name: 'example.hvy',
    };
    const handlers = createDocumentHandlers(vi.fn());

    handlers.pasteWorkspaceClipboard?.('/workspace');

    await vi.waitFor(() => expect(mainMocks.runBusy).toHaveBeenCalledWith(
      'Copying file...',
      expect.any(Function),
      { preserveMountedDocument: true },
    ));
    await vi.waitFor(() => expect(mainMocks.copyOpenWorkspaceFileToWorkspace).toHaveBeenCalledWith(
      '/workspace/example.hvy',
      '/workspace',
      '',
    ));
  });

  it('preserves the mounted document when archiving a workspace file', () => {
    mainMocks.runBusy.mockImplementationOnce(async () => undefined);
    const handlers = createDocumentHandlers(vi.fn());

    handlers.archiveFile?.('/workspace/other.hvy', 'other.hvy');

    expect(mainMocks.runBusy).toHaveBeenCalledWith(
      'Archiving file...',
      expect.any(Function),
      { preserveMountedDocument: true },
    );
  });

  it('persists plaintext immediately after removing document encryption', async () => {
    const document = {
      encryption: {
        encrypted: true,
        algorithm: 'fernet',
        keyId: '11111111-1111-4111-8111-111111111111',
      },
      sections: [],
    };
    state.document = testOpenDocument({
      dirty: false,
      mounted: { document, mount: {} } as never,
    });
    state.documentEncryptionAction = 'decrypt';
    state.documentEncryptionDialogOpen = true;
    const handlers = createDocumentHandlers(vi.fn());

    handlers.confirmDocumentEncryption?.();

    await vi.waitFor(() => expect(hvyMocks.removeMountedDocumentEncryption).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(mainMocks.saveCurrentDocument).toHaveBeenCalledTimes(1));
    expect(document.encryption).toBeUndefined();
    expect(state.document.dirty).toBe(false);
  });

  it('persists ciphertext immediately after enabling document encryption', async () => {
    const document: { sections: unknown[]; encryption?: unknown } = { sections: [] };
    state.document = testOpenDocument({
      dirty: false,
      mounted: { document, mount: {} } as never,
    });
    state.documentEncryptionAction = 'encrypt';
    state.documentEncryptionDialogOpen = true;
    const handlers = createDocumentHandlers(vi.fn());

    handlers.confirmDocumentEncryption?.();

    await vi.waitFor(() => expect(mainMocks.saveCurrentDocument).toHaveBeenCalledTimes(1));
    expect(documentKeyMocks.generateStoredDocumentKey).toHaveBeenCalledWith();
    expect(hvyMocks.encryptMountedDocumentWithKey).toHaveBeenCalledWith(expect.anything(), '11111111-1111-4111-8111-111111111111');
    expect(document.encryption).toEqual(expect.objectContaining({ encrypted: true }));
    expect(state.document.dirty).toBe(false);
  });

  it('stores the optional name when creating a document encryption key', async () => {
    state.document = testOpenDocument({
      dirty: false,
      mounted: { document: { sections: [] }, mount: {} } as never,
    });
    state.documentEncryptionAction = 'encrypt';
    state.documentEncryptionKeyLabel = 'Planning key';
    state.documentEncryptionDialogOpen = true;
    const handlers = createDocumentHandlers(vi.fn());

    handlers.confirmDocumentEncryption?.();

    await vi.waitFor(() => expect(mainMocks.saveCurrentDocument).toHaveBeenCalledTimes(1));
    expect(documentKeyMocks.generateStoredDocumentKey).toHaveBeenCalledWith('Planning key');
  });

  it('opens the encryption modal before available keys finish loading', async () => {
    const metadata = [{
      keyId: '22222222-2222-4222-8222-222222222222',
      label: 'Planning key',
      source: 'imported' as const,
      createdAt: '2026-09-03T12:00:00.000Z',
    }];
    let finishLoading!: (metadata: DocumentKeyMetadata[]) => void;
    backendMocks.listDocumentKeyMetadata.mockImplementationOnce(() => new Promise((resolve) => {
      finishLoading = resolve;
    }));
    state.document = testOpenDocument({
      dirty: false,
      mounted: { document: { sections: [] }, mount: {} } as never,
    });
    const handlers = createDocumentHandlers(vi.fn());

    handlers.requestDocumentEncryption?.('encrypt');

    expect(state.documentEncryptionDialogOpen).toBe(true);
    expect(state.documentKeyDataLoading).toBe(true);
    expect(state.documentKeyMetadata).toEqual([]);
    finishLoading(metadata);
    await vi.waitFor(() => expect(state.documentKeyDataLoading).toBe(false));
    expect(state.documentKeyMetadata).toEqual(metadata);
    expect(state.documentEncryptionKeyId).toBeNull();
  });

  it('encrypts with the selected existing key', async () => {
    const keyId = '22222222-2222-4222-8222-222222222222';
    const document: { sections: unknown[]; encryption?: unknown } = { sections: [] };
    state.document = testOpenDocument({
      dirty: false,
      mounted: { document, mount: {} } as never,
    });
    state.documentEncryptionAction = 'encrypt';
    state.documentEncryptionKeyId = keyId;
    state.documentEncryptionDialogOpen = true;
    const handlers = createDocumentHandlers(vi.fn());

    handlers.confirmDocumentEncryption?.();

    await vi.waitFor(() => expect(mainMocks.saveCurrentDocument).toHaveBeenCalledTimes(1));
    expect(documentKeyMocks.ensureDocumentKeysLoaded).toHaveBeenCalledWith([keyId]);
    expect(hvyMocks.encryptMountedDocumentWithKey).toHaveBeenCalledWith(expect.anything(), keyId);
    expect(documentKeyMocks.generateStoredDocumentKey).not.toHaveBeenCalled();
    expect(document.encryption).toEqual(expect.objectContaining({ encrypted: true, keyId }));
  });

  it('closes the encryption modal before key generation finishes', async () => {
    let finishEncryption!: () => void;
    const encryptionPromise = new Promise<void>((resolve) => {
      finishEncryption = resolve;
    });
    documentKeyMocks.generateStoredDocumentKey.mockImplementationOnce(async () => {
      await encryptionPromise;
      return {
        keyId: '11111111-1111-4111-8111-111111111111',
        algorithm: 'fernet',
        key: 'test-key',
      };
    });
    state.document = testOpenDocument({
      dirty: false,
      mounted: { document: { sections: [] }, mount: {} } as never,
    });
    state.documentEncryptionAction = 'encrypt';
    state.documentEncryptionDialogOpen = true;
    const handlers = createDocumentHandlers(vi.fn());

    handlers.confirmDocumentEncryption?.();

    expect(state.documentEncryptionDialogOpen).toBe(false);
    expect(state.status).toBe('Enabling document encryption...');
    expect(mainMocks.rerender).toHaveBeenCalledWith({ preserveMountedDocument: true });
    expect(mainMocks.saveCurrentDocument).not.toHaveBeenCalled();

    finishEncryption();
    await vi.waitFor(() => expect(mainMocks.saveCurrentDocument).toHaveBeenCalledTimes(1));
  });

  it('updates the shared source without changing active document or version identity when renamed', async () => {
    const document = { sections: [] };
    state.document = testOpenDocument({
      dirty: false,
      mounted: { document, mount: {} } as never,
    });
    mainMocks.preserveCurrentDocumentSession.mockImplementationOnce(() => {
      state.document!.dirty = true;
    });
    backendMocks.renameDocumentFile.mockResolvedValueOnce({
      path: '/workspace/Renamed.hvy',
      name: 'Renamed.hvy',
      extension: '.hvy',
      bytes: [],
    });
    const handlers = createDocumentHandlers(vi.fn());

    handlers.renameFile?.('/workspace/example.hvy', 'example.hvy');
    handlers.submitRenameFile?.('Renamed');

    await vi.waitFor(() => expect(mainMocks.updateOpenDocumentFile).toHaveBeenCalledWith(
      '/workspace/example.hvy',
      expect.objectContaining({ path: '/workspace/Renamed.hvy' }),
    ));
    expect(mainMocks.relocateRecoveryDraftsForDocument).toHaveBeenCalledWith(
      '/workspace/example.hvy',
      'example.hvy',
      expect.objectContaining({ path: '/workspace/Renamed.hvy', name: 'Renamed.hvy' }),
    );
    expect(state.document.documentId).toBe('document:example');
    expect(state.document.versionId).toBe('version:example');
    expect(state.document.source.path).toBe('/workspace/Renamed.hvy');
    expect(state.document.source.name).toBe('Renamed.hvy');
    expect(state.document.dirty).toBe(true);
    expect(mainMocks.preserveCurrentDocumentSession).toHaveBeenCalledOnce();
    expect(mainMocks.runBusy).toHaveBeenCalledWith(
      'Renaming file...',
      expect.any(Function),
      { preserveMountedDocument: true },
    );
    expect(mainMocks.preserveCurrentDocumentSession.mock.invocationCallOrder[0]).toBeLessThan(
      mainMocks.updateOpenDocumentFile.mock.invocationCallOrder[0],
    );
  });
});
