import { describe, expect, it } from 'vitest';
import type { AppState } from '../state';
import { renderDocumentEncryptionDialog, renderDocumentKeyDeleteDialog, renderDocumentKeyImportDialog, renderDocumentKeyManagerDialog } from './render-encryption';

function encryptionDialogState(action: 'encrypt' | 'decrypt'): AppState {
  return {
    documentEncryptionDialogOpen: true,
    documentEncryptionAction: action,
    documentEncryptionKeyId: null,
    documentEncryptionKeyLabel: '',
    documentEncryptionKeyUsage: {},
    documentKeyDataLoading: false,
    documentKeyMetadata: [],
  } as unknown as AppState;
}

describe('document encryption confirmation dialog', () => {
  it('uses the simplified confirmation content when enabling encryption', () => {
    const html = renderDocumentEncryptionDialog(encryptionDialogState('encrypt'));

    expect(html).toContain('Encrypt this document?');
    expect(html).toContain('The file name and body will be encrypted with a new key stored on this device. Encrypted components in this document will still use their current keys.');
    expect(html).not.toContain('<p class="eyebrow">Document encryption</p>');
    expect(html).not.toContain('aria-label="Close">×</button>');
    expect(html).not.toContain('Encrypt Document</button>');
    expect(html).toContain('Create a new key');
    expect(html).toContain('New key name');
    expect(html).toContain('placeholder="Unnamed Key"');
    expect(html.indexOf('>Confirm</button>')).toBeLessThan(html.indexOf('>Cancel</button>'));
  });

  it('offers existing keys and reflects the selected key', () => {
    const keyId = '11111111-1111-4111-8111-111111111111';
    const html = renderDocumentEncryptionDialog({
      ...encryptionDialogState('encrypt'),
      documentEncryptionKeyId: keyId,
      documentEncryptionKeyUsage: { [keyId]: { documents: ['Planning / Notes.hvy'], folders: [] } },
      documentKeyMetadata: [{
        keyId,
        label: 'Planning key',
        source: 'imported',
        createdAt: '2026-09-03T12:00:00.000Z',
      }],
    });

    expect(html).toContain(`value="${keyId}" selected`);
    expect(html).toContain('>Planning key</option>');
    expect(html).not.toContain(`>${keyId}</option>`);
    expect(html).toContain('encrypted with the selected key');
  });

  it('offers unnamed and unused keys by ID', () => {
    const keyId = '22222222-2222-4222-8222-222222222222';
    const html = renderDocumentEncryptionDialog({
      ...encryptionDialogState('encrypt'),
      documentEncryptionKeyId: keyId,
      documentKeyMetadata: [{
        keyId,
        source: 'imported',
        createdAt: '2026-09-03T12:00:00.000Z',
      }],
    });

    expect(html).toContain(`>${keyId}</option>`);
    expect(html).not.toContain('New key name');
  });

  it('renders immediately while saved keys load', () => {
    const html = renderDocumentEncryptionDialog({
      ...encryptionDialogState('encrypt'),
      documentKeyDataLoading: true,
    });

    expect(html).toContain('Encrypt this document?');
    expect(html).toContain('Loading saved keys…');
  });

  it('uses the simplified confirmation content when removing encryption', () => {
    const html = renderDocumentEncryptionDialog(encryptionDialogState('decrypt'));

    expect(html).toContain('Remove document encryption?');
    expect(html).toContain('The file name and body will no longer be encrypted. Encrypted components will use their existing keys.');
    expect(html).not.toContain('<p class="eyebrow">Document encryption</p>');
    expect(html).not.toContain('aria-label="Close">×</button>');
    expect(html).not.toContain('Remove Encryption');
    expect(html.indexOf('>Confirm</button>')).toBeLessThan(html.indexOf('>Cancel</button>'));
  });
});

