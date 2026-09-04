import { describe, expect, it } from 'vitest';
import type { AppState } from './state';
import { getFileActionAvailability } from './fileActions';

function encryptedDocumentState(encryptedFolderDocument: boolean, dirty = false): AppState {
  const path = encryptedFolderDocument
    ? '/workspace/hvy-encrypted-folder-22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.hvy'
    : '/workspace/Notes.hvy';
  return {
    document: {
      source: { path, name: 'Notes.hvy', extension: '.hvy' },
      mode: 'editor',
      readOnly: false,
      dirty,
      mounted: { document: { encryption: { encrypted: true, keyId: '11111111-1111-4111-8111-111111111111' } } },
    },
    workspaces: [{
      path: '/workspace',
      files: [{
        kind: 'file',
        name: 'Notes.hvy',
        path,
        relativePath: encryptedFolderDocument
          ? 'hvy-encrypted-folder-22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.hvy'
          : 'Notes.hvy',
        extension: '.hvy',
        ...(encryptedFolderDocument ? { encryptedFolderKeyId: '11111111-1111-4111-8111-111111111111' } : {}),
      }],
    }],
  } as unknown as AppState;
}

describe('document encryption file actions', () => {
  it('does not offer permanent decryption while the document belongs to an encrypted folder', () => {
    expect(getFileActionAvailability(encryptedDocumentState(true)).decryptDocument).toBe(false);
  });

  it('offers permanent decryption after the encrypted document is copied out of the folder', () => {
    expect(getFileActionAvailability(encryptedDocumentState(false)).decryptDocument).toBe(true);
  });

  it('disables permanent decryption and explains that the encrypted document has unsaved changes', () => {
    expect(getFileActionAvailability(encryptedDocumentState(false, true))).toMatchObject({
      decryptDocument: false,
      documentEncryptionUnsavedChanges: true,
    });
  });

  it('disables encryption and explains that the plaintext document has unsaved changes', () => {
    const state = encryptedDocumentState(false, true);
    state.document!.mounted!.document.encryption = undefined;

    expect(getFileActionAvailability(state)).toMatchObject({
      encryptDocument: false,
      documentEncryptionUnsavedChanges: true,
    });
  });
});
