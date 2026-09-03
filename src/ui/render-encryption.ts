import type { AppState } from '../state';
import { documentEncryptionKeyring } from '../documentKeys';
import { escapeHtml } from './shared';

export function renderDocumentKeyImportDialog(state: AppState): string {
  if (!state.documentKeyImportDialogOpen) return '';
  const rows = state.documentKeyImportKeys.map((key) => `
    <article class="encryption-key-import-row">
      <div>
        <strong>${escapeHtml(key.label || 'HVY encryption key')}</strong>
        <small>${key.bundleLabel ? `${escapeHtml(key.bundleLabel)} · ` : ''}${escapeHtml(key.sourceName)}</small>
      </div>
      <dl>
        <div><dt>Key ID</dt><dd><code>${escapeHtml(key.keyId)}</code></dd></div>
        <div><dt>Fingerprint</dt><dd><code>${escapeHtml(key.fingerprint)}</code></dd></div>
      </dl>
    </article>`).join('');
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog wide-dialog document-key-dialog" role="dialog" aria-modal="true" aria-labelledby="documentKeyImportTitle">
        <div class="modal-header">
          <div><p class="eyebrow">Encryption keys</p><h2 id="documentKeyImportTitle">Import ${state.documentKeyImportKeys.length === 1 ? 'key' : 'keys'}?</h2></div>
          <button class="hvy-galaxy-button icon-button" type="button" data-action="cancel-import-document-keys" aria-label="Close">×</button>
        </div>
        <p class="dialog-note">These files are bearer secrets. Importing copies their keys into Galaxy's protected local vault; it does not remove the original downloaded files.</p>
        <p class="dialog-note">Re-importing a matching key ID is safe and adds any new bundle label. A different key value for an existing ID is rejected; imports never replace key material.</p>
        <div class="encryption-key-import-list">${rows}</div>
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="cancel-import-document-keys">Cancel</button>
          <button class="hvy-galaxy-button primary-button" type="button" data-action="confirm-import-document-keys">Import ${state.documentKeyImportKeys.length === 1 ? 'key' : `${state.documentKeyImportKeys.length} keys`}</button>
        </div>
      </section>
    </div>`;
}

export function renderDocumentKeyManagerDialog(state: AppState): string {
  if (!state.documentKeyManagerDialogOpen) return '';
  const loadedKeyring = documentEncryptionKeyring();
  const vaultStatus = state.documentKeyVaultStatus;
  const statusCopy = {
    empty: 'The protected local vault is ready for its first key.',
    ready: 'The protected local vault is available.',
    unavailable: 'Protected operating-system storage is unavailable on this device.',
    denied: 'Access to protected operating-system storage was denied or the store is locked.',
    incomplete: 'The protected local vault is incomplete. Its protected key and encrypted data file do not match.',
    corrupt: 'The protected local vault could not be read or decrypted.',
  }[vaultStatus.state];
  const vaultUsable = vaultStatus.state === 'empty' || vaultStatus.state === 'ready';
  const rows = state.documentKeyMetadata.map((metadata) => `
    <li>
      <div class="document-key-metadata">
        <strong>${escapeHtml(metadata.label || 'HVY encryption key')}</strong>
        <code>${escapeHtml(metadata.keyId)}</code>
        <small>${metadata.source === 'generated' ? 'Created in Galaxy' : 'Imported'} · ${escapeHtml(metadata.createdAt)}${loadedKeyring[metadata.keyId] ? ' · Loaded this session' : ''}</small>
        ${metadata.bundleLabels?.length ? `<small>Bundles: ${metadata.bundleLabels.map(escapeHtml).join(', ')}</small>` : ''}
      </div>
      <div class="document-key-actions">
        <button class="hvy-galaxy-button" type="button" data-action="export-document-key" data-key-id="${escapeHtml(metadata.keyId)}">Export…</button>
        <button class="hvy-galaxy-button danger-button" type="button" data-action="request-delete-document-key" data-key-id="${escapeHtml(metadata.keyId)}">Remove…</button>
      </div>
    </li>`).join('');
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog document-key-dialog" role="dialog" aria-modal="true" aria-labelledby="documentKeyManagerTitle">
        <div class="modal-header">
          <div><p class="eyebrow">Encryption</p><h2 id="documentKeyManagerTitle">Encryption keys</h2></div>
          <button class="hvy-galaxy-button icon-button" type="button" data-action="close-document-key-manager" aria-label="Close">×</button>
        </div>
        <p class="dialog-note">Galaxy stores imported keys in the protected local vault. Exported key files are unencrypted bearer secrets; protect them with the sharing channel's access controls.</p>
        <p class="dialog-note" data-state="${vaultUsable ? 'ready' : 'error'}">${escapeHtml(vaultStatus.message || statusCopy)}</p>
        <section class="document-key-session-list">
          <h3>Protected local vault · ${state.documentKeyMetadata.length} ${state.documentKeyMetadata.length === 1 ? 'key' : 'keys'}</h3>
          ${rows ? `<ul>${rows}</ul>` : '<p>No document encryption keys have been imported or created.</p>'}
        </section>
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="choose-document-key-files"${vaultUsable ? '' : ' disabled'}>Import Key File…</button>
          <button class="hvy-galaxy-button primary-button" type="button" data-action="close-document-key-manager">Done</button>
        </div>
      </section>
    </div>`;
}

