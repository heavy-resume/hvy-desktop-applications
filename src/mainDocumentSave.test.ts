import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedVersion } from './revisionModel';

vi.hoisted(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal('window', {});
});

const backendMocks = vi.hoisted(() => ({
  clearDocumentRecoveryDrafts: vi.fn(async () => undefined),
  readDocumentFile: vi.fn(),
  saveDocumentFile: vi.fn(async () => undefined),
}));

const mainMocks = vi.hoisted(() => ({
  captureMountScrollRatio: vi.fn(() => ({ top: 0.4, left: 0, topPosition: 240, leftPosition: 0 })),
  documentSessions: new Map(),
  markDocumentTabOpened: vi.fn(),
  mountRoot: null,
  openDocument: vi.fn(async (_file: unknown, _options?: unknown) => undefined),
  refreshRecents: vi.fn(async () => undefined),
  removeDocumentTabPath: vi.fn(),
  rerender: vi.fn(),
  renderAllAroundDocument: vi.fn(),
  restoreMountScrollRatio: vi.fn(),
  runBusy: vi.fn(async (_label, operation) => operation()),
  updateCurrentDocumentSession: vi.fn(),
  updateDirtyChrome: vi.fn(),
  workspaceFilterDocumentCache: new Map(),
}));

const historyMocks = vi.hoisted(() => ({
  listSavedDocumentVersions: vi.fn(async (): Promise<SavedVersion[]> => []),
  materializeSavedDocumentVersion: vi.fn(async () => new Uint8Array([7, 8, 9])),
  recordSuccessfulDocumentSave: vi.fn(),
}));

