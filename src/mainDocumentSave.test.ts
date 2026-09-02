import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  documentSessions: new Map(),
  markDocumentTabOpened: vi.fn(),
  openDocument: vi.fn(async () => undefined),
  refreshRecents: vi.fn(async () => undefined),
  removeDocumentTabPath: vi.fn(),
  rerender: vi.fn(),
  renderAllAroundDocument: vi.fn(),
  updateCurrentDocumentSession: vi.fn(),
  updateDirtyChrome: vi.fn(),
  workspaceFilterDocumentCache: new Map(),
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
  recordSuccessfulDocumentSave: vi.fn(),
}));

import { saveCurrentDocument, selectDocumentTab } from './mainDocumentSave';
import { state } from './state';

describe('saveCurrentDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mainMocks.documentSessions.clear();
    state.busy = false;
    state.error = null;
    state.document = null;
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

  it('clears a surfaced error when the active tab is selected again', async () => {
    state.error = 'Only supported documents can be opened';
    state.document = { versionId: 'version:example' } as never;

    await selectDocumentTab('version:example');

    expect(state.error).toBeNull();
    expect(mainMocks.rerender).toHaveBeenCalledWith({ preserveMountedDocument: true });
  });
});
