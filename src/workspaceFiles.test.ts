import { describe, expect, it } from 'vitest';
import type { DocumentFile, Workspace } from './backend';
import { documentFileWithWorkspaceName, filePathBelongsToWorkspace, workspaceRelativeFilePath } from './workspaceFiles';

describe('workspace homepage paths', () => {
  it('displays the workspace-relative path for a loaded file', () => {
    const workspace: Workspace = {
      path: '/tmp/work',
      manifest: {
        schemaVersion: 1,
        name: 'Work',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      files: [{
        kind: 'file',
        name: 'home.hvy',
        path: '/tmp/work/reference/home.hvy',
        relativePath: 'reference/home.hvy',
        extension: '.hvy',
      }],
    };

    expect(workspaceRelativeFilePath([workspace], [workspace.path], '/tmp/work/reference/home.hvy'))
      .toBe('reference/home.hvy');
  });

  it('derives a relative path when a known workspace is temporarily unavailable', () => {
    expect(workspaceRelativeFilePath([], ['/Volumes/team'], '/Volumes/team/reference/home.hvy'))
      .toBe('reference/home.hvy');
  });

  it('distinguishes files inside and outside a workspace root', () => {
    expect(filePathBelongsToWorkspace('/tmp/work/home.hvy', '/tmp/work')).toBe(true);
    expect(filePathBelongsToWorkspace('/tmp/workshop/home.hvy', '/tmp/work')).toBe(false);
  });

  it('uses the decrypted workspace name for an encrypted physical document', () => {
    const path = '/tmp/work/hvy-encrypted-folder-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.hvy';
    const physicalFile: DocumentFile = {
      path,
      name: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.hvy',
      extension: '.hvy',
      bytes: [1, 2, 3],
    };
    const workspace: Workspace = {
      path: '/tmp/work',
      manifest: {
        schemaVersion: 1,
        name: 'Work',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      files: [{
        kind: 'folder',
        name: 'Private',
        path: '/tmp/work/hvy-encrypted-folder-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        relativePath: 'hvy-encrypted-folder-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        encryptionState: 'unlocked',
        children: [{
          kind: 'file',
          name: 'Planning notes.hvy',
          path,
          relativePath: 'hvy-encrypted-folder-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.hvy',
          extension: '.hvy',
          encryptedFolderKeyId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        }],
      }],
    };

    expect(documentFileWithWorkspaceName(physicalFile, [workspace])).toMatchObject({
      path,
      name: 'Planning notes.hvy',
      extension: '.hvy',
      bytes: [1, 2, 3],
    });
  });
});