vi.mock('./backend', async (importOriginal) => ({
  ...await importOriginal<typeof import('./backend')>(),
  ...backendMocks,
}));
vi.mock('./debugLog', () => ({
  logDebugEvent: vi.fn(),
  measureDebug: vi.fn((_category, _name, _details, operation) => operation()),
  measureDebugAsync: vi.fn((_category, _name, _details, operation) => operation()),
}));
vi.mock('./embeddingIndex', () => ({
  attachMatchingSidecarEmbeddingIndex: vi.fn(),
  deleteSidecarIfSavedDocumentContainsMatchingIndex: vi.fn(),
}));
vi.mock('./hvy', () => ({
  getMountedDocument: vi.fn((mounted) => mounted.document),
  getMountedRecoveryState: vi.fn(() => null),
  isMountedDocumentDirty: vi.fn(() => false),
  markMountedDocumentSaved: vi.fn(),
  profileHvySerializationCosts: vi.fn(async () => ({
    totalProfileMs: 0,
    sectionCount: 0,
    blockCount: 0,
    componentTotals: {},
    slowestSections: [],
    slowestBlocks: [],
  })),
  serializeMountedDocumentAsync: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));
vi.mock('./main', () => mainMocks);
vi.mock('./mainWorkspaceUtils', () => ({
  refreshOpenWorkspaceForFile: vi.fn(async () => undefined),
}));
vi.mock('./documentHistory', () => ({
  ...historyMocks,
}));

import { openSavedVersionPreview, openVersionHistory, saveCurrentDocument, selectDocumentTab } from './mainDocumentSave';
import { state } from './state';

describe('saveCurrentDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mainMocks.documentSessions.clear();
    state.busy = false;
    state.error = null;
    state.versionHistorySidebarOpen = false;
    state.versionHistorySourcePath = null;
    state.versionHistorySourceName = null;
    state.document = null;
    state.saveAsDialogOpen = false;
  });

  it('routes saving an edited history snapshot through Save As', async () => {
    state.document = {
      documentId: 'history-document',
      versionId: 'history-version',
      source: {
        documentId: 'history-document',
        workingVersionId: 'history-version',
        path: 'version-history:%2Fworkspace%2FExample.hvy:saved-version',
        name: 'Example.hvy — saved version',
        extension: '.hvy',
      },
      displayName: 'Example.hvy — September 2, 2026',
      mode: 'editor',
      dirty: true,
      readOnly: false,
      hiddenFromAI: true,
      isNew: false,
      metaOpen: false,
      mounted: { document: { sections: [] }, mount: {} } as never,
      recoveryBackupId: null,
      recoveryModified: false,
      virtual: 'versionHistory',
      historySourcePath: '/workspace/Example.hvy',
      historySourceName: 'Example.hvy',
      historyVersionId: 'saved-version',
    };

    await saveCurrentDocument();

    expect(state.saveAsDialogOpen).toBe(true);
    expect(backendMocks.saveDocumentFile).not.toHaveBeenCalled();
  });

  it('rerenders the sidebar after saving refreshed workspace file state', async () => {
    state.document = {
      documentId: 'document:example',
      versionId: 'version:example',
      source: {
        documentId: 'document:example',
        workingVersionId: 'version:example',
        path: '/workspace/Example.hvy',
        name: 'Example.hvy',
        extension: '.hvy',
      },
      mode: 'editor',
      dirty: true,
      readOnly: false,
      hiddenFromAI: false,
      isNew: false,
      metaOpen: false,
      mounted: { document: { sections: [] }, mount: {} } as never,
      recoveryBackupId: null,
      recoveryModified: false,
    };

    await saveCurrentDocument();

    expect(state.document.dirty).toBe(false);
    expect(mainMocks.updateDirtyChrome).toHaveBeenCalledTimes(2);
    expect(mainMocks.renderAllAroundDocument).toHaveBeenCalledOnce();
  });

  it('rebuilds the tab strip after promoting a recovery draft to the working version', async () => {
    const source = {
      documentId: 'document:example',
      workingVersionId: 'version:working',
      path: '/workspace/Example.md',
      name: 'Example.md',
      extension: '.md' as const,
    };
    state.document = {
      documentId: source.documentId,
      versionId: 'recovery-draft:backup',
      source,
      mode: 'editor',
      dirty: true,
      readOnly: false,
      hiddenFromAI: false,
      isNew: false,
      metaOpen: false,
      mounted: { document: { sections: [] }, mount: {} } as never,
      recoveryBackupId: 'backup',
      recoveryModified: false,
      virtual: 'recoveryDraft',
    };

    await saveCurrentDocument();

    expect(state.error).toBeNull();
    expect(state.document.virtual).toBeUndefined();
    expect(state.document.versionId).toBe(source.workingVersionId);
    expect(state.document.dirty).toBe(false);
    expect(mainMocks.renderAllAroundDocument).toHaveBeenCalledOnce();
  });

  it('reopens a clean tab from its source path instead of its runtime version id', async () => {
    const source = {
      documentId: 'document:example',
      workingVersionId: 'version:example',
      path: '/workspace/Example.hvy',
      name: 'Example.hvy',
      extension: '.hvy' as const,
    };
    const file = { ...source, bytes: [1, 2, 3] };
    mainMocks.documentSessions.set(source.workingVersionId, {
      source,
      versionId: source.workingVersionId,
      dirty: false,
      isNew: false,
      readOnly: false,
    });
    backendMocks.readDocumentFile.mockResolvedValueOnce(file);

    await selectDocumentTab(source.workingVersionId);

    expect(backendMocks.readDocumentFile).toHaveBeenCalledWith(source.path);
    expect(mainMocks.openDocument).toHaveBeenCalledWith(file, {
      source,
      versionId: source.workingVersionId,
    });
    expect(mainMocks.refreshRecents).toHaveBeenCalledOnce();
  });

  it('reopens a clean tab with an in-progress component from its editor session', async () => {
    const source = {
      documentId: 'document:example',
      workingVersionId: 'version:example',
      path: '/workspace/Example.hvy',
      name: 'Example.hvy',
      extension: '.hvy' as const,
    };
    const recoveryState = JSON.stringify({
      version: 1,
      activeEditor: {
        activeEditorBlock: { sectionKey: 'summary', blockId: 'draft-component' },
        activeEditorBlockPath: [{ sectionKey: 'summary', blockId: 'draft-component' }],
        activeEditorBlockSnapshot: {
          sectionKey: 'summary',
          blockId: 'draft-component',
          block: { text: 'In-progress component', schema: { id: 'draft-component', component: 'text' } },
        },
        activeEditorBlockSnapshots: [],
        activeEditorNewBlockIds: ['draft-component'],
      },
    });
    mainMocks.documentSessions.set(source.workingVersionId, {
      source,
      versionId: source.workingVersionId,
      dirty: false,
      isNew: false,
      readOnly: false,
      recoveryState,
    });

    await selectDocumentTab(source.workingVersionId);

    expect(backendMocks.readDocumentFile).not.toHaveBeenCalled();
    expect(mainMocks.openDocument).toHaveBeenCalledWith({
      path: source.path,
      name: source.name,
      extension: source.extension,
      bytes: [],
      recoveryState,
    }, {
      source,
      versionId: source.workingVersionId,
    });
    expect(mainMocks.refreshRecents).toHaveBeenCalledOnce();
  });

  it('reopens an in-memory history tab without reading the synthetic path', async () => {
    const source = {
      documentId: 'history-document',
      workingVersionId: 'history-version',
      path: 'version-history:%2Fworkspace%2FExample.hvy:saved-version',
      name: 'Example.hvy — saved version',
      extension: '.hvy' as const,
    };
    mainMocks.documentSessions.set(source.workingVersionId, {
      source,
      versionId: source.workingVersionId,
      dirty: false,
      isNew: false,
      readOnly: false,
      virtual: 'versionHistory',
      recoveryState: null,
    });

    await selectDocumentTab(source.workingVersionId);

    expect(backendMocks.readDocumentFile).not.toHaveBeenCalled();
    expect(mainMocks.openDocument).toHaveBeenCalledWith({
      path: source.path,
      name: source.name,
      extension: source.extension,
      bytes: [],
      recoveryState: null,
    }, {
      source,
      versionId: source.workingVersionId,
    });
  });

  it('clears a surfaced error when the active tab is selected again', async () => {
    state.error = 'Only supported documents can be opened';
    state.document = { versionId: 'version:example' } as never;

    await selectDocumentTab('version:example');

    expect(state.error).toBeNull();
    expect(mainMocks.rerender).toHaveBeenCalledWith({ preserveMountedDocument: true });
  });
});

