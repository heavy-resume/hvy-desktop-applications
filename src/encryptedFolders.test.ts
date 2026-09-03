import { describe, expect, it } from 'vitest';
import {
  decryptFolderManifest,
  encryptFolderManifest,
  normalizeFolderManifest,
  parseFolderEnvelope,
  prepareEncryptedFolderChildMutation,
  prepareEncryptedFolderEntryRename,
  prepareEncryptedFolderEntryRemoval,
  prepareEncryptedFolderImportedDocumentMutation,
  prepareEncryptedFolderSelfRename,
  prepareEncryptedFolderDocumentMutation,
  resolveEncryptedWorkspace,
  type EncryptedFolderManifest,
} from './encryptedFolders';
import type { Workspace } from './backend';
import { decryptDocumentEnvelopeBytes, encryptDocumentBytes } from '../../heavy-file-format/src/encryption';

const KEY_ID = '11111111-1111-4111-8111-111111111111';
const FOLDER_ID = '22222222-2222-4222-8222-222222222222';
const DOCUMENT_ID = '33333333-3333-4333-8333-333333333333';
const CHILD_ID = '44444444-4444-4444-8444-444444444444';
const KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const OTHER_KEY = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE';

const manifest: EncryptedFolderManifest = {
  version: 1,
  folderId: FOLDER_ID,
  name: 'Confidential planning',
  entries: {
    [DOCUMENT_ID]: { name: 'Roadmap.hvy', kind: 'document', documentExtension: '.hvy' },
    [CHILD_ID]: { name: 'Planning', kind: 'folder' },
  },
};

describe('encrypted folder manifests', () => {
  it('round-trips logical names without exposing them in the envelope', async () => {
    const bytes = await encryptFolderManifest(manifest, KEY_ID, KEY);
    const secondBytes = await encryptFolderManifest(manifest, KEY_ID, KEY);
    const text = new TextDecoder().decode(bytes);

    expect(text).not.toContain('Roadmap');
    expect(text).not.toContain('Planning');
    expect(secondBytes).not.toEqual(bytes);
    expect(parseFolderEnvelope(bytes)).toMatchObject({ keyId: KEY_ID, folderId: FOLDER_ID });
    expect(await decryptFolderManifest(bytes, KEY)).toEqual(manifest);
  });

  it('rejects the wrong key and authenticated-envelope tampering', async () => {
    const bytes = await encryptFolderManifest(manifest, KEY_ID, KEY);
    await expect(decryptFolderManifest(bytes, OTHER_KEY)).rejects.toThrow('authenticate');

    const envelope = JSON.parse(new TextDecoder().decode(bytes));
    envelope.folderId = '55555555-5555-4555-8555-555555555555';
    await expect(decryptFolderManifest(new TextEncoder().encode(JSON.stringify(envelope)), KEY)).rejects.toThrow('authenticate');

    const ciphertextEnvelope = JSON.parse(new TextDecoder().decode(bytes));
    ciphertextEnvelope.ciphertext = `${ciphertextEnvelope.ciphertext[0] === 'A' ? 'B' : 'A'}${ciphertextEnvelope.ciphertext.slice(1)}`;
    await expect(decryptFolderManifest(new TextEncoder().encode(JSON.stringify(ciphertextEnvelope)), KEY)).rejects.toThrow('authenticate');
  });

  it('rejects path-like and case-insensitively duplicated logical names', () => {
    expect(() => normalizeFolderManifest({
      ...manifest,
      entries: { [DOCUMENT_ID]: { name: '../Roadmap', kind: 'document', documentExtension: '.hvy' } },
    })).toThrow('single path components');
    expect(() => normalizeFolderManifest({
      ...manifest,
      entries: {
        [DOCUMENT_ID]: { name: 'Roadmap', kind: 'document', documentExtension: '.hvy' },
        [CHILD_ID]: { name: 'roadmap', kind: 'folder' },
      },
    })).toThrow('duplicate logical name');
  });

  it('rejects unsupported document types and invalid entry IDs', () => {
    expect(() => normalizeFolderManifest({
      ...manifest,
      entries: { bad: { name: 'Notes', kind: 'document', documentExtension: '.md' } },
    })).toThrow('entry ID');
    expect(() => normalizeFolderManifest({
      ...manifest,
      entries: { [DOCUMENT_ID]: { name: 'Notes', kind: 'document', documentExtension: '.md' } },
    })).toThrow('unsupported extension');
  });
});

