import { describe, expect, it, vi } from 'vitest';

const backendMocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  reauthorizeWorkspace: vi.fn(),
  updateMcpWorkspaces: vi.fn(() => Promise.resolve()),
}));
const debugLogMocks = vi.hoisted(() => ({ logDebugEvent: vi.fn() }));

vi.mock('./backend', async (importOriginal) => ({
  ...await importOriginal<typeof import('./backend')>(),
  loadWorkspace: backendMocks.loadWorkspace,
  reauthorizeWorkspace: backendMocks.reauthorizeWorkspace,
  updateMcpWorkspaces: backendMocks.updateMcpWorkspaces,
}));

vi.mock('./debugLog', () => debugLogMocks);

vi.mock('./main', () => ({
  adoptSavedAsDocument: vi.fn(),
  backupDocumentKey: vi.fn(),
  clearRecoveryDraftsForDocument: vi.fn(),
  documentSessions: new Map(),
  moveBackupTracking: vi.fn(),
  openDocument: vi.fn(),
  pendingMountDocument: null,
  readDocumentColorPreference: vi.fn(),
  refreshRecents: vi.fn(),
  renameDocumentTabPath: vi.fn(),
  rerender: vi.fn(),
  runBusy: vi.fn(),
  updateCurrentDocumentSession: vi.fn(),
}));

import { creationTemplate, loadWorkspaceEntry, reorderedWorkspaceEntries, retryWorkspaceEntry, workspaceDisplayNameFromPath } from './mainWorkspaceUtils';
import { state } from './state';

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

describe('workspace ordering', () => {
  const entries = ['one', 'two', 'three'].map((path) => ({ path, displayName: path, status: 'ready' as const, error: null }));

  it('moves an entry before a target', () => {
    expect(reorderedWorkspaceEntries(entries, 'three', 'one', true).map((entry) => entry.path)).toEqual(['three', 'one', 'two']);
  });

  it('moves an entry after a target', () => {
    expect(reorderedWorkspaceEntries(entries, 'one', 'two', false).map((entry) => entry.path)).toEqual(['two', 'one', 'three']);
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
