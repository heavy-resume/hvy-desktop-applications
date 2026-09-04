import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const storage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('sessionStorage', storage);
});

const backendMocks = vi.hoisted(() => ({
  createEncryptedFolderDocument: vi.fn(),
  loadWorkspace: vi.fn(),
  readDocumentFile: vi.fn(),
  reauthorizeWorkspace: vi.fn(),
  saveDocumentToWorkspace: vi.fn(),
  updateMcpWorkspaces: vi.fn(() => Promise.resolve()),
}));
const debugLogMocks = vi.hoisted(() => ({ logDebugEvent: vi.fn() }));
const historyMocks = vi.hoisted(() => ({ relocateDocumentHistory: vi.fn() }));

vi.mock('./backend', async (importOriginal) => ({
  ...await importOriginal<typeof import('./backend')>(),
  createEncryptedFolderDocument: backendMocks.createEncryptedFolderDocument,
  loadWorkspace: backendMocks.loadWorkspace,
  readDocumentFile: backendMocks.readDocumentFile,
  reauthorizeWorkspace: backendMocks.reauthorizeWorkspace,
  saveDocumentToWorkspace: backendMocks.saveDocumentToWorkspace,
  updateMcpWorkspaces: backendMocks.updateMcpWorkspaces,
}));

vi.mock('./debugLog', () => debugLogMocks);
vi.mock('./documentHistory', () => historyMocks);

const ENCRYPTION_KEY_ID = '11111111-1111-4111-8111-111111111111';
const ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

vi.mock('./documentKeys', () => ({
  documentEncryptionKeyring: () => ({ [ENCRYPTION_KEY_ID]: ENCRYPTION_KEY }),
}));

const mainMocks = vi.hoisted(() => ({
  adoptSavedAsDocument: vi.fn(),
  backupDocumentKey: vi.fn(),
  clearRecoveryDraftsForDocument: vi.fn(),
  documentSessions: new Map(),
  fileNameFromPath: vi.fn((path: string) => path.replaceAll('\\', '/').split('/').pop() ?? ''),
  moveBackupTracking: vi.fn(),
  openDocument: vi.fn(),
  pendingMountDocument: null,
  readDocumentColorPreference: vi.fn(),
  refreshRecents: vi.fn(),
  relocateRecoveryDraftsForDocument: vi.fn(),
  updateOpenDocumentFile: vi.fn(),
  rerender: vi.fn(),
  runBusy: vi.fn(),
  updateCurrentDocumentSession: vi.fn(),
}));

vi.mock('./main', () => mainMocks);

import { decryptFolderManifest, encryptFolderManifest } from './encryptedFolders';
import { copyOpenWorkspaceFileToWorkspace, applyArchivedFileRelocations, creationTemplate, loadWorkspaceEntry, reorderedWorkspaceEntries, retryWorkspaceEntry, sortedWorkspaceEntries, upsertWorkspace, workspaceDisplayNameFromPath } from './mainWorkspaceUtils';
import { state } from './state';
import { decryptDocumentEnvelopeBytes, encryptDocumentBytes, isEncryptedDocumentBytes } from '../../heavy-file-format/src/encryption';

beforeEach(() => {
  backendMocks.createEncryptedFolderDocument.mockReset();
  backendMocks.readDocumentFile.mockReset();
  backendMocks.saveDocumentToWorkspace.mockReset();
  mainMocks.refreshRecents.mockReset();
});

describe('creationTemplate', () => {
  it('uses the bundled PHVY template for new PHVY documents', () => {
    state.savedTemplates = [];
    state.workspaces = [];

    const template = creationTemplate(null, 'phvy', 'blank.phvy', 'Portfolio');

    expect(template).toContain('title: "Portfolio"');
    expect(template).toContain('heading_styles:');
    expect(template).toContain('margin: 2rem 0 0.5rem');
    expect(template).toContain('component_defaults:');
    expect(template).toContain('css: "margin: 0.5rem 0;"');
  });

  it('uses the bundled meeting minutes template for new THVY documents', () => {
    state.savedTemplates = [];
    state.workspaces = [];

    const template = creationTemplate(null, 'thvy', 'meeting-minutes.thvy', 'Weekly Sync');

    expect(template).toContain('title: "Weekly Sync"');
    expect(template).toContain('component_defs:');
    expect(template).toContain('name: minute-entry');
    expect(template).toContain('id":"minute-entries"');
  });

  it('keeps plain HVY new documents minimal when no template is selected', () => {
    const template = creationTemplate(null, 'hvy', 'blank', 'Notes');

    expect(template).toBe(`---
hvy_version: 0.1
title: "Notes"
---
`);
  });
});

