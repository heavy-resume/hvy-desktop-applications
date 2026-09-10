import type { AppState } from '../state';
import { documentEncryptionKeyring } from '../documentKeys';
import { escapeAttr, escapeHtml } from './shared';

function formatKeyTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function renderDocumentKeyImportDialog(state: AppState): string {
  if (!state.documentKeyImportDialogOpen) return '';
  if (state.documentKeyImportBusy) {
    return `
      <div class="modal-backdrop" role="presentation">
        <section class="dialog wide-dialog document-key-dialog document-key-import-busy" role="dialog" aria-modal="true" aria-labelledby="documentKeyImportBusyTitle">
          <h2 id="documentKeyImportBusyTitle">Importing keys</h2>
          <p class="dialog-note">${escapeHtml(state.documentKeyImportProgress || 'Preparing migration…')}</p>
        </section>
      </div>`;
  }
  const selection = new Set(state.documentKeyImportSelection);
  const matchingIds = new Set(state.documentKeyImportMatchingIds);
  const conflictIds = new Set(state.documentKeyImportConflictIds);
  const rows = state.documentKeyImportKeys.map((key) => {
    const matchesExisting = matchingIds.has(key.keyId);
    const conflictsWithExisting = conflictIds.has(key.keyId);
    const checked = selection.has(key.keyId);
    const conflictName = state.documentKeyImportConflictNames?.[key.keyId] ?? '';
    const currentUsage = state.documentEncryptionKeyUsage?.[key.keyId] ?? { documents: [], folders: [] };
    const hasCurrentUsage = currentUsage.documents.length > 0 || currentUsage.folders.length > 0;
    const conflictMigration = state.documentKeyImportConflictMigrations?.[key.keyId];
    const status = matchesExisting
      ? 'Already on this device · skipped'
      : conflictsWithExisting
        ? 'Different key with the same ID · select to replace it and preserve the current key under a new ID'
        : '';
    return `
    <article class="encryption-key-import-row">
      <label class="encryption-key-import-heading">
        <input class="encryption-key-import-checkbox" type="checkbox" data-action="toggle-document-key-import-selection" data-key-id="${escapeAttr(key.keyId)}"${checked ? ' checked' : ''}${matchesExisting ? ' disabled' : ''}>
        <span class="encryption-key-import-name"><strong>${escapeHtml(key.label || 'Unnamed Key')}</strong><small>${key.bundleLabel ? `${escapeHtml(key.bundleLabel)} · ` : ''}${escapeHtml(key.sourceName)}</small></span>
      </label>
      <dl>
        <div><dt>Key ID</dt><dd><code>${escapeHtml(key.keyId)}</code></dd></div>
        <div><dt>Fingerprint</dt><dd><code>${escapeHtml(key.fingerprint)}</code></dd></div>
      </dl>
      ${status ? `<small class="encryption-key-import-status${conflictsWithExisting ? ' is-conflict' : ''}">${escapeHtml(status)}</small>` : ''}
      ${conflictsWithExisting && checked ? `
        <div class="encryption-key-import-current-usage">
          <strong>Current usage</strong>
          ${state.documentKeyUsageLoaded
            ? `${currentUsage.documents.length > 0 ? `<small>Documents: ${currentUsage.documents.map(escapeHtml).join(', ')}</small>` : ''}
               ${currentUsage.folders.length > 0 ? `<small>Folders: ${currentUsage.folders.map(escapeHtml).join(', ')}</small>` : ''}
               ${!hasCurrentUsage ? '<small>No local usages</small>' : ''}`
            : '<small>Checking local usages…</small>'}
        </div>
        ${hasCurrentUsage ? `
          <fieldset class="encryption-key-import-migration-options">
            <legend class="encryption-key-import-migration-legend">Update current usage</legend>
            <label class="encryption-key-import-migration-choice"><input type="radio" name="document-key-conflict-migration-${escapeAttr(key.keyId)}" value="new" data-action="select-document-key-import-conflict-migration" data-key-id="${escapeAttr(key.keyId)}"${conflictMigration === 'new' ? ' checked' : ''}> <span>Migrate to use new key</span></label>
            <label class="encryption-key-import-migration-choice"><input type="radio" name="document-key-conflict-migration-${escapeAttr(key.keyId)}" value="renamed" data-action="select-document-key-import-conflict-migration" data-key-id="${escapeAttr(key.keyId)}"${conflictMigration === 'renamed' ? ' checked' : ''}> <span>Migrate to use renamed key</span></label>
          </fieldset>` : ''}
        <label class="encryption-key-import-conflict-name">
          <span>Rename current to…</span>
          <input type="text" value="${escapeAttr(conflictName)}" maxlength="200" required data-action="set-document-key-import-conflict-name" data-key-id="${escapeAttr(key.keyId)}">
        </label>` : ''}
    </article>`;
  }).join('');
  const selectedConflictMissingName = state.documentKeyImportConflictIds.some((keyId) => selection.has(keyId) && !state.documentKeyImportConflictNames?.[keyId]?.trim());
  const selectedConflictMissingMigration = state.documentKeyImportConflictIds.some((keyId) => {
    if (!selection.has(keyId)) return false;
    const usage = state.documentEncryptionKeyUsage?.[keyId];
    const hasUsage = Boolean(usage && (usage.documents.length > 0 || usage.folders.length > 0));
    return hasUsage && !state.documentKeyImportConflictMigrations?.[keyId];
  });
  const canImport = selection.size > 0 && !selectedConflictMissingName && !selectedConflictMissingMigration;
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog wide-dialog document-key-dialog" role="dialog" aria-modal="true" aria-labelledby="documentKeyImportTitle">
        <h2 id="documentKeyImportTitle">Import ${state.documentKeyImportKeys.length === 1 ? 'key' : 'keys'}?</h2>
        <div class="encryption-key-import-list">${rows}</div>
        <div class="dialog-actions">
          <button class="hvy-galaxy-button primary-button" type="button" data-action="confirm-import-document-keys"${canImport ? '' : ' disabled'}>${selection.size === 0 ? 'Import' : selection.size === 1 ? 'Import 1 key' : `Import ${selection.size} keys`}</button>
          <button class="hvy-galaxy-button" type="button" data-action="cancel-import-document-keys">Cancel</button>
        </div>
      </section>
    </div>`;
}

export function renderDocumentKeyManagerDialog(state: AppState): string {
  if (!state.documentKeyManagerDialogOpen) return '';
  const loadedKeyring = documentEncryptionKeyring();
  const exportSelection = new Set(state.documentKeyExportSelection);
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
  const rows = state.documentKeyMetadata.map((metadata) => {
    const usage = state.documentEncryptionKeyUsage[metadata.keyId] ?? { documents: [], folders: [] };
    const hasLocalUsage = usage.documents.length > 0 || usage.folders.length > 0;
    const keyName = metadata.label || 'Unnamed Key';
    return `
    <li class="document-key-row">
      <div class="document-key-heading">
        <div class="document-key-heading-main">
          <input class="document-key-bundle-checkbox" type="checkbox" data-action="toggle-document-key-export-selection" data-key-id="${escapeAttr(metadata.keyId)}" aria-label="Select ${escapeAttr(keyName)} for bundle export"${exportSelection.has(metadata.keyId) ? ' checked' : ''}>
          <strong class="document-key-title">${escapeHtml(keyName)}</strong>
        </div>
        ${state.documentKeyUsageLoaded && !hasLocalUsage ? `<button class="document-key-delete-button" type="button" data-action="request-delete-document-key" data-key-id="${escapeAttr(metadata.keyId)}" aria-label="Delete ${escapeAttr(keyName)}">×</button>` : ''}
      </div>
      <code class="document-key-id">${escapeHtml(metadata.keyId)}</code>
      <div class="document-key-name-editor">
        <input class="hvy-galaxy-input document-key-name-input" data-document-key-name data-original-key-name="${escapeAttr(metadata.label || '')}" value="${escapeAttr(metadata.label || '')}" placeholder="Unnamed Key" maxlength="200" aria-label="Encryption key name">
        <button class="hvy-galaxy-button" type="button" data-action="rename-document-key" data-key-id="${escapeAttr(metadata.keyId)}" disabled>Save name</button>
      </div>
      <div class="document-key-metadata">
        <small>Created ${escapeHtml(formatKeyTimestamp(metadata.createdAt))} · ${metadata.source === 'generated' ? 'Galaxy' : 'Imported key'}${loadedKeyring[metadata.keyId] ? ' · Loaded this session' : ''}</small>
        ${metadata.bundleLabels?.length ? `<small>Bundles: ${metadata.bundleLabels.map(escapeHtml).join(', ')}</small>` : ''}
      </div>
      <div class="document-key-actions">
        <button class="hvy-galaxy-button" type="button" data-action="export-document-key" data-key-id="${escapeHtml(metadata.keyId)}">Export…</button>
      </div>
      <div class="document-key-usage">
        ${state.documentKeyUsageLoaded
          ? `${usage.documents.length > 0 ? `<small>Documents: ${usage.documents.map(escapeHtml).join(', ')}</small>` : ''}
             ${usage.folders.length > 0 ? `<small>Folders: ${usage.folders.map(escapeHtml).join(', ')}</small>` : ''}
             ${!hasLocalUsage ? '<small>No local usages</small>' : ''}`
          : '<small>Checking local usages…</small>'}
      </div>
    </li>`;
  }).join('');
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog document-key-dialog" role="dialog" aria-modal="true" aria-labelledby="documentKeyManagerTitle">
        <div class="modal-header"><div><p class="eyebrow">Encryption</p><h2 id="documentKeyManagerTitle">Encryption keys</h2></div></div>
        <p class="dialog-note">Galaxy stores imported keys in the protected local vault. Exported key files are unencrypted bearer secrets; protect them with the sharing channel's access controls.</p>
        <p class="dialog-note" data-state="${vaultUsable ? 'ready' : 'error'}">${state.documentKeyDataLoading ? 'Loading encryption keys…' : escapeHtml(vaultStatus.message || statusCopy)}</p>
        <section class="document-key-session-list">
          <h3>Protected local vault${state.documentKeyDataLoading ? '' : ` · ${state.documentKeyMetadata.length} ${state.documentKeyMetadata.length === 1 ? 'key' : 'keys'}`}</h3>
          ${rows ? `<ul class="document-key-list">${rows}</ul>` : state.documentKeyDataLoading ? '<p>Loading…</p>' : '<p>No document encryption keys have been imported or created.</p>'}
        </section>
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="choose-document-key-files"${vaultUsable ? '' : ' disabled'}>Import Key File…</button>
          <button class="hvy-galaxy-button" type="button" data-action="export-selected-document-keys"${exportSelection.size > 0 ? '' : ' disabled'}>${exportSelection.size > 0 ? `Export selected (${exportSelection.size})…` : 'Export selected…'}</button>
          <button class="hvy-galaxy-button primary-button" type="button" data-action="close-document-key-manager">Done</button>
        </div>
      </section>
    </div>`;
}