describe('openSavedVersionPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.busy = false;
    state.error = null;
    state.versionHistorySidebarOpen = false;
    state.versionHistorySourcePath = null;
    state.versionHistorySourceName = null;
    state.savedDocumentVersions = [{
      id: 'saved-version',
      documentPath: '/workspace/Example.hvy',
      createdAt: '2026-09-02T12:00:00.000Z',
      heads: ['saved-version'],
      userId: 'user',
      displayName: 'User',
    }];
    state.document = {
      documentId: 'document:example',
      versionId: 'working-version',
      source: {
        documentId: 'document:example',
        workingVersionId: 'working-version',
        path: '/workspace/Example.hvy',
        name: 'Example.hvy',
        extension: '.hvy',
      },
      mode: 'ai',
      dirty: false,
      readOnly: false,
      hiddenFromAI: false,
      isNew: false,
      metaOpen: false,
      mounted: null,
      recoveryBackupId: null,
      recoveryModified: false,
    };
  });

  it('opens version history in the sidebar instead of a modal', async () => {
    const versions = state.savedDocumentVersions;
    historyMocks.listSavedDocumentVersions.mockResolvedValueOnce(versions);

    await openVersionHistory();

    expect(historyMocks.listSavedDocumentVersions).toHaveBeenCalledWith('/workspace/Example.hvy');
    expect(state.versionHistorySidebarOpen).toBe(true);
    expect(state.versionHistorySourcePath).toBe('/workspace/Example.hvy');
    expect(state.versionHistorySourceName).toBe('Example.hvy');
    expect(state.selectedSavedVersionId).toBeNull();
  });

  it('opens a saved version with the source AI policy and preserves history scroll position', async () => {
    state.versionHistorySourcePath = '/workspace/Example.hvy';
    state.versionHistorySourceName = 'Example.hvy';
    state.document!.virtual = 'versionHistory';
    state.document!.historyVersionId = 'older-version';
    const previousDocument = state.document!;
    mainMocks.openDocument.mockImplementationOnce(async () => {
      state.document = {
        ...previousDocument,
        versionId: 'new-history-version',
        historyVersionId: 'saved-version',
      };
    });

    await openSavedVersionPreview('saved-version');

    expect(historyMocks.materializeSavedDocumentVersion).toHaveBeenCalledWith('/workspace/Example.hvy', 'saved-version');
    expect(mainMocks.openDocument).toHaveBeenCalledWith(expect.objectContaining({
      path: 'version-history:%2Fworkspace%2FExample.hvy:saved-version',
      extension: '.hvy',
      bytes: new Uint8Array([7, 8, 9]),
      hiddenFromAI: false,
    }), {
      hiddenFromAI: false,
      initialMode: 'ai',
      historyPreview: {
        sourcePath: '/workspace/Example.hvy',
        sourceName: 'Example.hvy',
        versionId: 'saved-version',
      },
    });
    const [file, options] = mainMocks.openDocument.mock.calls[0];
    expect(file).not.toHaveProperty('locked');
    expect(options).not.toHaveProperty('readOnly');
    expect(options).not.toHaveProperty('source');
    expect(mainMocks.captureMountScrollRatio).toHaveBeenCalledWith(null);
    expect(mainMocks.restoreMountScrollRatio).toHaveBeenCalledWith(null, {
      top: 0.4,
      left: 0,
      topPosition: 240,
      leftPosition: 0,
    });
    expect(mainMocks.removeDocumentTabPath).toHaveBeenCalledWith('working-version');
    expect(mainMocks.renderAllAroundDocument).toHaveBeenCalledOnce();
  });
});