describe('applyArchivedFileRelocations', () => {
  it('moves history and recovery state to the archived file new path', async () => {
    await applyArchivedFileRelocations([{
      previousPath: '/workspace/folder/draft.hvy',
      path: '/workspace/folder/draft 2.hvy',
      name: 'draft 2.hvy',
      extension: '.hvy',
    }]);

    expect(historyMocks.relocateDocumentHistory).toHaveBeenCalledWith(
      '/workspace/folder/draft.hvy',
      '/workspace/folder/draft 2.hvy',
      'draft 2.hvy',
    );
    expect(mainMocks.updateOpenDocumentFile).toHaveBeenCalledWith(
      '/workspace/folder/draft.hvy',
      expect.objectContaining({ path: '/workspace/folder/draft 2.hvy', name: 'draft 2.hvy' }),
    );
    expect(mainMocks.relocateRecoveryDraftsForDocument).toHaveBeenCalledWith(
      '/workspace/folder/draft.hvy',
      'draft.hvy',
      expect.objectContaining({ path: '/workspace/folder/draft 2.hvy', name: 'draft 2.hvy' }),
    );
  });
});

describe('encrypted folder file actions', () => {
  it('encrypts a plaintext document copied into an encrypted folder', async () => {
    const plaintext = new TextEncoder().encode('private planning notes');
    const folderId = '22222222-2222-4222-8222-222222222222';
    const folderPath = `/workspace/hvy-encrypted-folder-${folderId}`;
    const manifestBytes = await encryptFolderManifest({
      version: 1,
      folderId,
      name: 'Private',
      entries: {},
    }, ENCRYPTION_KEY_ID, ENCRYPTION_KEY);
    const workspace = {
      path: '/workspace',
      manifest: { schemaVersion: 1 as const, name: 'Workspace', createdAt: '', updatedAt: '' },
      files: [{
        kind: 'file' as const,
        name: 'Notes.hvy',
        path: '/workspace/Notes.hvy',
        relativePath: 'Notes.hvy',
        extension: '.hvy' as const,
      }, {
        kind: 'folder' as const,
        name: 'Private',
        path: folderPath,
        relativePath: `hvy-encrypted-folder-${folderId}`,
        children: [],
        encryptedFolderManifest: Array.from(manifestBytes),
        encryptedFolderKeyId: ENCRYPTION_KEY_ID,
        encryptionState: 'unlocked' as const,
      }],
    };
    state.workspaces = [workspace];
    state.workspaceEntries = [{ path: workspace.path, displayName: 'Workspace', status: 'ready', error: null }];
    backendMocks.readDocumentFile.mockResolvedValueOnce({
      path: '/workspace/Notes.hvy',
      name: 'Notes.hvy',
      extension: '.hvy',
      bytes: plaintext,
    });
    backendMocks.createEncryptedFolderDocument.mockImplementationOnce(async (request) => ({
      path: `${folderPath}/${request.documentId}.hvy`,
      name: `${request.documentId}.hvy`,
      extension: '.hvy',
      bytes: request.documentBytes,
    }));
    backendMocks.loadWorkspace.mockResolvedValueOnce(workspace);

    await copyOpenWorkspaceFileToWorkspace('/workspace/Notes.hvy', '/workspace', `hvy-encrypted-folder-${folderId}`);

    const request = backendMocks.createEncryptedFolderDocument.mock.calls[0]?.[0];
    const encryptedBytes = Uint8Array.from(request.documentBytes);
    expect(isEncryptedDocumentBytes(encryptedBytes)).toBe(true);
    expect((await decryptDocumentEnvelopeBytes(encryptedBytes, {
      keyId: ENCRYPTION_KEY_ID,
      key: ENCRYPTION_KEY,
    })).bytes).toEqual(plaintext);
    expect(await decryptFolderManifest(Uint8Array.from(request.manifestBytes), ENCRYPTION_KEY)).toMatchObject({
      entries: { [request.documentId]: { name: 'Notes.hvy', kind: 'document', documentExtension: '.hvy' } },
    });
  });

  it('preserves whole-document encryption when copying out of an encrypted folder', async () => {
    const plaintext = new TextEncoder().encode('private planning notes');
    const encrypted = await encryptDocumentBytes(plaintext, { keyId: ENCRYPTION_KEY_ID, key: ENCRYPTION_KEY });
    const sourcePath = '/workspace/hvy-encrypted-folder-22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.hvy';
    const workspace = {
      path: '/workspace',
      manifest: { schemaVersion: 1 as const, name: 'Workspace', createdAt: '', updatedAt: '' },
      files: [{
        kind: 'folder' as const,
        name: 'Private',
        path: '/workspace/hvy-encrypted-folder-22222222-2222-4222-8222-222222222222',
        relativePath: 'hvy-encrypted-folder-22222222-2222-4222-8222-222222222222',
        children: [{
          kind: 'file' as const,
          name: 'Notes.hvy',
          path: sourcePath,
          relativePath: 'hvy-encrypted-folder-22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.hvy',
          extension: '.hvy' as const,
          encryptedFolderKeyId: ENCRYPTION_KEY_ID,
        }],
        encryptedFolderKeyId: ENCRYPTION_KEY_ID,
        encryptionState: 'unlocked' as const,
      }],
    };
    state.workspaces = [workspace];
    state.workspaceEntries = [{ path: workspace.path, displayName: 'Workspace', status: 'ready', error: null }];
    backendMocks.readDocumentFile.mockResolvedValueOnce({
      path: sourcePath,
      name: '33333333-3333-4333-8333-333333333333.hvy',
      extension: '.hvy',
      bytes: encrypted.bytes,
    });
    backendMocks.saveDocumentToWorkspace.mockResolvedValueOnce({
      path: '/workspace/Notes.hvy',
      name: 'Notes.hvy',
      extension: '.hvy',
    });
    backendMocks.loadWorkspace.mockResolvedValueOnce(workspace);

    await copyOpenWorkspaceFileToWorkspace(sourcePath, '/workspace');

    const savedBytes = Uint8Array.from(backendMocks.saveDocumentToWorkspace.mock.calls[0]?.[0].bytes);
    expect(isEncryptedDocumentBytes(savedBytes)).toBe(true);
    expect(savedBytes).toEqual(encrypted.bytes);
    expect((await decryptDocumentEnvelopeBytes(savedBytes, {
      keyId: ENCRYPTION_KEY_ID,
      key: ENCRYPTION_KEY,
    })).bytes).toEqual(plaintext);
  });
});

