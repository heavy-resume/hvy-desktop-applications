import { describe, expect, it } from 'vitest';
import type { AppState } from '../state';
import { renderDocumentEncryptionDialog, renderDocumentKeyDeleteDialog, renderDocumentKeyManagerDialog } from './render-encryption';

function encryptionDialogState(action: 'encrypt' | 'decrypt'): AppState {
  return {
    documentEncryptionDialogOpen: true,
    documentEncryptionAction: action,
  } as AppState;
}

describe('document encryption confirmation dialog', () => {
  it('explains key creation before enabling whole-document encryption', () => {
    const html = renderDocumentEncryptionDialog(encryptionDialogState('encrypt'));

    expect(html).toContain('Encrypt this document?');
    expect(html).toContain('generate a new key');
    expect(html).toContain('matching exported key file');
    expect(html).toContain('data-action="confirm-document-encryption"');
  });

  it('explains plaintext and recovery effects before removing encryption', () => {
    const html = renderDocumentEncryptionDialog(encryptionDialogState('decrypt'));

    expect(html).toContain('Remove document encryption?');
    expect(html).toContain('future recovery data');
    expect(html).toContain('individually encrypted components remain encrypted');
    expect(html).toContain('Remove Encryption');
  });
});

describe('document key manager', () => {
  it('lists persisted metadata without embedding secret material', () => {
    const html = renderDocumentKeyManagerDialog({
      documentKeyManagerDialogOpen: true,
      documentKeyMetadata: [{
        keyId: '11111111-1111-4111-8111-111111111111',
        label: 'Planning bundle',
        source: 'imported',
        createdAt: '2026-09-02T12:00:00.000Z',
        bundleLabels: ['Planning bundle'],
      }],
      documentKeyVaultStatus: {
        configured: true,
        hasVault: true,
        storageMode: 'safeStorageVault',
        state: 'ready',
      },
    } as AppState);

    expect(html).toContain('Protected local vault · 1 key');
    expect(html).toContain('Planning bundle');
    expect(html).toContain('11111111-1111-4111-8111-111111111111');
    expect(html).toContain('Imported');
    expect(html).toContain('data-action="export-document-key"');
    expect(html).toContain('Bundles: Planning bundle');
    expect(html).toContain('data-action="request-delete-document-key"');
  });

  it.each([
    ['unavailable', 'Protected operating-system storage is unavailable'],
    ['denied', 'store is locked'],
    ['incomplete', 'vault is incomplete'],
    ['corrupt', 'could not be read or decrypted'],
  ] as const)('shows a distinct %s vault failure and disables import', (vaultState, message) => {
    const html = renderDocumentKeyManagerDialog({
      documentKeyManagerDialogOpen: true,
      documentKeyMetadata: [],
      documentKeyVaultStatus: {
        configured: vaultState !== 'unavailable',
        hasVault: vaultState !== 'unavailable',
        storageMode: 'nativeKeyringVault',
        state: vaultState,
      },
    } as unknown as AppState);

    expect(html).toContain(message);
    expect(html).toContain('data-action="choose-document-key-files" disabled');
  });

  it('requires an explicit modal and explains that device removal is not revocation', () => {
    const html = renderDocumentKeyDeleteDialog({
      documentKeyDeleteId: '11111111-1111-4111-8111-111111111111',
      documentKeyMetadata: [],
    } as unknown as AppState);

    expect(html).toContain('Remove key from this device?');
    expect(html).toContain('does not revoke exported key files');
    expect(html).toContain('data-action="confirm-delete-document-key"');
  });
});
