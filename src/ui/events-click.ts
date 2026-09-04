import {
  handleRemoveTag
} from '../../../heavy-file-format/src/editor/tag-editor';
import { isWorkspacePathTarget } from '../../../heavy-file-format/src/workspace-links';
import { aiEmbeddingDefaultModel, aiEmbeddingProvidersForMode } from '../aiProviders';
import { generateMcpBearerToken } from '../backend';
import { type AppState } from '../state';
import { dismissBackdropFromTarget } from './core';
import { addImportExcludeTagSuggestion, importExcludeTagHelpers, syncImportExcludeTagsState, updateImportExcludeTagAutocomplete } from './events-controls';
import { isAiEmbeddingProviderMode, isHvyMode, isMcpClientInstallTarget, isWorkspaceFilterBehavior, isWorkspaceFilterMode, readAiSettingsForm, readAppSettingsForm, readMcpSettingsForm, updateMcpConnectionPreview } from './render-ai-mcp';
import { eyeIcon, eyeOffIcon } from './render-shell';
import { applyThemeColorFilter } from './render-theme';
import { isDocumentCreationType, isImportOutputMode, isImportSourceTab, isNewWorkspaceLocation, isSaveAsKind, isSaveAsScope, isTemplateScope, isWorkspaceFileView } from './render-workspaces';
import { UiHandlers } from './types';

let dismissBackdropPointerStart: HTMLElement | null = null;