describe('workspace ordering', () => {
  const entries = ['one', 'two', 'three'].map((path) => ({ path, displayName: path, status: 'ready' as const, error: null }));

  it('moves an entry before a target', () => {
    expect(reorderedWorkspaceEntries(entries, 'three', 'one', true).map((entry) => entry.path)).toEqual(['three', 'one', 'two']);
  });

  it('moves an entry after a target', () => {
    expect(reorderedWorkspaceEntries(entries, 'one', 'two', false).map((entry) => entry.path)).toEqual(['two', 'one', 'three']);
  });

  it('sorts by workspace name in either direction', () => {
    const workspaces = [
      { path: 'one', manifest: { schemaVersion: 1 as const, name: 'Zulu', createdAt: '', updatedAt: '' }, files: [] },
      { path: 'two', manifest: { schemaVersion: 1 as const, name: 'Alpha', createdAt: '', updatedAt: '' }, files: [] },
      { path: 'three', manifest: { schemaVersion: 1 as const, name: 'Mike', createdAt: '', updatedAt: '' }, files: [] },
    ];
    expect(sortedWorkspaceEntries(entries, workspaces, [], 'nameAsc').map((entry) => entry.path)).toEqual(['two', 'three', 'one']);
    expect(sortedWorkspaceEntries(entries, workspaces, [], 'nameDesc').map((entry) => entry.path)).toEqual(['one', 'three', 'two']);
  });

  it('sorts by recorded recency without changing the source entries', () => {
    expect(sortedWorkspaceEntries(entries, [], ['two', 'one', 'three'], 'recentDesc').map((entry) => entry.path)).toEqual(['two', 'one', 'three']);
    expect(sortedWorkspaceEntries(entries, [], ['two', 'one', 'three'], 'recentAsc').map((entry) => entry.path)).toEqual(['three', 'one', 'two']);
    expect(entries.map((entry) => entry.path)).toEqual(['one', 'two', 'three']);
  });
});

