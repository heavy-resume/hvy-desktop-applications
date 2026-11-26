import { describe, expect, it } from 'vitest';
import type { WorkspaceTreeNode } from './backend';
import { loadWorkspaceExpansionState, loadWorkspaceFolderExpansionState, prunedFolderExpansion, relocatedFolderExpansion, saveWorkspaceExpansionState, saveWorkspaceFolderExpansionState } from './workspaceExpansionState';

describe('workspace expansion state', () => {
  it('persists expansion by workspace path', () => {
    saveWorkspaceExpansionState({ '/Work/Alpha': false, '/Work/Beta': true });

    expect(loadWorkspaceExpansionState()).toEqual({
      '/Work/Alpha': false,
      '/Work/Beta': true,
    });
  });

  it('ignores stored values that are not expansion booleans', () => {
    localStorage.setItem('hvy-galaxy:workspace-expansion', JSON.stringify({
      '/Work/Alpha': false,
      '/Work/Beta': 'false',
      '/Work/Gamma': null,
    }));

    expect(loadWorkspaceExpansionState()).toEqual({ '/Work/Alpha': false });
  });

  it('persists folder expansion by workspace and folder path', () => {
    saveWorkspaceFolderExpansionState({ '/Work/Alpha': { notes: false, 'notes/drafts': true } });

    expect(loadWorkspaceFolderExpansionState()).toEqual({
      '/Work/Alpha': { notes: false, 'notes/drafts': true },
    });
  });

  it('drops folder entries that no longer exist in the workspace tree', () => {
    const folder = (relativePath: string, children: WorkspaceTreeNode[] = [], encryptionState?: 'locked' | 'unlocked'): WorkspaceTreeNode => ({
      kind: 'folder', name: relativePath.split('/').at(-1) ?? '', path: `/Work/Alpha/${relativePath}`, relativePath, children, encryptionState,
    });
    const files = [folder('notes', [folder('notes/drafts')]), folder('vault', [], 'locked')];

    expect(prunedFolderExpansion({
      notes: false,
      'notes/drafts': false,
      'notes/deleted': false,
      renamed: false,
      'vault/inner': false,
    }, files)).toEqual({
      notes: false,
      'notes/drafts': false,
      'vault/inner': false,
    });
  });

  it('moves a renamed folder and its subfolders to the new path', () => {
    expect(relocatedFolderExpansion({ notes: false, 'notes/drafts': true, notesy: false }, 'notes', 'journal')).toEqual({
      journal: false,
      'journal/drafts': true,
      notesy: false,
    });
  });
});
