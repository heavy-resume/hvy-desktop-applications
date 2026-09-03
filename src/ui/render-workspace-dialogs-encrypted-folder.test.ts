import { describe, expect, it, vi } from 'vitest';
vi.mock('../fileActions', () => ({ currentDocumentWorkspacePath: () => null }));
vi.mock('../mainUtilities', () => ({ savedVersionDocumentName: () => '' }));
vi.mock('../state', () => ({ workspacePathForFileInWorkspaces: () => null }));
vi.mock('../templates', () => ({ workspaceTemplateVisibility: () => ({}) }));
import type { AppState } from '../state';
import { renderNewFolderDialog, renderRenameEncryptedFolderDialog } from './render-workspace-dialogs';
import { renderNode } from './render-workspaces';

function folderDialogState(encrypted: boolean): AppState {
  return {
    newFolderWorkspacePath: '/workspace',
    newFolderParentDirectory: '',
    newFolderEncrypted: encrypted,
    workspaces: [{
      path: '/workspace',
      manifest: { name: 'Plans' },
      files: [],
    }],
    busy: false,
  } as unknown as AppState;
}

describe('encrypted folder creation dialog', () => {
  it('makes encryption explicit and submits the encrypted creation mode', () => {
    const html = renderNewFolderDialog(folderDialogState(true));

    expect(html).toContain('<h2>New Encrypted Folder</h2>');
    expect(html).toContain('name="encrypted" type="hidden" value="true"');
    expect(html).toContain('stored on disk under an opaque ID');
  });

  it('keeps ordinary folder creation unchanged', () => {
    const html = renderNewFolderDialog(folderDialogState(false));

    expect(html).toContain('<h2>New Folder</h2>');
    expect(html).toContain('name="encrypted" type="hidden" value="false"');
    expect(html).not.toContain('stored on disk under an opaque ID');
  });
});

describe('encrypted folder rename dialog', () => {
  it('explains that logical rename leaves the opaque directory stable', () => {
    const html = renderRenameEncryptedFolderDialog({
      renameEncryptedFolderWorkspacePath: '/workspace',
      renameEncryptedFolderDirectory: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      renameEncryptedFolderCurrentName: 'Private Plans',
      busy: false,
    } as unknown as AppState);

    expect(html).toContain('Rename Encrypted Folder');
    expect(html).toContain('opaque filesystem directory name remains the same');
    expect(html).toContain('data-form="rename-encrypted-folder"');
  });
});

describe('encrypted folder workspace actions', () => {
  it('allows folder actions without making the folder a drop target', () => {
    const html = renderNode({
      kind: 'folder',
      name: 'Private Plans',
      path: '/workspace/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      relativePath: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      children: [],
      encryptionState: 'unlocked',
      encryptedFolderKeyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    }, null, null, null, '/workspace', {}, null, null);

    expect(html).toContain('data-workspace-folder-action-target="true"');
    expect(html).toContain('data-workspace-folder-target="false"');
  });

  it('keeps encrypted documents selectable but disables physical drag mutations', () => {
    const html = renderNode({
      kind: 'file',
      name: 'Roadmap.hvy',
      path: '/workspace/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc.hvy',
      relativePath: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc.hvy',
      extension: '.hvy',
      encryptedFolderKeyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    }, null, null, null, '/workspace', {}, null, null);

    expect(html).toContain('data-action="select-file"');
    expect(html).toContain('data-encrypted-folder-document="true"');
    expect(html).toContain('draggable="false"');
  });
});
