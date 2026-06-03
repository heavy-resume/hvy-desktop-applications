import { describe, expect, it } from 'vitest';
import type { Workspace } from './backend';
import { workspaceFileAccessInWorkspaces, workspacePathForFileInWorkspaces } from './state';

describe('workspacePathForFileInWorkspaces', () => {
  it('matches files from the loaded workspace tree instead of path prefixes', () => {
    const work: Workspace = {
      path: '/tmp/work',
      manifest: {
        schemaVersion: 1,
        name: 'Work',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      files: [],
    };
    const workshop: Workspace = {
      path: '/tmp/workshop',
      manifest: {
        schemaVersion: 1,
        name: 'Workshop',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      files: [{
        kind: 'file',
        name: 'notes.hvy',
        path: '/tmp/workshop/notes.hvy',
        relativePath: 'notes.hvy',
        extension: '.hvy',
        archived: false,
        locked: false,
        hiddenFromAI: false,
      }],
    };

    expect(workspacePathForFileInWorkspaces([work, workshop], '/tmp/workshop/notes.hvy')).toBe('/tmp/workshop');
  });
});

describe('workspaceFileAccessInWorkspaces', () => {
  it('treats archived files as read-only like locked files', () => {
    const workspace: Workspace = {
      path: '/tmp/work',
      manifest: {
        schemaVersion: 1,
        name: 'Work',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      files: [
        {
          kind: 'file',
          name: 'archived.hvy',
          path: '/tmp/work/archived.hvy',
          relativePath: 'archived.hvy',
          extension: '.hvy',
          archived: true,
          locked: false,
          hiddenFromAI: false,
        },
        {
          kind: 'file',
          name: 'locked.hvy',
          path: '/tmp/work/locked.hvy',
          relativePath: 'locked.hvy',
          extension: '.hvy',
          archived: false,
          locked: true,
          hiddenFromAI: false,
        },
      ],
    };

    expect(workspaceFileAccessInWorkspaces([workspace], '/tmp/work/archived.hvy')).toMatchObject({
      archived: true,
      locked: false,
      readOnly: true,
    });
    expect(workspaceFileAccessInWorkspaces([workspace], '/tmp/work/locked.hvy')).toMatchObject({
      archived: false,
      locked: true,
      readOnly: true,
    });
  });
});
