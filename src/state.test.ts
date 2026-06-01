import { describe, expect, it } from 'vitest';
import type { Workspace } from './backend';
import { workspacePathForFileInWorkspaces } from './state';

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
