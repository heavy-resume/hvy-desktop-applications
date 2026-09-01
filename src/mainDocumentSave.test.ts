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
  saveDocumentFile: vi.fn(async () => undefined),
}));

const mainMocks = vi.hoisted(() => ({
  documentSessions: new Map(),
  markDocumentTabOpened: vi.fn(),
  refreshRecents: vi.fn(async () => undefined),
  removeDocumentTabPath: vi.fn(),
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

import { saveCurrentDocument } from './mainDocumentSave';
import { state } from './state';

describe('saveCurrentDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mainMocks.documentSessions.clear();
    state.busy = false;
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
});
