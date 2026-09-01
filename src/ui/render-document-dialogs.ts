import { type AppState } from '../state';
import { formatBackupTimestamp } from './core';
import { escapeAttr, escapeHtml } from './shared';

export function renderRecoveryDialog(state: AppState): string {
  if (!state.recoveryDialogOpen) {
    return '';
  }
  const backups = state.recoveryBackups;
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog wide-dialog recovery-dialog" role="dialog" aria-modal="true" aria-labelledby="recoveryTitle">
        <h2 id="recoveryTitle">Recover Unsaved Edits</h2>
        <p class="dialog-note">Recoverable edits are kept for seven days. Restoring opens a separate Unsaved copy beside the saved file so you can compare them; its timestamp may be older or newer than the saved file.</p>
        ${backups.length === 0
      ? '<div class="empty-panel compact">No recoverable edits are available yet.</div>'
      : `<div class="recovery-list">
                ${backups.map((backup) => `
                  <article class="recovery-item">
                    <div>
                      <strong>${escapeHtml(backup.name)}</strong>
                      <span>${escapeHtml(formatBackupTimestamp(backup.createdAt))}</span>
                      ${backup.documentPath ? `<small>${escapeHtml(backup.documentPath)}</small>` : '<small>Unsaved document</small>'}
                    </div>
                    <div class="recovery-item-actions">
                      <button class="hvy-galaxy-button" type="button" data-action="restore-backup" data-backup-id="${escapeAttr(backup.id)}">Restore Edits</button>
                      <button type="button" class="hvy-galaxy-button danger-button" data-action="discard-backup" data-backup-id="${escapeAttr(backup.id)}">Discard</button>
                    </div>
                  </article>
                `).join('')}
              </div>`
    }
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="cancel-recovery">Close</button>
        </div>
      </section>
    </div>`;
}

export function renderVersionHistoryDialog(state: AppState): string {
  if (!state.versionHistoryDialogOpen) return '';
  const versions = state.savedDocumentVersions;
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog wide-dialog recovery-dialog" role="dialog" aria-modal="true" aria-labelledby="versionHistoryTitle">
        <h2 id="versionHistoryTitle">Version History</h2>
        <p class="dialog-note">Choose a saved version to review it. Saving while reviewing creates a new document and does not change the current document.</p>
        ${versions.length === 0
      ? '<div class="empty-panel compact">No saved versions are available yet.</div>'
      : `<div class="recovery-list">
          ${versions.map((version, index) => `
            <article class="recovery-item${version.id === state.selectedSavedVersionId ? ' is-selected' : ''}">
              <button type="button" class="hvy-galaxy-button version-history-select" data-action="select-saved-version" data-version-id="${escapeAttr(version.id)}" aria-current="${version.id === state.selectedSavedVersionId ? 'true' : 'false'}">
                <strong>${index === 0 ? 'Latest saved version' : 'Saved version'}</strong>
                <span>${escapeHtml(formatBackupTimestamp(version.createdAt))}</span>
                <small>${escapeHtml(version.displayName)}</small>
              </button>
            </article>`).join('')}
        </div>`}
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="close-version-history">Close</button>
        </div>
      </section>
    </div>`;
}

export function renderCloseDocumentDialog(state: AppState): string {
  if (!state.closeDocumentDialogOpen) {
    return '';
  }
  const targetPath = state.closeDocumentTargetPath;
  const target = state.documentTabs.find((tab) => tab.path === targetPath) ?? state.documentTabs.find((tab) => tab.active);
  const documentName = target?.name ?? state.document?.name ?? 'this document';
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog close-document-dialog" role="dialog" aria-modal="true" aria-labelledby="closeDocumentTitle">
        <h2 id="closeDocumentTitle">Save Changes Before Closing?</h2>
        <p class="dialog-note">There are unsaved edits in ${escapeHtml(documentName)}.</p>
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="save-and-close-document">Save and Close</button>
          <button class="hvy-galaxy-button" type="button" data-action="close-document-without-saving">Don't Save</button>
          <button class="hvy-galaxy-button" type="button" data-action="cancel-close-document">Cancel</button>
        </div>
      </section>
    </div>`;
}

export function renderCloseDocumentDraftDialog(state: AppState): string {
  if (!state.closeDocumentDraftDialogOpen) {
    return '';
  }
  const targetPath = state.closeDocumentTargetPath;
  const target = state.documentTabs.find((tab) => tab.path === targetPath) ?? state.documentTabs.find((tab) => tab.active);
  const documentName = target?.name ?? state.document?.name ?? 'this document';
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog close-document-dialog" role="dialog" aria-modal="true" aria-labelledby="closeDocumentDraftTitle">
        <h2 id="closeDocumentDraftTitle">Keep Recovery Draft?</h2>
        <p class="dialog-note">You can discard the unsaved edits in ${escapeHtml(documentName)} or keep the recovery draft to review later.</p>
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="review-close-document-later">Review Later</button>
          <button type="button" class="hvy-galaxy-button danger-button" data-action="discard-close-document-draft">Discard Draft</button>
          <button class="hvy-galaxy-button" type="button" data-action="cancel-close-document">Cancel</button>
        </div>
      </section>
    </div>`;
}