export function renderDocumentKeyDeleteDialog(state: AppState): string {
  if (!state.documentKeyDeleteId) return '';
  const metadata = state.documentKeyMetadata.find((entry) => entry.keyId === state.documentKeyDeleteId);
  const keyName = metadata?.label || state.documentKeyDeleteId;
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog document-key-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="documentKeyDeleteTitle">
        <h2 id="documentKeyDeleteTitle">Delete ${escapeHtml(keyName)}?</h2>
        <div class="document-key-delete-identity">
          <span class="document-key-delete-label">Key ID</span>
          <code class="document-key-delete-id">${escapeHtml(state.documentKeyDeleteId)}</code>
        </div>
        <div class="dialog-actions">
          <button class="hvy-galaxy-button danger-button" type="button" data-action="confirm-delete-document-key">Delete</button>
          <button class="hvy-galaxy-button" type="button" data-action="cancel-delete-document-key">Cancel</button>
        </div>
      </section>
    </div>`;
}

export function renderDocumentEncryptionDialog(state: AppState): string {
  if (!state.documentEncryptionDialogOpen || !state.documentEncryptionAction) return '';
  const encrypting = state.documentEncryptionAction === 'encrypt';
  const selectedKeyId = state.documentEncryptionKeyId ?? '';
  const title = encrypting ? 'Encrypt this document?' : 'Remove document encryption?';
  const description = encrypting
    ? selectedKeyId
      ? 'The file name and body will be encrypted with the selected key. Encrypted components in this document will still use their current keys.'
      : 'The file name and body will be encrypted with a new key stored on this device. Encrypted components in this document will still use their current keys.'
    : 'The file name and body will no longer be encrypted. Encrypted components will use their existing keys.';
  const keyOptions = state.documentKeyMetadata.map((key) => {
    const label = key.label || key.keyId;
    return `<option value="${escapeAttr(key.keyId)}"${selectedKeyId === key.keyId ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog document-encryption-dialog" role="dialog" aria-modal="true" aria-labelledby="documentEncryptionTitle">
        <h2 id="documentEncryptionTitle">${title}</h2>
        <p class="dialog-note">${description}</p>
        ${encrypting ? `<label class="document-encryption-key-field">
          <span class="document-encryption-key-label">Encryption key</span>
          <select class="hvy-galaxy-select" data-action="select-document-encryption-key">
            <option value=""${selectedKeyId ? '' : ' selected'}>Create a new key</option>
            ${keyOptions}
            ${state.documentKeyDataLoading ? '<option disabled>Loading saved keys…</option>' : ''}
          </select>
        </label>
        ${selectedKeyId ? '' : `<label class="document-encryption-key-field">
          <span class="document-encryption-key-label">New key name</span>
          <input class="hvy-galaxy-input" data-action="set-document-encryption-key-label" value="${escapeAttr(state.documentEncryptionKeyLabel)}" placeholder="Unnamed Key" maxlength="200">
        </label>`}` : ''}
        <div class="dialog-actions">
          <button class="hvy-galaxy-button primary-button" type="button" data-action="confirm-document-encryption">Confirm</button>
          <button class="hvy-galaxy-button" type="button" data-action="cancel-document-encryption">Cancel</button>
        </div>
      </section>
    </div>`;
}