describe('encrypted workspace discovery', () => {
  it('prepares an opaque encrypted document and authenticated manifest update', async () => {
    const emptyManifest = { ...manifest, entries: {} };
    const encryptedFolderManifest = Array.from(await encryptFolderManifest(emptyManifest, KEY_ID, KEY));
    const resolved = await resolveEncryptedWorkspace(physicalWorkspace(encryptedFolderManifest, []), async () => ({ [KEY_ID]: KEY }));
    const folder = resolved.files[0];
    if (!folder || folder.kind !== 'folder') throw new Error('Expected encrypted folder.');
    const plaintext = new TextEncoder().encode('---\nhvy_version: 0.1\ntitle: New plan\n---\n');

    const mutation = await prepareEncryptedFolderDocumentMutation(folder, 'New plan.hvy', '.hvy', plaintext, { [KEY_ID]: KEY });

    expect(new TextDecoder().decode(mutation.documentBytes)).not.toContain('New plan');
    expect((await decryptDocumentEnvelopeBytes(mutation.documentBytes, { keyId: KEY_ID, key: KEY })).bytes).toEqual(plaintext);
    expect(await decryptFolderManifest(mutation.manifestBytes, KEY)).toMatchObject({
      entries: {
        [mutation.documentId]: { name: 'New plan.hvy', kind: 'document', documentExtension: '.hvy' },
      },
    });
    expect(mutation.previousManifestBytes).toEqual(Uint8Array.from(encryptedFolderManifest));
  });

  it('rewraps an imported encrypted document with the folder key', async () => {
    const encryptedFolderManifest = Array.from(await encryptFolderManifest({ ...manifest, entries: {} }, KEY_ID, KEY));
    const resolved = await resolveEncryptedWorkspace(physicalWorkspace(encryptedFolderManifest, []), async () => ({ [KEY_ID]: KEY }));
    const folder = resolved.files[0];
    if (!folder || folder.kind !== 'folder') throw new Error('Expected encrypted folder.');
    const plaintext = new TextEncoder().encode('---\nhvy_version: 0.1\ntitle: Imported\n---\n');
    const sourceKeyId = '55555555-5555-4555-8555-555555555555';
    const source = await encryptDocumentBytes(plaintext, { keyId: sourceKeyId, key: OTHER_KEY });

    const mutation = await prepareEncryptedFolderImportedDocumentMutation(
      folder,
      'Imported.hvy',
      '.hvy',
      source.bytes,
      { [KEY_ID]: KEY, [sourceKeyId]: OTHER_KEY },
    );

    const imported = await decryptDocumentEnvelopeBytes(mutation.documentBytes, { keyId: KEY_ID, key: KEY });
    expect(imported.keyId).toBe(KEY_ID);
    expect(imported.bytes).toEqual(plaintext);
    expect(new TextDecoder().decode(mutation.documentBytes)).not.toContain(sourceKeyId);
  });

  it('prepares a nested folder with the parent key and no plaintext names', async () => {
    const encryptedFolderManifest = Array.from(await encryptFolderManifest({ ...manifest, entries: {} }, KEY_ID, KEY));
    const resolved = await resolveEncryptedWorkspace(physicalWorkspace(encryptedFolderManifest, []), async () => ({ [KEY_ID]: KEY }));
    const folder = resolved.files[0];
    if (!folder || folder.kind !== 'folder') throw new Error('Expected encrypted folder.');

    const mutation = await prepareEncryptedFolderChildMutation(folder, 'Forecasts', { [KEY_ID]: KEY });

    expect(new TextDecoder().decode(mutation.childManifestBytes)).not.toContain('Forecasts');
    expect(parseFolderEnvelope(mutation.childManifestBytes)).toMatchObject({ keyId: KEY_ID, folderId: mutation.childFolderId });
    expect(await decryptFolderManifest(mutation.childManifestBytes, KEY)).toMatchObject({ name: 'Forecasts', entries: {} });
    expect(await decryptFolderManifest(mutation.manifestBytes, KEY)).toMatchObject({
      entries: { [mutation.childFolderId]: { name: 'Forecasts', kind: 'folder' } },
    });
  });

  it('rejects a nested folder logical-name collision before preparing filesystem bytes', async () => {
    const encryptedFolderManifest = Array.from(await encryptFolderManifest(manifest, KEY_ID, KEY));
    const folder = {
      ...physicalWorkspace(encryptedFolderManifest, []).files[0],
      encryptedFolderKeyId: KEY_ID,
      encryptionState: 'unlocked' as const,
    };
    if (folder.kind !== 'folder') throw new Error('Expected encrypted folder.');

    await expect(prepareEncryptedFolderChildMutation(folder, 'roadmap.HVY', { [KEY_ID]: KEY })).rejects.toThrow('duplicate logical name');
  });

  it('renames a logical entry without changing its opaque identity', async () => {
    const encryptedFolderManifest = Array.from(await encryptFolderManifest(manifest, KEY_ID, KEY));
    const folder = {
      ...physicalWorkspace(encryptedFolderManifest, []).files[0],
      encryptedFolderKeyId: KEY_ID,
      encryptionState: 'unlocked' as const,
    };
    if (folder.kind !== 'folder') throw new Error('Expected encrypted folder.');

    const mutation = await prepareEncryptedFolderEntryRename(folder, DOCUMENT_ID, 'Revised roadmap.hvy', { [KEY_ID]: KEY });
    const renamed = await decryptFolderManifest(mutation.manifestBytes, KEY);

    expect(renamed.entries[DOCUMENT_ID]).toEqual({ name: 'Revised roadmap.hvy', kind: 'document', documentExtension: '.hvy' });
    expect(Object.keys(renamed.entries)).toEqual(expect.arrayContaining([DOCUMENT_ID, CHILD_ID]));
  });

  it('removes one logical entry without exposing or changing its siblings', async () => {
    const encryptedFolderManifest = Array.from(await encryptFolderManifest(manifest, KEY_ID, KEY));
    const folder = {
      ...physicalWorkspace(encryptedFolderManifest, []).files[0],
      encryptedFolderKeyId: KEY_ID,
      encryptionState: 'unlocked' as const,
    };
    if (folder.kind !== 'folder') throw new Error('Expected encrypted folder.');

    const mutation = await prepareEncryptedFolderEntryRemoval(folder, DOCUMENT_ID, { [KEY_ID]: KEY });
    const updated = await decryptFolderManifest(mutation.manifestBytes, KEY);

    expect(updated.entries[DOCUMENT_ID]).toBeUndefined();
    expect(updated.entries[CHILD_ID]).toEqual({ name: 'Planning', kind: 'folder' });
  });

  it('renames a root encrypted folder in its own manifest', async () => {
    const encryptedFolderManifest = Array.from(await encryptFolderManifest(manifest, KEY_ID, KEY));
    const folder = {
      ...physicalWorkspace(encryptedFolderManifest, []).files[0],
      encryptedFolderKeyId: KEY_ID,
      encryptionState: 'unlocked' as const,
    };
    if (folder.kind !== 'folder') throw new Error('Expected encrypted folder.');

    const mutation = await prepareEncryptedFolderSelfRename(folder, 'Renamed plans', { [KEY_ID]: KEY });

    expect(await decryptFolderManifest(mutation.manifestBytes, KEY)).toMatchObject({ folderId: FOLDER_ID, name: 'Renamed plans' });
    expect(parseFolderEnvelope(mutation.manifestBytes).folderId).toBe(FOLDER_ID);
  });

  it('maps opaque physical entries to logical names after loading the exact folder key', async () => {
    const encryptedFolderManifest = Array.from(await encryptFolderManifest(manifest, KEY_ID, KEY));
    const workspace = physicalWorkspace(encryptedFolderManifest, [
      physicalDocument(DOCUMENT_ID),
      physicalFolder(CHILD_ID),
      physicalDocument('55555555-5555-4555-8555-555555555555'),
    ]);
    const requested: string[][] = [];

    const resolved = await resolveEncryptedWorkspace(workspace, async (keyIds) => {
      requested.push(keyIds);
      return { [KEY_ID]: KEY };
    });
    const folder = resolved.files[0];

    expect(requested).toEqual([[KEY_ID]]);
    expect(folder).toMatchObject({ kind: 'folder', name: 'Confidential planning', encryptionState: 'incomplete' });
    if (!folder || folder.kind !== 'folder') throw new Error('Expected encrypted folder.');
    expect(folder.children.map((child) => child.name)).toEqual(['Planning', 'Roadmap.hvy']);
    expect(folder.children.some((child) => child.name.startsWith('55555555'))).toBe(false);
    expect(folder.children.find((child) => child.kind === 'file')).toMatchObject({ encryptedFolderKeyId: KEY_ID });
  });

  it('returns a locked folder without exposing logical names when the key is missing', async () => {
    const encryptedFolderManifest = Array.from(await encryptFolderManifest(manifest, KEY_ID, KEY));
    const resolved = await resolveEncryptedWorkspace(physicalWorkspace(encryptedFolderManifest, [physicalDocument(DOCUMENT_ID)]), async () => ({}));

    expect(resolved.files[0]).toMatchObject({
      kind: 'folder',
      name: `Encrypted folder · ${FOLDER_ID.slice(0, 8)}`,
      encryptionState: 'missingKey',
      encryptedFolderKeyId: KEY_ID,
      children: [],
    });
  });

  it('contains tampered manifests as invalid folders instead of failing the workspace', async () => {
    const encryptedFolderManifest = await encryptFolderManifest(manifest, KEY_ID, KEY);
    encryptedFolderManifest[encryptedFolderManifest.length - 4] ^= 1;
    const resolved = await resolveEncryptedWorkspace(physicalWorkspace(Array.from(encryptedFolderManifest), []), async () => ({ [KEY_ID]: KEY }));

    expect(resolved.files[0]).toMatchObject({ kind: 'folder', encryptionState: 'invalid', children: [] });
  });
});

function physicalWorkspace(encryptedFolderManifest: number[], children: Workspace['files']): Workspace {
  return {
    path: '/workspace',
    manifest: { schemaVersion: 1, name: 'Workspace', createdAt: '', updatedAt: '' },
    files: [{
      kind: 'folder',
      name: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      path: '/workspace/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      relativePath: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      encryptedFolderManifest,
      children,
    }],
  };
}

function physicalDocument(id: string): Workspace['files'][number] {
  return {
    kind: 'file',
    name: `${id}.hvy`,
    path: `/workspace/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/${id}.hvy`,
    relativePath: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/${id}.hvy`,
    extension: '.hvy',
  };
}

function physicalFolder(id: string): Workspace['files'][number] {
  return {
    kind: 'folder',
    name: id,
    path: `/workspace/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/${id}`,
    relativePath: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/${id}`,
    children: [],
  };
}
