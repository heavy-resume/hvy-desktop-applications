import { beforeEach, describe, expect, it, vi } from 'vitest';

const backendMocks = vi.hoisted(() => ({
  readDocumentFileBytes: vi.fn(),
}));

vi.mock('./backend', async (importOriginal) => ({
  ...await importOriginal<typeof import('./backend')>(),
  readDocumentFileBytes: backendMocks.readDocumentFileBytes,
}));

import type { Workspace } from './backend';
import { workspaceDocumentKeyUsage } from './documentKeyUsage';

const DOCUMENT_KEY_ID = '11111111-1111-4111-8111-111111111111';
const COMPONENT_KEY_ID = '22222222-2222-4222-8222-222222222222';
const FOLDER_KEY_ID = '33333333-3333-4333-8333-333333333333';

function bytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

describe('workspaceDocumentKeyUsage', () => {
  beforeEach(() => backendMocks.readDocumentFileBytes.mockReset());

  it('reports workspace document names for whole-document and component keys', async () => {
    const workspace = {
      path: '/work/planning',
      manifest: {
        schemaVersion: 1,
        name: 'Planning',
        createdAt: '2026-09-03T00:00:00.000Z',
        updatedAt: '2026-09-03T00:00:00.000Z',
      },
      files: [
        {
          kind: 'file',
          name: 'Roadmap.hvy',
          path: '/work/planning/Roadmap.hvy',
          relativePath: 'Roadmap.hvy',
          extension: '.hvy',
        },
        {
          kind: 'folder',
          name: 'Notes',
          path: '/work/planning/Notes',
          relativePath: 'hvy-encrypted-folder-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          encryptedFolderKeyId: FOLDER_KEY_ID,
          children: [{
            kind: 'folder',
            name: 'inner folder',
            path: '/work/planning/Notes/inner-folder',
            relativePath: 'hvy-encrypted-folder-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            encryptedFolderKeyId: FOLDER_KEY_ID,
            children: [{
              kind: 'file',
              name: 'Private.hvy',
              path: '/work/planning/Notes/inner-folder/Private.hvy',
              relativePath: 'hvy-encrypted-folder-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              extension: '.hvy',
              encryptedFolderKeyId: FOLDER_KEY_ID,
            }],
          }],
        },
      ],
    } satisfies Workspace;
    backendMocks.readDocumentFileBytes
      .mockResolvedValueOnce(new Uint8Array(bytes(`---HVY-ENCRYPTED---\n{"keyId":"${DOCUMENT_KEY_ID}"}\n---HVY-ENCRYPTED-PAYLOAD---\npayload`)))
      .mockResolvedValueOnce(new Uint8Array(bytes(`Notes\n<!--hvy:encrypted {"keyId":"${FOLDER_KEY_ID}"}-->\n<!--hvy:encrypted {"keyId":"${COMPONENT_KEY_ID}"}-->`)));

    await expect(workspaceDocumentKeyUsage([workspace])).resolves.toEqual({
      [DOCUMENT_KEY_ID]: { documents: ['Planning / Roadmap.hvy'], folders: [] },
      [COMPONENT_KEY_ID]: { documents: ['Planning / Notes / inner folder / Private.hvy'], folders: [] },
      [FOLDER_KEY_ID]: { documents: [], folders: ['Planning / Notes'] },
    });
    expect(backendMocks.readDocumentFileBytes).toHaveBeenCalledTimes(2);
  });
});
