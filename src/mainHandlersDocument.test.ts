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
  rerender: vi.fn(),
  restoreMountScrollRatio: vi.fn(),
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

describe('document editor mode switching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
