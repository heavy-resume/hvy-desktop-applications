import { describe, expect, it, vi } from 'vitest';
vi.mock('../fileActions', () => ({ currentDocumentWorkspacePath: () => null }));
vi.mock('../mainUtilities', () => ({ savedVersionDocumentName: () => '' }));
vi.mock('../state', () => ({ workspacePathForFileInWorkspaces: () => null }));
vi.mock('./core', () => ({ MIN_PASTED_IMPORT_CHARS: 250 }));
vi.mock('../templates', () => ({
  workspaceTemplateVisibility: () => ({ hvyDocuments: true, thvyTemplates: true, phvyTemplates: true, archivedFiles: false }),
  mergeSavedTemplates: () => [],
  templatesForDocumentType: () => [{ id: 'blank.thvy', name: 'None', scope: 'bundled', extension: '.thvy' }],
}));
import type { AppState } from '../state';
import { renderEncryptedAIAccessDialog, renderNewFolderDialog, renderRenameEncryptedFolderDialog } from './render-workspace-dialogs';
import { renderNewDocumentDialog } from './render-import';
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
    expect(html).toContain('stored on disk under an app-managed encrypted-folder ID');
  });

  it('keeps ordinary folder creation unchanged', () => {
    const html = renderNewFolderDialog(folderDialogState(false));

    expect(html).toContain('<h2>New Folder</h2>');
    expect(html).toContain('name="encrypted" type="hidden" value="false"');
    expect(html).not.toContain('stored on disk under an app-managed encrypted-folder ID');
  });

  it('shows the decrypted parent name instead of its physical encrypted-folder ID', () => {
    const state = folderDialogState(false);
    state.newFolderParentDirectory = 'hvy-encrypted-folder-22222222-2222-4222-8222-222222222222';
    state.workspaces[0].files = [{
      kind: 'folder',
      name: 'Private Plans',
      path: '/workspace/hvy-encrypted-folder-22222222-2222-4222-8222-222222222222',
      relativePath: state.newFolderParentDirectory,
      children: [],
      encryptionState: 'unlocked',
    }];

    const html = renderNewFolderDialog(state);

    expect(html).toContain('Plans / Private Plans');
    expect(html).not.toContain('Plans / hvy-encrypted-folder-22222222');
  });
});

describe('new document dialog parity', () => {
  it('uses the regular type, destination, name, and template controls for encrypted folders', () => {
    const html = renderNewDocumentDialog({
      newDocumentWorkspacePath: '/workspace',
      newDocumentDirectory: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      newDocumentType: 'hvy',
      savedTemplates: [],
      workspaces: [{
        path: '/workspace',
        manifest: { name: 'Plans' },
        files: [{
          kind: 'folder',
          name: 'Private Plans',
          path: '/workspace/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          relativePath: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          children: [],
          encryptionState: 'unlocked',
          encryptedFolderKeyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        }],
      }],
      busy: false,
    } as unknown as AppState);

    expect(html).toContain('data-document-type="hvy"');
    expect(html).toContain('data-document-type="thvy"');
    expect(html).toContain('data-document-type="phvy"');
    expect(html).toContain('name="targetDirectory"');
    expect(html).toContain('name="documentName"');
    expect(html).toContain('name="templateId"');
    expect(html).toContain('encrypted automatically with the folder key');
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

describe('encrypted AI access warning', () => {
  it('states that decrypted content may leave the encrypted local boundary', () => {
    const html = renderEncryptedAIAccessDialog({
      encryptedAIAccessPrompt: { kind: 'folder', workspacePath: '/workspace', targetDirectory: 'private', path: '', name: 'Private Plans' },
      busy: false,
    } as unknown as AppState);

    expect(html).toContain('Enable AI Access?');
    expect(html).toContain('send its decrypted content');
    expect(html).toContain('security, retention, and privacy policies');
    expect(html).toContain('applies to documents in this folder');
  });
});

describe('encrypted folder workspace actions', () => {
  it('makes a deferred encrypted folder an explicit unlock action', () => {
    const html = renderNode({
      kind: 'folder',
      name: 'Encrypted folder · aaaaaaaa',
      path: '/workspace/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      relativePath: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      children: [],
      encryptionState: 'locked',
      encryptedFolderKeyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    }, null, null, null, '/workspace', {}, null, null);

    expect(html).toContain('data-action="unlock-encrypted-folder"');
    expect(html).toContain('title="Open encrypted folder"');
  });

  it('allows folder actions without making the folder a drop target', () => {
    const html = renderNode({
      kind: 'folder',
      name: 'Private Plans',
      path: '/workspace/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      relativePath: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      children: [],
      encryptionState: 'unlocked',
      encryptedFolderKeyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      hiddenFromAI: true,
    }, null, null, null, '/workspace', {}, null, null);

    expect(html).toContain('data-workspace-folder-action-target="true"');
    expect(html).toContain('data-workspace-folder-target="false"');
    expect(html).toContain('class="tree-folder-actions"');
    expect(html).toMatch(/tree-folder-actions[^>]*>.*tree-folder-encryption.*tree-file-ai-hidden.*<\/span>/s);
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
    expect(html).toContain('class="tree-file-encryption"');
    expect(html).toContain('aria-label="Encrypted by folder">🔒</span>');
  });

  it('shows the lock for a standalone whole-document encrypted file', () => {
    const html = renderNode({
      kind: 'file',
      name: 'Roadmap.hvy',
      path: '/workspace/Roadmap.hvy',
      relativePath: 'Roadmap.hvy',
      extension: '.hvy',
      encrypted: true,
    }, null, null, null, '/workspace', {}, null, null);

    expect(html).toContain('aria-label="Encrypted document">🔒</span>');
    expect(html).toContain('data-encrypted-folder-document="false"');
    expect(html).toContain('draggable="true"');
  });
});
