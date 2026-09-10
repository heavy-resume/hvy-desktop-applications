import { describe, expect, it } from 'vitest';
import type { AppState } from './state';
import { getFileActionAvailability, isHomepageOpen } from './fileActions';

function encryptedDocumentState(encryptedFolderDocument: boolean, dirty = false): AppState {
  const path = encryptedFolderDocument
    ? '/workspace/hvy-encrypted-folder-22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.hvy'
    : '/workspace/Notes.hvy';
  return {
    appSettings: { homepage: { kind: 'included', id: 'hvy-galaxy-guide' } },
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

describe('homepage file action', () => {
  it('is available for a configured included homepage', () => {
    expect(getFileActionAvailability(encryptedDocumentState(false)).openHomepage).toBe(true);
  });

  it('is available when a homepage is configured', () => {
    const state = encryptedDocumentState(false);
    state.appSettings = { homepage: { kind: 'file', path: '/workspace/Home.hvy' } } as AppState['appSettings'];

    expect(getFileActionAvailability(state).openHomepage).toBe(true);
  });

  it('is unavailable when the homepage is disabled', () => {
    const state = encryptedDocumentState(false);
    state.appSettings = { homepage: { kind: 'none' } } as AppState['appSettings'];

    expect(getFileActionAvailability(state).openHomepage).toBe(false);
  });
});

describe('open homepage identity', () => {
  it('recognizes the active configured file', () => {
    const state = encryptedDocumentState(false);
    state.appSettings = { homepage: { kind: 'file', path: state.document!.source.path } } as AppState['appSettings'];

    expect(isHomepageOpen(state)).toBe(true);
  });

  it('recognizes an active included homepage by its stable id', () => {
    const state = encryptedDocumentState(false);
    state.document!.includedDocumentId = 'hvy-galaxy-guide';

    expect(isHomepageOpen(state)).toBe(true);
  });

  it('does not treat a virtual view of the configured file as the homepage', () => {
    const state = encryptedDocumentState(false);
    state.appSettings = { homepage: { kind: 'file', path: state.document!.source.path } } as AppState['appSettings'];
    state.document!.virtual = 'versionHistory';

    expect(isHomepageOpen(state)).toBe(false);
  });
});