export function renderWorkspaceFileOperationPrompt(state: AppState): string {
  const operation = state.pendingWorkspaceFileOperation;
  if (!state.workspaceFileOperationPromptOpen || !operation) return '';
  const action = operation.kind === 'copyClipboard' || operation.kind === 'pasteCopy' || (operation.kind === 'openTransfer' && operation.mode === 'copyFile')
    ? 'copy'
    : 'move';
  const actionProgressLabel = action === 'copy' ? 'Copying' : 'Moving';
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog workspace-file-operation-dialog" role="dialog" aria-modal="true" aria-labelledby="workspaceFileOperationTitle">
        <h2 id="workspaceFileOperationTitle">Save Changes Before ${actionProgressLabel}?</h2>
        <p class="dialog-note">There are unsaved edits in ${escapeHtml(operation.name)}. Save them before you ${action} the file, or discard them and use the saved version.</p>
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="save-before-workspace-file-operation">Save</button>
          <button type="button" class="hvy-galaxy-button danger-button" data-action="discard-before-workspace-file-operation">Discard</button>
          <button class="hvy-galaxy-button" type="button" data-action="cancel-workspace-file-operation">Cancel</button>
        </div>
      </section>
    </div>`;
}

export function renderSaveConflictDialog(state: AppState): string {
  if (!state.saveConflictDialogOpen || !state.saveConflictKind) return '';
  const content = state.saveConflictKind === 'discardRecoveryDraft'
    ? {
      title: 'Discard Unsaved Draft?',
      note: 'Saving the original file will discard the Unsaved copy and close its tab.',
      action: 'Save Original and Discard Draft',
    }
    : state.saveConflictKind === 'overwriteRecoveryChanges'
      ? {
        title: 'Overwrite Changes to Unsaved Draft?',
        note: 'The Unsaved copy was also changed. Saving the original file will discard those changes and close its tab.',
        action: 'Overwrite Unsaved Draft',
      }
      : {
        title: 'Overwrite Changes to Original File?',
        note: 'The original file also has unsaved changes. Saving the Unsaved copy will overwrite those changes and make this copy the primary document.',
        action: 'Overwrite Original File',
      };
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog save-conflict-dialog" role="dialog" aria-modal="true" aria-labelledby="saveConflictTitle">
        <h2 id="saveConflictTitle">${escapeHtml(content.title)}</h2>
        <p class="dialog-note">${escapeHtml(content.note)}</p>
        <div class="dialog-actions">
          <button type="button" class="hvy-galaxy-button danger-button" data-action="confirm-save-conflict">${escapeHtml(content.action)}</button>
          <button class="hvy-galaxy-button" type="button" data-action="cancel-save-conflict">Cancel</button>
        </div>
      </section>
    </div>`;
}

export function renderAppCloseDialog(state: AppState): string {
  if (!state.appCloseDialogOpen) {
    return '';
  }
  const documentName = state.document?.name ?? 'this document';
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog app-close-dialog" role="dialog" aria-modal="true" aria-labelledby="appCloseTitle">
        <h2 id="appCloseTitle">Save Changes Before Closing?</h2>
        <p class="dialog-note">There are unsaved edits in ${escapeHtml(documentName)}.</p>
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="save-and-close-app">Save and Close</button>
          <button type="button" class="hvy-galaxy-button danger-button" data-action="close-app-without-saving">Close Without Saving</button>
          <button class="hvy-galaxy-button" type="button" data-action="cancel-app-close">Cancel</button>
        </div>
      </section>
    </div>`;
}