describe('workspace sidebar lifecycle', () => {
  it('uses the folder name before a manifest is available', () => {
    expect(workspaceDisplayNameFromPath('/Users/example/OneDrive/HVY Work/')).toBe('HVY Work');
    expect(workspaceDisplayNameFromPath('C:\\Users\\example\\HVY Work')).toBe('HVY Work');
  });

  it('keeps a failed workspace as an error entry and excludes it from ready workspaces', async () => {
    state.workspaces = [];
    state.workspaceEntries = [];
    backendMocks.loadWorkspace.mockRejectedValueOnce(new Error('Operation not permitted'));

    await loadWorkspaceEntry('/OneDrive/HVY Work');

    expect(state.workspaces).toEqual([]);
    expect(state.workspaceEntries).toEqual([{
      path: '/OneDrive/HVY Work',
      displayName: 'HVY Work',
      status: 'error',
      error: 'Operation not permitted',
    }]);
    expect(debugLogMocks.logDebugEvent).toHaveBeenCalledWith('load', 'workspace:loadError', expect.objectContaining({
      path: '/OneDrive/HVY Work',
      errorMessage: 'Operation not permitted',
      errorType: 'Error',
    }));
  });

  it('loads restored workspaces without recording recent activity', async () => {
    state.workspaces = [];
    state.workspaceEntries = [];
    backendMocks.loadWorkspace.mockResolvedValueOnce({
      path: '/Work',
      manifest: { schemaVersion: 1, name: 'Work', createdAt: '', updatedAt: '' },
      files: [],
    });

    await loadWorkspaceEntry('/Work', { unlockEncryptedFolders: false });

    expect(backendMocks.loadWorkspace).toHaveBeenLastCalledWith('/Work', {
      includeTemplates: false,
      recordRecent: false,
      unlockEncryptedFolders: false,
    });
  });

  it('puts a newly added workspace at the top of the manual order', () => {
    state.workspaces = [];
    state.workspaceEntries = [{ path: '/Existing', displayName: 'Existing', status: 'ready', error: null }];

    upsertWorkspace({
      path: '/New',
      manifest: { schemaVersion: 1, name: 'New', createdAt: '', updatedAt: '' },
      files: [],
    });

    expect(state.workspaceEntries.map((entry) => entry.path)).toEqual(['/New', '/Existing']);
  });

  it('retries an error entry and hydrates it in place', async () => {
    state.workspaces = [];
    state.workspaceEntries = [{
      path: '/OneDrive/HVY Work',
      displayName: 'HVY Work',
      status: 'error',
      error: 'Operation not permitted',
    }];
    backendMocks.loadWorkspace.mockResolvedValueOnce({
      path: '/OneDrive/HVY Work',
      manifest: { schemaVersion: 1, name: 'Work', createdAt: '', updatedAt: '' },
      files: [],
    });

    await loadWorkspaceEntry('/OneDrive/HVY Work');

    expect(state.workspaces).toHaveLength(1);
    expect(state.workspaceEntries).toEqual([{
      path: '/OneDrive/HVY Work',
      displayName: 'Work',
      status: 'ready',
      error: null,
    }]);
  });

  it('uses the macOS permission picker when retrying an operation-not-permitted error', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Macintosh' });
    state.workspaces = [];
    state.workspaceEntries = [{
      path: '/OneDrive/HVY Work',
      displayName: 'HVY Work',
      status: 'error',
      error: 'Operation not permitted (os error 1)',
    }];
    backendMocks.reauthorizeWorkspace.mockResolvedValueOnce({
      path: '/OneDrive/HVY Work',
      manifest: { schemaVersion: 1, name: 'Work', createdAt: '', updatedAt: '' },
      files: [],
    });

    await retryWorkspaceEntry('/OneDrive/HVY Work');

    expect(backendMocks.reauthorizeWorkspace).toHaveBeenCalledWith('/OneDrive/HVY Work');
    expect(state.workspaceEntries[0]?.status).toBe('ready');
    expect(debugLogMocks.logDebugEvent).toHaveBeenCalledWith('load', 'workspace:loadStart', expect.objectContaining({
      path: '/OneDrive/HVY Work',
      source: 'macOSPermissionPicker',
    }));
    vi.unstubAllGlobals();
  });
});
