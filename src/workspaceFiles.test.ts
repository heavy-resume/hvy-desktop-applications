import { describe, expect, it } from 'vitest';
import type { Workspace } from './backend';
import { filePathBelongsToWorkspace, workspaceRelativeFilePath } from './workspaceFiles';

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
});