describe('document key import review', () => {
  it('replaces the review with the current migration progress', () => {
    const html = renderDocumentKeyImportDialog({
      documentKeyImportDialogOpen: true,
      documentKeyImportBusy: true,
      documentKeyImportProgress: 'Migrating Planning / Private / Forecast.hvy',
    } as unknown as AppState);

    expect(html).toContain('Importing keys');
    expect(html).toContain('Migrating Planning / Private / Forecast.hvy');
    expect(html).not.toContain('confirm-import-document-keys');
  });

  it('selects new keys, skips matches, and leaves conflicts unchecked for explicit replacement', () => {
    const newId = '11111111-1111-4111-8111-111111111111';
    const matchingId = '22222222-2222-4222-8222-222222222222';
    const conflictId = '33333333-3333-4333-8333-333333333333';
    const key = (keyId: string, label: string) => ({
      keyId,
      label,
      algorithm: 'fernet' as const,
      key: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      sourceName: 'team.hvykey',
      fingerprint: 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF',
    });
    const html = renderDocumentKeyImportDialog({
      documentKeyImportDialogOpen: true,
      documentKeyImportKeys: [key(newId, 'New key'), key(matchingId, 'Matching key'), key(conflictId, 'Conflicting key')],
      documentKeyImportSelection: [newId],
      documentKeyImportMatchingIds: [matchingId],
      documentKeyImportConflictIds: [conflictId],
      documentKeyImportConflictNames: {},
    } as unknown as AppState);

    expect(html).toContain(`data-key-id="${newId}" checked`);
    expect(html).toContain(`data-key-id="${matchingId}" disabled`);
    expect(html).toContain('Already on this device · skipped');
    expect(html).toContain('Different key with the same ID · select to replace it and preserve the current key under a new ID');
    expect(html).not.toContain('Rename current to…');
    expect(html).not.toContain('data-action="set-document-key-import-conflict-name"');
    expect(html).toContain('>Import 1 key</button>');
    expect(html).not.toContain('<p class="eyebrow">Encryption keys</p>');
    expect(html).not.toContain('aria-label="Close">×</button>');
    expect(html).not.toContain('These files are bearer secrets');
    expect(html).not.toContain('Re-importing a matching key ID');
  });

  it('requires a name before importing a selected conflicting key', () => {
    const conflictId = '33333333-3333-4333-8333-333333333333';
    const state = {
      documentKeyImportDialogOpen: true,
      documentKeyImportKeys: [{
        keyId: conflictId,
        label: 'Incoming key',
        algorithm: 'fernet',
        key: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        sourceName: 'team.hvykey',
        fingerprint: 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF',
      }],
      documentKeyImportSelection: [conflictId],
      documentKeyImportMatchingIds: [],
      documentKeyImportConflictIds: [conflictId],
      documentKeyImportConflictNames: {},
      documentKeyImportConflictMigrations: {},
      documentEncryptionKeyUsage: {
        [conflictId]: { documents: ['Planning / Forecast.hvy'], folders: ['Planning / Private'] },
      },
      documentKeyUsageLoaded: true,
    } as unknown as AppState;

    const unnamedHtml = renderDocumentKeyImportDialog(state);
    expect(unnamedHtml).toContain('Rename current to…');
    expect(unnamedHtml).toContain('Current usage');
    expect(unnamedHtml).toContain('Documents: Planning / Forecast.hvy');
    expect(unnamedHtml).toContain('Folders: Planning / Private');
    expect(unnamedHtml).toContain('Migrate to use new key');
    expect(unnamedHtml).toContain('Migrate to use renamed key');
    expect(unnamedHtml).toContain('data-action="set-document-key-import-conflict-name"');
    expect(unnamedHtml).not.toContain('placeholder=');
    expect(unnamedHtml).toContain('data-action="confirm-import-document-keys" disabled');
    state.documentKeyImportConflictNames[conflictId] = 'Previous finance key';
    expect(renderDocumentKeyImportDialog(state)).toContain('data-action="confirm-import-document-keys" disabled');
    state.documentKeyImportConflictMigrations[conflictId] = 'new';
    expect(renderDocumentKeyImportDialog(state)).not.toContain('data-action="confirm-import-document-keys" disabled');
  });
});