export function renderDocumentKeyDeleteDialog(state: AppState): string {
  if (!state.documentKeyDeleteId) return '';
  const metadata = state.documentKeyMetadata.find((entry) => entry.keyId === state.documentKeyDeleteId);
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog document-key-dialog" role="dialog" aria-modal="true" aria-labelledby="documentKeyDeleteTitle">
        <div class="modal-header">
          <div><p class="eyebrow">Encryption key</p><h2 id="documentKeyDeleteTitle">Remove key from this device?</h2></div>
          <button class="hvy-galaxy-button icon-button" type="button" data-action="cancel-delete-document-key" aria-label="Close">×</button>
        </div>
        <p class="dialog-note" data-state="error">Galaxy will permanently remove this key from its protected local vault. Files, copies, recovery data, and encrypted folders that still use it cannot be opened here unless the key is imported again.</p>
        <p class="dialog-note">This does not revoke exported key files or copies stored on other devices.</p>
        <dl class="document-key-delete-summary">
          <div><dt>Key</dt><dd>${escapeHtml(metadata?.label || 'HVY encryption key')}</dd></div>
          <div><dt>Key ID</dt><dd><code>${escapeHtml(state.documentKeyDeleteId)}</code></dd></div>
        </dl>
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="cancel-delete-document-key">Cancel</button>
          <button class="hvy-galaxy-button danger-button" type="button" data-action="confirm-delete-document-key">Remove from This Device</button>
        </div>
      </section>
    </div>`;
}

export function renderDocumentEncryptionDialog(state: AppState): string {
  if (!state.documentEncryptionDialogOpen || !state.documentEncryptionAction) return '';
  const encrypting = state.documentEncryptionAction === 'encrypt';
  const title = encrypting ? 'Encrypt this document?' : 'Remove document encryption?';
  const description = encrypting
    ? 'Galaxy will generate a new key and store it in the protected local vault. The entire file will be encrypted the next time it is saved.'
    : 'Galaxy will treat the document as plaintext immediately. The file and future recovery data will be written without whole-document encryption; individually encrypted components remain encrypted, and the existing key remains available for older versions or copies.';
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog document-encryption-dialog" role="dialog" aria-modal="true" aria-labelledby="documentEncryptionTitle">
        <div class="modal-header">
          <div><p class="eyebrow">Document encryption</p><h2 id="documentEncryptionTitle">${title}</h2></div>
          <button class="hvy-galaxy-button icon-button" type="button" data-action="cancel-document-encryption" aria-label="Close">×</button>
        </div>
        <p class="dialog-note">${description}</p>
        ${encrypting ? '<p class="dialog-note">Anyone opening the encrypted file needs a matching exported key file.</p>' : ''}
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="cancel-document-encryption">Cancel</button>
          <button class="hvy-galaxy-button primary-button" type="button" data-action="confirm-document-encryption">${encrypting ? 'Encrypt Document' : 'Remove Encryption'}</button>
        </div>
      </section>
    </div>`;
}