export function bindClickEvents(root: HTMLElement, handlers: UiHandlers, state: AppState, signal: AbortSignal): void {
  root.addEventListener('pointerdown', (event) => {
    dismissBackdropPointerStart = dismissBackdropFromTarget(event.target);
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-action="add-import-exclude-tag"]') : null;
    if (target) event.preventDefault();
  }, { signal, capture: true });
  root.addEventListener('click', (event) => {
    const clickedDismissBackdrop = dismissBackdropFromTarget(event.target);
    const dismissBackdropClick = Boolean(clickedDismissBackdrop && clickedDismissBackdrop === dismissBackdropPointerStart);
    dismissBackdropPointerStart = null;
    const eventTarget = event.target instanceof Element ? event.target : null;
    const workspaceLink = eventTarget?.closest<HTMLAnchorElement>('a[href]');
    const workspaceHref = workspaceLink?.getAttribute('href') ?? '';
    if (
      workspaceLink
      && workspaceLink.closest('[data-workspace-chat-document="true"]')
      && (workspaceLink.dataset.hvyCrossDocument === 'true' || isWorkspacePathTarget(workspaceHref))
    ) {
      event.preventDefault();
      event.stopPropagation();
      handlers.openWorkspaceLink(workspaceHref);
      return;
    }
    const target = eventTarget?.closest<HTMLElement>('[data-action]') ?? null;
    if (!target) {
      const backdrop = eventTarget instanceof HTMLElement ? eventTarget.closest<HTMLElement>('.modal-backdrop') : null;
      if (backdrop && backdrop === event.target && dismissBackdropClick) {
        if (backdrop.querySelector('.homepage-picker-dialog')) {
          handlers.cancelHomepagePicker();
          return;
        }
        if (backdrop.querySelector('.about-dialog')) {
          handlers.closeAbout();
          return;
        }
        if (backdrop.querySelector('.debug-log-dialog')) {
          handlers.closeDebugLog();
          return;
        }
        if (backdrop.querySelector('.document-key-dialog')) {
          if (state.documentKeyImportDialogOpen) handlers.cancelImportDocumentKeys();
          else if (state.documentKeyDeleteId) handlers.cancelDeleteDocumentKey();
          else handlers.closeDocumentKeyManager();
          return;
        }
        if (backdrop.querySelector('.document-encryption-dialog')) {
          handlers.cancelDocumentEncryption();
          return;
        }
        if (backdrop.querySelector('.encrypted-ai-access-dialog')) {
          handlers.cancelEncryptedAIAccess();
          return;
        }
        if (backdrop.querySelector('.scripting-review-dialog')) {
          handlers.closeScriptingReview();
          return;
        }
        if (backdrop.querySelector('.workspace-manager-dialog')) {
          handlers.closeWorkspaceManager();
          return;
        }
        if (backdrop.querySelector('.workspace-initialization-dialog')) {
          handlers.cancelWorkspaceInitialization();
          return;
        }
        if (backdrop.querySelector('.color-theme-dialog')) {
          handlers.closeColorTheme();
          return;
        }
        if (backdrop.querySelector('.app-settings-discard-dialog')) {
          handlers.keepEditingAppSettings();
          return;
        }
        if (backdrop.querySelector('.ai-settings-discard-dialog')) {
          handlers.keepEditingAiSettings();
          return;
        }
        if (backdrop.querySelector('.mcp-settings-discard-dialog')) {
          handlers.keepEditingMcpSettings();
          return;
        }
        const mcpSettingsForm = backdrop.querySelector<HTMLFormElement>('form[data-form="mcp-settings"]');
        if (mcpSettingsForm) {
          handlers.cancelMcpSettings(readMcpSettingsForm(new FormData(mcpSettingsForm)));
          return;
        }
        const appSettingsForm = backdrop.querySelector<HTMLFormElement>('form[data-form="app-settings"]');
        if (appSettingsForm) {
          handlers.cancelAppSettings(readAppSettingsForm(new FormData(appSettingsForm), state.document?.source.path ?? ''));
          return;
        }
        if (backdrop.querySelector('.workspace-filter-dialog')) {
          handlers.closeWorkspaceFilter();
          return;
        }
        if (backdrop.querySelector('.close-document-dialog')) {
          handlers.cancelCloseDocument();
          return;
        }
        if (backdrop.querySelector('.save-conflict-dialog')) {
          handlers.cancelSaveConflict();
          return;
        }
        if (backdrop.querySelector('.workspace-file-operation-dialog')) {
          handlers.cancelWorkspaceFileOperation();
          return;
        }
        if (backdrop.querySelector('.app-close-dialog')) {
          handlers.cancelAppClose();
          return;
        }
        if (backdrop.querySelector('[aria-label="PDF exported"]')) {
          handlers.closeExportedPdfDialog();
          return;
        }
        if (backdrop.querySelector('form[data-form="rename-file"]')) {
          handlers.cancelRenameFile();
          return;
        }
        if (backdrop.querySelector('form[data-form="rename-encrypted-folder"]')) {
          handlers.cancelRenameEncryptedFolder();
          return;
        }
        if (backdrop.querySelector('form[data-form="new-folder"]')) {
          handlers.cancelNewFolder();
          return;
        }
        if (backdrop.querySelector('.delete-file-dialog')) {
          handlers.cancelDeleteFile();
          return;
        }
        if (backdrop.querySelector('.delete-folder-dialog')) {
          handlers.cancelDeleteWorkspaceFolder();
          return;
        }
        if (backdrop.querySelector('form[data-form="workspace-transfer"]')) {
          handlers.cancelWorkspaceTransfer();
          return;
        }
        if (backdrop.querySelector('form[data-form="save-as-document"], form[data-form="save-as-template"]')) {
          handlers.cancelSaveAs();
          return;
        }
        const aiSettingsForm = backdrop.querySelector<HTMLFormElement>('form[data-form="ai-settings"]');
        if (aiSettingsForm) {
          handlers.cancelAiSettings(readAiSettingsForm(new FormData(aiSettingsForm)));
          return;
        }
      }
      if (!eventTarget?.closest('.workspace-actions-menu')) {
        handlers.closeWorkspaceActions();
      }
      return;
    }
    if (target.closest('#hvyMount') && !target.closest('[data-workspace-chat-document="true"]')) return;
    if (target instanceof HTMLButtonElement && target.disabled) return;
    const action = target.dataset.action;
    if (action === 'close-workspace-filter' && clickedDismissBackdrop && !dismissBackdropClick) return;
    if (action === 'new-workspace') handlers.newWorkspace();
    if (action === 'toggle-integrations-section') {
      handlers.setIntegrationsSectionExpanded(target.getAttribute('aria-expanded') !== 'true');
    }
    if (action === 'toggle-workspaces-section') {
      handlers.setWorkspacesSectionExpanded(target.getAttribute('aria-expanded') !== 'true');
    }
    if (action === 'manage-workspaces') handlers.openWorkspaceManager();
    if (action === 'close-workspace-manager') handlers.closeWorkspaceManager();
    if (action === 'sort-workspaces') {
      const order = target.dataset.order;
      if (order === 'nameAsc' || order === 'nameDesc' || order === 'recentDesc' || order === 'recentAsc') {
        handlers.sortWorkspaceOrder(order);
      }
    }
    if (action === 'show-workspace-in-folder' && target.dataset.workspacePath) handlers.showFileInFolder(target.dataset.workspacePath);
    if (action === 'archive-workspace' && target.dataset.workspacePath) handlers.archiveWorkspace(target.dataset.workspacePath);
    if (action === 'unarchive-workspace' && target.dataset.workspacePath) handlers.unarchiveWorkspace(target.dataset.workspacePath);
    if (action === 'retry-workspace' && target.dataset.workspacePath) handlers.retryWorkspace(target.dataset.workspacePath);
    if (action === 'unlock-encrypted-folder' && target.dataset.workspacePath) handlers.unlockEncryptedFolders(target.dataset.workspacePath);
    if (action === 'toggle-workspace-actions' && target.dataset.workspacePath) {
      event.preventDefault();
      event.stopPropagation();
      handlers.toggleWorkspaceActions(target.dataset.workspacePath);
    }
    if (action === 'toggle-workspace-expanded' && target.dataset.workspacePath) {
      const expanded = target.getAttribute('aria-expanded') !== 'true';
      handlers.setWorkspaceExpanded(target.dataset.workspacePath, expanded);
      if (expanded) handlers.refreshWorkspace(target.dataset.workspacePath);
    }
    if (action === 'new-folder-in-workspace' || action === 'new-encrypted-folder-in-workspace' || action === 'new-document-in-workspace') {
      event.stopPropagation();
    }
    if (action === 'set-new-workspace-location' && isNewWorkspaceLocation(target.dataset.location)) {
      handlers.setNewWorkspaceLocation(target.dataset.location);
    }
    if (action === 'cancel-new-workspace') handlers.cancelNewWorkspace();
    if (action === 'cancel-encrypted-ai-access') handlers.cancelEncryptedAIAccess();
    if (action === 'confirm-encrypted-ai-access') handlers.confirmEncryptedAIAccess();
    if (action === 'confirm-workspace-initialization') handlers.confirmWorkspaceInitialization();
    if (action === 'cancel-workspace-initialization') handlers.cancelWorkspaceInitialization();
    if (action === 'new-folder-in-workspace' && target.dataset.workspacePath) handlers.openNewFolder(target.dataset.workspacePath, target.dataset.targetDirectory ?? '');
    if (action === 'new-encrypted-folder-in-workspace' && target.dataset.workspacePath) handlers.openNewFolder(target.dataset.workspacePath, target.dataset.targetDirectory ?? '', true);
    if (action === 'new-document-in-workspace' && target.dataset.workspacePath) handlers.newDocumentInWorkspace(target.dataset.workspacePath, target.dataset.targetDirectory ?? '');
    if (action === 'set-new-document-type' && isDocumentCreationType(target.dataset.documentType)) handlers.setNewDocumentType(target.dataset.documentType);
    if (action === 'import-in-workspace' && target.dataset.workspacePath) handlers.openImportInWorkspace(target.dataset.workspacePath, target.dataset.targetDirectory ?? '');
    if (action === 'set-import-document-type' && isDocumentCreationType(target.dataset.documentType)) handlers.setImportDocumentType(target.dataset.documentType);
    if (action === 'add-files-to-workspace' && target.dataset.workspacePath) handlers.addFilesToWorkspace(target.dataset.workspacePath, target.dataset.targetDirectory ?? '');
    if (action === 'open-workspace-filter' && target.dataset.workspacePath) {
      event.preventDefault();
      event.stopPropagation();
      handlers.openWorkspaceFilter(target.dataset.workspacePath, target.dataset.targetDirectory ?? '');
    }
    if (action === 'open-workspace-chat' && target.dataset.workspacePath) {
      event.preventDefault();
      event.stopPropagation();
      handlers.openWorkspaceChat(target.dataset.workspacePath, target.dataset.targetDirectory ?? '');
    }
    if (action === 'toggle-workspace-embedding-preview' && target.dataset.workspacePath) {
      handlers.toggleWorkspaceEmbeddingPreview(target.dataset.workspacePath);
    }
    if (action === 'set-workspace-file-view' && target.dataset.workspacePath && isWorkspaceFileView(target.dataset.view)) {
      handlers.setWorkspaceFileView(target.dataset.workspacePath, target.dataset.view);
    }
    if (action === 'close-workspace-filter') handlers.closeWorkspaceFilter();
    if (action === 'close-workspace-chat') handlers.closeWorkspaceChat();
    if (action === 'save-workspace-chat') handlers.saveWorkspaceChat();
    if (action === 'discard-workspace-chat') handlers.discardWorkspaceChat();
    if (action === 'cancel-close-workspace-chat') handlers.cancelCloseWorkspaceChat();
    if (action === 'cancel-workspace-chat-indexing') handlers.cancelWorkspaceChatIndexing();
    if (action === 'set-workspace-filter-mode' && isWorkspaceFilterMode(target.dataset.filterMode)) handlers.setWorkspaceFilterMode(target.dataset.filterMode);
    if (action === 'set-workspace-filter-behavior' && isWorkspaceFilterBehavior(target.dataset.filterBehavior)) handlers.setWorkspaceFilterBehavior(target.dataset.filterBehavior);
    if (action === 'clear-workspace-filter') handlers.clearWorkspaceFilter();
    if (action === 'delete-file') handlers.deleteFile();
    if (action === 'cancel-delete-file') handlers.cancelDeleteFile();
    if (action === 'delete-folder') handlers.deleteWorkspaceFolder(state.deleteFolderWorkspacePath ?? '', state.deleteFolderDirectory);
    if (action === 'cancel-delete-folder') handlers.cancelDeleteWorkspaceFolder();
    if (action === 'cancel-new-document') handlers.cancelNewDocument();
    if (action === 'cancel-new-folder') handlers.cancelNewFolder();
    if (action === 'about') handlers.openAbout();
    if (action === 'integrations') handlers.openIntegrations();
    if (action === 'close-integrations') handlers.closeIntegrations();
    if (action === 'open-integration' && (target.dataset.destination === 'msn' || target.dataset.destination === 'gmail' || target.dataset.destination === 'calendar')) {
      handlers.openIntegration(target.dataset.destination);
    }
    if (action === 'open-integration-page' && target.dataset.integrationId && target.dataset.pageId) {
      handlers.openIntegrationPage(target.dataset.integrationId, target.dataset.pageId, target.dataset.profileId);
    }
    if (action === 'open-integration-ready-checks' && target.dataset.integrationId && target.dataset.pageId) handlers.openIntegrationReadyChecks(target.dataset.integrationId, target.dataset.pageId);
    if (action === 'cancel-integration-ready-checks') handlers.cancelIntegrationReadyChecks();
    if (action === 'cancel-integration-ready-check-selection') handlers.cancelIntegrationReadyCheckSelection();
    if (action === 'remove-integration-ready-check' && target.dataset.checkId) handlers.removeIntegrationReadyCheck(target.dataset.checkId);
    if (action === 'add-integration-ready-check') {
      const form = target.closest<HTMLFormElement>('form[data-form="integration-ready-checks"]');
      if (form && target.dataset.integrationId && target.dataset.pageId) {
        const data = new FormData(form);
        const mode = String(data.get('urlMode'));
        const expectedValues = Object.fromEntries([...data.entries()].flatMap(([key, value]) => key.startsWith('readyValue:') ? [[key.slice('readyValue:'.length), String(value)]] : []));
        if (mode === 'strict-url' || mode === 'strict-domain' || mode === 'domain-regex') handlers.requestIntegrationReadyCheck(target.dataset.integrationId, target.dataset.pageId, mode, String(data.get('urlValue') ?? ''), expectedValues);
      }
    }
    if (action === 'test-integration-ready-checks') {
      const form = target.closest<HTMLFormElement>('form[data-form="integration-ready-checks"]');
      if (form && target.dataset.integrationId && target.dataset.pageId) {
        const data = new FormData(form);
        const mode = String(data.get('urlMode'));
        const expectedValues = Object.fromEntries([...data.entries()].flatMap(([key, value]) => key.startsWith('readyValue:') ? [[key.slice('readyValue:'.length), String(value)]] : []));
        if (mode === 'strict-url' || mode === 'strict-domain' || mode === 'domain-regex') handlers.testIntegrationReadyChecks(target.dataset.integrationId, target.dataset.pageId, mode, String(data.get('urlValue') ?? ''), expectedValues);
      }
    }
    if (action === 'add-action-for-integration-page' && target.dataset.integrationId && target.dataset.pageId) {
      handlers.addActionForIntegrationPage(target.dataset.integrationId, target.dataset.pageId);
    }
    if (action === 'edit-integration-action' && target.dataset.integrationId && target.dataset.actionId) handlers.editIntegrationAction(target.dataset.integrationId, target.dataset.actionId);
    if (action === 'close-integration-action-builder') handlers.closeIntegrationActionBuilder();
    if (action === 'cancel-discard-integration-action') handlers.cancelDiscardIntegrationAction();
    if (action === 'confirm-discard-integration-action') handlers.confirmDiscardIntegrationAction();
    if (action === 'cancel-integration-action-selection') handlers.cancelIntegrationActionSelection();
    if (action === 'add-another-integration-action-example') handlers.addAnotherIntegrationActionExample(Number(target.dataset.parentIndex ?? 0), target.dataset.fieldIndex === undefined ? null : Number(target.dataset.fieldIndex));
    if (action === 'select-integration-action-example') handlers.selectIntegrationActionExample(Number(target.dataset.index));
    if (action === 'set-integration-target-absent') handlers.setIntegrationTargetAbsent(Number(target.dataset.fieldIndex), Number(target.dataset.parentIndex), true);
    if (action === 'clear-integration-target-absent') handlers.setIntegrationTargetAbsent(Number(target.dataset.fieldIndex), Number(target.dataset.parentIndex), false);
    if (action === 'toggle-integration-target-many') {
      const index = Number(target.dataset.index);
      const many = state.integrationActionTargetCardinalities[index] !== 'list';
      handlers.updateIntegrationTargetCardinality(index, many ? 'list' : 'single');
      target.classList.toggle('is-active', many);
      target.setAttribute('aria-pressed', String(many));
    }
    if (action === 'toggle-integration-target-required') {
      const index = Number(target.dataset.index);
      const required = state.integrationActionTargetOptional[index] ?? true;
      handlers.updateIntegrationTargetOptional(index, !required);
      target.classList.toggle('is-active', required);
      target.setAttribute('aria-pressed', String(required));
    }
    if (action === 'add-integration-action-anchor') handlers.addIntegrationActionAnchor();
    if (action === 'test-integration-action-pattern') handlers.testIntegrationActionPattern();
    if (action === 'preview-integration-action') handlers.previewIntegrationAction();
    if (action === 'continue-integration-action-builder') handlers.continueIntegrationActionBuilder();
    if (action === 'back-integration-action-builder') handlers.backIntegrationActionBuilder();
    if (action === 'save-integration-action-draft') handlers.saveIntegrationActionDraft();
    if (action === 'run-integration-action' && target.dataset.integrationId && target.dataset.actionId) handlers.runIntegrationAction(target.dataset.integrationId, target.dataset.actionId);
    if (action === 'close-integration-action-result') handlers.closeIntegrationActionResult();
    if (action === 'add-command-for-integration-action' && target.dataset.integrationId && target.dataset.actionId) handlers.addCommandForIntegrationAction(target.dataset.integrationId, target.dataset.actionId);
    if (action === 'add-command-for-integration-page' && target.dataset.integrationId && target.dataset.pageId) handlers.addCommandForIntegrationPage(target.dataset.integrationId, target.dataset.pageId);
    if (action === 'cancel-integration-command-builder') handlers.cancelIntegrationCommandBuilder();
    if (action === 'request-delete-integration-command' && target.dataset.integrationId && target.dataset.actionId && target.dataset.commandId) handlers.requestDeleteIntegrationCommand(target.dataset.integrationId, target.dataset.actionId, target.dataset.commandId);
    if (action === 'cancel-delete-integration-command') handlers.cancelDeleteIntegrationCommand();
    if (action === 'confirm-delete-integration-command') handlers.confirmDeleteIntegrationCommand();
    if (action === 'run-integration-command' && target.dataset.integrationId && target.dataset.actionId && target.dataset.commandId) {
      handlers.runIntegrationCommand(target.dataset.integrationId, target.dataset.actionId, target.dataset.commandId, target.dataset.recordParent);
    }
    if (action === 'run-integration-page-command' && target.dataset.integrationId && target.dataset.pageId && target.dataset.commandId) handlers.runIntegrationPageCommand(target.dataset.integrationId, target.dataset.pageId, target.dataset.commandId);
    if (action === 'cancel-integration-command-run') handlers.cancelIntegrationCommandRun();
    if (action === 'request-delete-integration-action' && target.dataset.integrationId && target.dataset.actionId) handlers.requestDeleteIntegrationAction(target.dataset.integrationId, target.dataset.actionId);
    if (action === 'cancel-delete-integration-action') handlers.cancelDeleteIntegrationAction();
    if (action === 'confirm-delete-integration-action') handlers.confirmDeleteIntegrationAction();
    if (action === 'review-integration-action-selection' && (target.dataset.kind === 'example' || target.dataset.kind === 'target')) {
      handlers.reviewIntegrationActionSelection(target.dataset.kind, Number(target.dataset.index));
    }
    if (action === 'remove-integration-action-selection' && (target.dataset.kind === 'example' || target.dataset.kind === 'target')) {
      handlers.removeIntegrationActionSelection(target.dataset.kind, Number(target.dataset.index));
    }
    if (action === 'select-integration' && target.dataset.integrationId) handlers.selectIntegration(target.dataset.integrationId);
    if (action === 'select-integration-profile' && target.dataset.profileId) handlers.selectIntegrationProfile(target.dataset.profileId);
    if (action === 'request-add-integration-page') handlers.requestAddIntegrationPage();
    if (action === 'discover-integration-sources' && target.dataset.integrationId && target.dataset.pageId) handlers.discoverIntegrationSources(target.dataset.integrationId, target.dataset.pageId);
    if (action === 'save-integration-source' && target.dataset.integrationId && target.dataset.pageId && target.dataset.sourceIndex) {
      const source = state.integrationStructuredSources[Number(target.dataset.sourceIndex)];
      if (source) handlers.saveIntegrationSource(target.dataset.integrationId, target.dataset.pageId, source);
    }
    if (action === 'fetch-integration-source' && target.dataset.integrationId && target.dataset.pageId && target.dataset.sourceId) handlers.fetchIntegrationSource(target.dataset.integrationId, target.dataset.pageId, target.dataset.sourceId);
    if (action === 'close-integration-structured-result') handlers.closeIntegrationStructuredResult();
    if (action === 'discover-webmcp-tools' && target.dataset.integrationId && target.dataset.pageId) handlers.discoverIntegrationWebMcpTools(target.dataset.integrationId, target.dataset.pageId);
    if (action === 'review-webmcp-tool' && target.dataset.integrationId && target.dataset.pageId && target.dataset.toolIndex) handlers.reviewIntegrationWebMcpTool(target.dataset.integrationId, target.dataset.pageId, Number(target.dataset.toolIndex));
    if (action === 'cancel-webmcp-review') handlers.cancelIntegrationWebMcpReview();
    if (action === 'set-webmcp-exposure' && target instanceof HTMLInputElement && target.dataset.capabilityId && (target.dataset.kind === 'scripting' || target.dataset.kind === 'mcp')) handlers.setIntegrationWebMcpExposure(target.dataset.capabilityId, target.dataset.kind, target.checked);
    if (action === 'invoke-webmcp-tool' && target.dataset.capabilityId) handlers.requestInvokeIntegrationWebMcpTool(target.dataset.capabilityId);
    if (action === 'cancel-invoke-webmcp-tool') handlers.cancelInvokeIntegrationWebMcpTool();
    if (action === 'close-webmcp-result') handlers.closeIntegrationWebMcpResult();
    if (action === 'request-save-webmcp-record-type') handlers.requestSaveIntegrationWebMcpRecordType();
    if (action === 'cancel-save-webmcp-record-type') handlers.cancelSaveIntegrationWebMcpRecordType();
    if (action === 'select-webmcp-record-path' && target instanceof HTMLInputElement) handlers.selectIntegrationWebMcpRecordPath(target.value);
    if (action === 'cancel-add-integration-page') handlers.cancelAddIntegrationPage();
    if (action === 'close-integration-page-error') handlers.closeIntegrationPageError();
    if (action === 'request-add-integration-profile') handlers.requestAddIntegrationProfile();
    if (action === 'cancel-add-integration-profile') handlers.cancelAddIntegrationProfile();
    if (action === 'set-inspection-privacy' && target.dataset.path) {
      const row = target.closest<HTMLElement>('[data-privacy-path]');
      const label = row?.querySelector<HTMLInputElement>('input[name="privacyLabel"]')?.value;
      const privacyAction = target.dataset.privacyAction;
      if (privacyAction === 'label' || privacyAction === 'remove' || privacyAction === 'keep') {
        handlers.setInspectionPrivacyRule(target.dataset.path, privacyAction, label);
        if (row) {
          row.classList.toggle('is-remove', privacyAction === 'remove');
          row.classList.toggle('is-label', privacyAction === 'label');
          const value = row.querySelector<HTMLElement>('[data-review-field-value]');
          if (value) value.textContent = privacyAction === 'remove' ? 'Not shared' : privacyAction === 'label' ? `Replaced with {{${label || 'REDACTED'}}}` : row.dataset.originalValue ?? '';
          const input = row.querySelector<HTMLInputElement>('input[name="privacyLabel"]');
          if (input && privacyAction !== 'label') input.value = '';
          row.querySelector<HTMLButtonElement>('[data-privacy-action="keep"]')?.toggleAttribute('disabled', privacyAction === 'keep');
        }
      }
    }
    if (action === 'integration-browser-command' && ['back', 'forward', 'reload', 'inspect', 'close'].includes(target.dataset.command ?? '')) {
      handlers.controlIntegrationBrowser(target.dataset.command as 'back' | 'forward' | 'reload' | 'inspect' | 'close');
    }
    if (action === 'probe-integration-storage') handlers.probeIntegrationStorage();
    if (action === 'request-reset-integration-vault') handlers.requestResetIntegrationVault();
    if (action === 'confirm-reset-integration-vault') handlers.confirmResetIntegrationVault();
    if (action === 'cancel-reset-integration-vault') handlers.cancelResetIntegrationVault();
    if (action === 'choose-document-key-files') handlers.chooseDocumentKeyFiles();
    if (action === 'confirm-import-document-keys') handlers.confirmImportDocumentKeys();
    if (action === 'cancel-import-document-keys') handlers.cancelImportDocumentKeys();
    if (action === 'export-document-key') handlers.exportDocumentKey(target.dataset.keyId ?? '');
    if (action === 'export-selected-document-keys') handlers.exportSelectedDocumentKeys();
    if (action === 'rename-document-key') {
      const row = target.closest('li');
      const input = row?.querySelector<HTMLInputElement>('[data-document-key-name]');
      handlers.renameDocumentKey(target.dataset.keyId ?? '', input?.value ?? '');
    }
    if (action === 'request-delete-document-key') handlers.requestDeleteDocumentKey(target.dataset.keyId ?? '');
    if (action === 'confirm-delete-document-key') handlers.confirmDeleteDocumentKey();
    if (action === 'cancel-delete-document-key') handlers.cancelDeleteDocumentKey();
    if (action === 'close-document-key-manager') handlers.closeDocumentKeyManager();
    if (action === 'confirm-document-encryption') handlers.confirmDocumentEncryption();
    if (action === 'cancel-document-encryption') handlers.cancelDocumentEncryption();
    if (action === 'close-about') handlers.closeAbout();
    if (action === 'app-settings') handlers.openAppSettings();
    if (action === 'open-homepage-picker') {
      const form = target.closest<HTMLFormElement>('form[data-form="app-settings"]');
      if (form) handlers.openHomepagePicker(readAppSettingsForm(new FormData(form), state.document?.source.path ?? ''));
    }
    if (action === 'use-current-document-as-homepage') {
      const form = target.closest<HTMLFormElement>('form[data-form="app-settings"]');
      if (form) handlers.useCurrentDocumentAsHomepage(readAppSettingsForm(new FormData(form), state.document?.source.path ?? ''));
    }
    if (action === 'choose-replacement-homepage') handlers.chooseReplacementHomepage();
    if (action === 'cancel-homepage-picker') handlers.cancelHomepagePicker();
    if (action === 'select-homepage-document' && target.dataset.path) handlers.selectHomepageDocument(target.dataset.path);
    if (action === 'use-included-guide-as-homepage') handlers.useIncludedGuideAsHomepage();
    if (action === 'disable-homepage') handlers.disableHomepage();
    if (action === 'review-scripting') handlers.openScriptingReview();
    if (action === 'close-scripting-review') handlers.closeScriptingReview();
    if (action === 'allow-file-power-scripting' && target.dataset.path) {
      handlers.setWholeFilePowerScriptingAllowed(target.dataset.path, true);
    }
    if (action === 'revoke-file-power-scripting' && target.dataset.path) {
      handlers.setWholeFilePowerScriptingAllowed(target.dataset.path, false);
    }
    if (action === 'revoke-power-script' && target.dataset.path && target.dataset.fingerprint) {
      handlers.revokePowerScriptAcceptance(target.dataset.path, target.dataset.fingerprint);
    }
    if (action === 'cancel-app-settings') {
      const form = target.closest<HTMLFormElement>('form[data-form="app-settings"]');
      handlers.cancelAppSettings(form ? readAppSettingsForm(new FormData(form), state.document?.source.path ?? '') : undefined);
    }
    if (action === 'discard-app-settings-changes') handlers.discardAppSettingsChanges();
    if (action === 'keep-editing-app-settings') handlers.keepEditingAppSettings();
    if (action === 'ai-settings') handlers.openAiSettings();
    if (action === 'select-ai-provider' && target.dataset.providerId) {
      const form = target.closest<HTMLFormElement>('form[data-form="ai-settings"]');
      const settings = form ? readAiSettingsForm(new FormData(form)) : undefined;
      if (settings) handlers.selectAiProvider(target.dataset.providerId, settings);
    }
    if (action === 'set-default-ai-provider') {
      const form = target.closest<HTMLFormElement>('form[data-form="ai-settings"]');
      const settings = form ? readAiSettingsForm(new FormData(form)) : undefined;
      if (settings) handlers.setDefaultAiProvider(settings);
    }
    if (action === 'select-embedding-mode' && isAiEmbeddingProviderMode(target.dataset.embeddingMode)) {
      const form = target.closest<HTMLFormElement>('form[data-form="ai-settings"]');
      const settings = form ? readAiSettingsForm(new FormData(form)) : undefined;
      if (form && settings) {
        const providerId = aiEmbeddingProvidersForMode(target.dataset.embeddingMode)[0]?.id ?? 'openai';
        settings.embeddings.providerId = providerId;
        settings.embeddings.model = settings.embeddings.modelsByProvider?.[providerId] || aiEmbeddingDefaultModel(providerId);
        settings.embeddings.modelsByProvider = {
          ...(settings.embeddings.modelsByProvider ?? {}),
          [providerId]: settings.embeddings.model,
        };
        settings.embeddings.dimensions = null;
        handlers.selectAiProvider(String(new FormData(form).get('selectedProviderId') ?? settings.activeProviderId), settings);
      }
    }
    if (action === 'provider-docs') {
      const url = target.dataset.url;
      if (url) handlers.openProviderDocs(url);
    }
    if (action === 'cancel-ai-settings') {
      const form = target.closest<HTMLFormElement>('form[data-form="ai-settings"]');
      handlers.cancelAiSettings(form ? readAiSettingsForm(new FormData(form)) : undefined);
    }
    if (action === 'discard-ai-settings-changes') handlers.discardAiSettingsChanges();
    if (action === 'keep-editing-ai-settings') handlers.keepEditingAiSettings();
    if (action === 'mcp-settings') handlers.openMcpSettings();
    if (action === 'cancel-mcp-settings') {
      const form = target.closest<HTMLFormElement>('form[data-form="mcp-settings"]');
      handlers.cancelMcpSettings(form ? readMcpSettingsForm(new FormData(form)) : undefined);
    }
    if (action === 'discard-mcp-settings-changes') handlers.discardMcpSettingsChanges();
    if (action === 'keep-editing-mcp-settings') handlers.keepEditingMcpSettings();
    if (action === 'start-mcp-server') handlers.startMcpServer();
    if (action === 'stop-mcp-server') handlers.stopMcpServer();
    if (action === 'restart-mcp-server') handlers.restartMcpServer();
    if (action === 'install-mcp-client' && isMcpClientInstallTarget(target.dataset.target)) {
      handlers.installMcpClient(target.dataset.target);
    }
    if (action === 'remove-mcp-client' && isMcpClientInstallTarget(target.dataset.target)) {
      handlers.removeMcpClient(target.dataset.target);
    }
    if (action === 'restore-mcp-client-backup' && isMcpClientInstallTarget(target.dataset.target)) {
      handlers.restoreMcpClientBackup(target.dataset.target);
    }
    if (action === 'generate-mcp-token') {
      const form = target.closest<HTMLFormElement>('form[data-form="mcp-settings"]');
      const tokenInput = form?.querySelector<HTMLInputElement>('input[name="bearerToken"]');
      if (form && tokenInput) {
        tokenInput.value = generateMcpBearerToken();
        updateMcpConnectionPreview(form);
      }
    }
    if (action === 'toggle-mcp-token') {
      const form = target.closest<HTMLFormElement>('form[data-form="mcp-settings"]');
      const tokenInput = form?.querySelector<HTMLInputElement>('input[name="bearerToken"]');
      if (tokenInput) {
        const reveal = tokenInput.type === 'password';
        tokenInput.type = reveal ? 'text' : 'password';
        target.setAttribute('aria-label', reveal ? 'Hide bearer token' : 'Show bearer token');
        target.setAttribute('title', reveal ? 'Hide bearer token' : 'Show bearer token');
        target.innerHTML = reveal ? eyeOffIcon() : eyeIcon();
      }
    }
    if (action === 'copy-mcp-token') {
      const token = target
        .closest<HTMLFormElement>('form[data-form="mcp-settings"]')
        ?.querySelector<HTMLInputElement>('input[name="bearerToken"]')
        ?.value
        ?.trim();
      if (token) handlers.copyMcpBearerToken(token);
    }
    if (action === 'copy-mcp-url') {
      const url = target
        .closest<HTMLElement>('.mcp-status-card')
        ?.querySelector<HTMLInputElement>('[data-role="mcp-url"]')
        ?.value
        ?.trim();
      if (url) handlers.copyMcpConnectionUrl(url);
    }
    if (action === 'copy-mcp-value') {
      const field = target.closest<HTMLElement>('.mcp-copy-field');
      const value = field?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')?.value.trim();
      const label = field?.dataset.copyLabel ?? 'value';
      if (value) handlers.copyMcpSetupValue(value, label);
    }
    if (action === 'select-mcp-transport' && target.dataset.transport) {
      const form = target.closest<HTMLFormElement>('form[data-form="mcp-settings"]');
      form?.querySelectorAll<HTMLElement>('[data-transport-tab]').forEach((tab) => {
        const active = tab.dataset.transportTab === target.dataset.transport;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      form?.querySelectorAll<HTMLElement>('[data-transport-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.transportPanel !== target.dataset.transport;
      });
    }
    if (action === 'cancel-color-theme') handlers.closeColorTheme();
    if (action === 'theme-save') handlers.saveColorTheme();
    if (action === 'theme-export') handlers.exportColorTheme();
    if (action === 'theme-import') handlers.importColorTheme();
    if (action === 'theme-select' && target.dataset.themeId) handlers.selectColorTheme(target.dataset.themeId);
    if (action === 'theme-delete' && target.dataset.themeId) handlers.deleteColorTheme(target.dataset.themeId);
    if (action === 'theme-apply-palette') handlers.applyColorThemePalette(target.dataset.paletteId ?? null);
    if (action === 'theme-clear-palette') handlers.applyColorThemePalette(null);
    if (action === 'theme-reset-color' && target.dataset.colorName) handlers.resetColorTheme(target.dataset.colorName);
    if (action === 'theme-preview-select-component' && target.dataset.themeComponent) {
      const dialog = target.closest<HTMLElement>('.color-theme-dialog');
      dialog?.querySelectorAll<HTMLElement>('.theme-component-picker-button').forEach((button) => {
        button.classList.toggle('is-active', button === target);
      });
      dialog?.querySelectorAll<HTMLElement>('[data-theme-preview-component]').forEach((preview) => {
        preview.classList.toggle('is-active', preview.dataset.themePreviewComponent === target.dataset.themeComponent);
      });
    }
    if (action === 'theme-preview-set-state' && target.dataset.themeState) {
      const preview = target.closest<HTMLElement>('[data-theme-preview-component]');
      if (preview) {
        preview.dataset.themePreviewState = target.dataset.themeState;
        preview.querySelectorAll<HTMLElement>('.theme-preview-state-button').forEach((button) => {
          button.classList.toggle('is-active', button === target);
        });
      }
      applyThemeColorFilter(target);
    }
    if (action === 'theme-filter-to-colors') applyThemeColorFilter(target);
    if (action === 'restore-backup' && target.dataset.backupId) handlers.restoreBackup(target.dataset.backupId);
    if (action === 'discard-backup' && target.dataset.backupId) handlers.discardBackup(target.dataset.backupId);
    if (action === 'cancel-recovery') handlers.cancelRecovery();
    if (action === 'select-saved-version' && target.dataset.versionId) handlers.selectSavedVersion(target.dataset.versionId);
    if (action === 'close-version-history') handlers.closeVersionHistory();
    if (action === 'cancel-rename-file') handlers.cancelRenameFile();
    if (action === 'cancel-rename-encrypted-folder') handlers.cancelRenameEncryptedFolder();
    if (action === 'cancel-workspace-transfer') handlers.cancelWorkspaceTransfer();
    if (action === 'open-workspace') handlers.openWorkspace();
    if (action === 'open-file') handlers.openFile();
    if (action === 'set-mode' && isHvyMode(target.dataset.mode)) handlers.setMode(target.dataset.mode);
    if (action === 'open-document-meta') handlers.openDocumentMeta();
    if (action === 'open-document-colors') handlers.openDocumentColorTheme();
    if (action === 'save') handlers.save();
    if (action === 'save-as') handlers.saveAs();
    if (action === 'set-save-as-kind' && isSaveAsKind(target.dataset.kind)) handlers.setSaveAsKind(target.dataset.kind);
    if (action === 'select-document-tab' && target.dataset.path !== undefined) handlers.selectDocumentTab(target.dataset.path);
    if (action === 'close-document-tab' && target.dataset.path !== undefined) {
      event.stopPropagation();
      handlers.closeDocumentTab(target.dataset.path);
    }
    if (action === 'select-tab-stack-item' && target.dataset.path !== undefined) handlers.selectDocumentTab(target.dataset.path);
    if (action === 'close-document') handlers.closeDocument();
    if (action === 'save-and-close-document') handlers.saveAndCloseDocument();
    if (action === 'close-document-without-saving') handlers.closeDocumentWithoutSaving();
    if (action === 'discard-close-document-draft') handlers.discardCloseDocumentDraft();
    if (action === 'review-close-document-later') handlers.reviewCloseDocumentLater();
    if (action === 'cancel-close-document') handlers.cancelCloseDocument();
    if (action === 'confirm-save-conflict') handlers.confirmSaveConflict();
    if (action === 'cancel-save-conflict') handlers.cancelSaveConflict();
    if (action === 'save-before-workspace-file-operation') handlers.saveBeforeWorkspaceFileOperation();
    if (action === 'discard-before-workspace-file-operation') handlers.discardBeforeWorkspaceFileOperation();
    if (action === 'cancel-workspace-file-operation') handlers.cancelWorkspaceFileOperation();
    if (action === 'save-and-close-app') handlers.saveAndCloseApp();
    if (action === 'close-app-without-saving') handlers.closeAppWithoutSaving();
    if (action === 'cancel-app-close') handlers.cancelAppClose();
    if (action === 'save-to-workspace') handlers.saveCurrentToWorkspace();
    if (action === 'set-save-as-scope' && isSaveAsScope(target.dataset.scope)) handlers.setSaveAsScope(target.dataset.scope);
    if (action === 'save-as-anywhere') handlers.saveAsAnywhere();
    if (action === 'cancel-save-as') handlers.cancelSaveAs();
    if (action === 'import-into-current') handlers.openImportIntoCurrent();
    if (action === 'set-import-source-tab' && isImportSourceTab(target.dataset.tab)) handlers.setImportSourceTab(target.dataset.tab);
    if (action === 'set-import-output-mode' && isImportOutputMode(target.dataset.mode)) handlers.setImportOutputMode(target.dataset.mode);
    if (action === 'choose-import-source') handlers.chooseImportSource();
    if (action === 'remove-tag' && !target.closest('#hvyMount')) {
      handleRemoveTag(target, importExcludeTagHelpers);
      syncImportExcludeTagsState(target, handlers);
      updateImportExcludeTagAutocomplete(target);
    }
    if (action === 'add-import-exclude-tag' && !target.closest('#hvyMount')) {
      addImportExcludeTagSuggestion(target, handlers);
    }
    if (action === 'cancel-import') handlers.cancelImport();
    if (action === 'export-pdf') handlers.exportPdf();
    if (action === 'open-exported-pdf') handlers.openExportedPdf();
    if (action === 'reveal-exported-pdf') handlers.revealExportedPdf();
    if (action === 'close-exported-pdf-dialog') handlers.closeExportedPdfDialog();
    if (action === 'close-debug-log') handlers.closeDebugLog();
    if (action === 'refresh-debug-log') handlers.refreshDebugLog();
    if (action === 'clear-debug-log') handlers.clearDebugLog();
    if (action === 'cancel-export') handlers.cancelSaveTemplate();
    if (action === 'save-before-export-pdf') handlers.saveBeforeExportPdf();
    if (action === 'cancel-export-pdf-save-prompt') handlers.cancelExportPdfSavePrompt();
    if (action === 'set-save-template-scope' && isTemplateScope(target.dataset.scope)) handlers.setSaveTemplateScope(target.dataset.scope);
    if (action === 'create-file') handlers.createFile();
    if (action === 'select-file' && target.dataset.path) handlers.selectFile(target.dataset.path);
  }, { signal });
}