describe('document key manager', () => {
  it('lists persisted metadata without embedding secret material', () => {
    const html = renderDocumentKeyManagerDialog({
      documentKeyManagerDialogOpen: true,
      documentEncryptionKeyUsage: { '11111111-1111-4111-8111-111111111111': { documents: ['Planning / Notes.hvy'], folders: ['Planning / Private'] } },
      documentKeyUsageLoaded: true,
      documentKeyDataLoading: false,
      documentKeyExportSelection: ['11111111-1111-4111-8111-111111111111'],
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
    } as unknown as AppState);

    expect(html).toContain('Protected local vault · 1 key');
    expect(html).toContain('Planning bundle');
    expect(html).toContain('11111111-1111-4111-8111-111111111111');
    expect(html).toContain('Imported');
    expect(html).not.toContain('2026-09-02T12:00:00.000Z');
    expect(html).toContain('Documents: Planning / Notes.hvy');
    expect(html).toContain('Folders: Planning / Private');
    expect(html).toContain('document-key-row');
    expect(html).toContain('document-key-name-editor');
    expect(html).toContain('data-action="rename-document-key"');
    expect(html).toContain('data-original-key-name="Planning bundle"');
    expect(html).toContain('data-action="rename-document-key" data-key-id="11111111-1111-4111-8111-111111111111" disabled>Save name</button>');
    expect(html).toContain('data-action="export-document-key"');
    expect(html).toContain('data-action="toggle-document-key-export-selection"');
    expect(html).toContain('class="document-key-bundle-checkbox"');
    expect(html).toContain('aria-label="Select Planning bundle for bundle export"');
    expect(html).not.toContain('Include in bundle');
    expect(html).toContain('aria-label="Select Planning bundle for bundle export" checked');
    expect(html).toContain('data-action="export-selected-document-keys"');
    expect(html).toContain('Export selected (1)…');
    expect(html).toContain('Bundles: Planning bundle');
    expect(html).not.toContain('data-action="request-delete-document-key"');
    expect(html).not.toContain('data-action="close-document-key-manager" aria-label="Close"');
  });

  it('shows an unnamed, unused key with the compact delete control', () => {
    const keyId = '22222222-2222-4222-8222-222222222222';
    const html = renderDocumentKeyManagerDialog({
      documentKeyManagerDialogOpen: true,
      documentEncryptionKeyUsage: {},
      documentKeyUsageLoaded: true,
      documentKeyDataLoading: false,
      documentKeyExportSelection: [],
      documentKeyMetadata: [{
        keyId,
        source: 'generated',
        createdAt: '2026-09-02T12:00:00.000Z',
      }],
      documentKeyVaultStatus: {
        configured: true,
        hasVault: true,
        storageMode: 'safeStorageVault',
        state: 'ready',
      },
    } as unknown as AppState);

    expect(html).toContain('Unnamed Key');
    expect(html).toContain('placeholder="Unnamed Key"');
    expect(html).toContain('No local usages');
    expect(html).toContain(`aria-label="Delete Unnamed Key"`);
    expect(html).toContain('>×</button>');
    expect(html).not.toContain('>Remove…</button>');
    expect(html).toContain('data-action="export-selected-document-keys" disabled');
  });

  it.each([
    ['unavailable', 'Protected operating-system storage is unavailable'],
    ['denied', 'store is locked'],
    ['incomplete', 'vault is incomplete'],
    ['corrupt', 'could not be read or decrypted'],
  ] as const)('shows a distinct %s vault failure and disables import', (vaultState, message) => {
    const html = renderDocumentKeyManagerDialog({
      documentKeyManagerDialogOpen: true,
      documentEncryptionKeyUsage: {},
      documentKeyDataLoading: false,
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

  it('uses the key name and ID in the simplified delete confirmation', () => {
    const html = renderDocumentKeyDeleteDialog({
      documentKeyDeleteId: '11111111-1111-4111-8111-111111111111',
      documentKeyMetadata: [{
        keyId: '11111111-1111-4111-8111-111111111111',
        label: 'Planning key',
        source: 'generated',
        createdAt: '2026-09-02T12:00:00.000Z',
      }],
    } as unknown as AppState);

    expect(html).toContain('Delete Planning key?');
    expect(html).toContain('<span class="document-key-delete-label">Key ID</span>');
    expect(html).toContain('<code class="document-key-delete-id">11111111-1111-4111-8111-111111111111</code>');
    expect(html).not.toContain('HVY encryption key');
    expect(html).not.toContain('<dt>Key</dt>');
    expect(html).not.toContain('aria-label="Close"');
    expect(html).toContain('data-action="confirm-delete-document-key"');
  });
});
