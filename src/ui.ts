import { aiProviderPreset, aiProviderPresets } from './aiProviders';
import { generateMcpBearerToken, type AiActionKey, type AiActionSettings, type AiProviderConfig, type AiSettings, type ArchivedWorkspace, type DocumentCreationType, type McpClientInstallTarget, type McpSettings, type TemplateExtension, type TemplateScope, type Workspace, type WorkspaceFileNode, type WorkspaceTemplateVisibility, type WorkspaceTreeNode } from './backend';
import { colorValueToAlpha, colorValueToPickerHex, getMatchedPaletteId, getMatchedSavedThemeId, getThemeColorLabel, HVY_PALETTES, mergeAlphaIntoCssColor, mergePickerHexIntoCssColor, THEME_COLOR_NAMES } from './colorTheme';
import { currentDocumentWorkspacePath, getFileActionAvailability } from './fileActions';
import type { HvyMode } from './hvy';
import type { AppState, WorkspaceClipboardState, WorkspaceFilterState } from './state';
import { mergeSavedTemplates, templatesForDocumentType, workspaceTemplateVisibility } from './templates';
import appIconUrl from '../src-tauri/icons/Square310x310Logo.png';
import ufoLogoUrl from './assets/ufo-no-bg.svg';
import type { HvyDocumentSearchMode, SearchFilterMode } from '../../heavy-file-format/src/search/types';

export interface UiHandlers {
  newWorkspace(): void;
  openWorkspaceManager(): void;
  closeWorkspaceManager(): void;
  renameWorkspace(path: string, name: string): void;
  archiveWorkspace(path: string): void;
  unarchiveWorkspace(path: string): void;
  toggleWorkspaceActions(path: string): void;
  closeWorkspaceActions(): void;
  createWorkspace(name: string, location: 'managed' | 'choose'): void;
  setNewWorkspaceLocation(location: 'managed' | 'choose'): void;
  cancelNewWorkspace(): void;
  newDocumentInWorkspace(workspacePath: string): void;
  setNewDocumentType(type: DocumentCreationType): void;
  createDocumentInWorkspace(name: string, templateId: string): void;
  cancelNewDocument(): void;
  openImportInWorkspace(workspacePath: string): void;
  setImportDocumentType(type: DocumentCreationType): void;
  openImportIntoCurrent(): void;
  setImportSourceTab(tab: 'workspace' | 'anywhere'): void;
  selectImportWorkspaceSource(path: string): void;
  chooseImportSource(): void;
  createImportedDocument(name: string, templateId: string, instructions: string, pastedSourceText: string): void;
  importIntoCurrent(instructions: string, pastedSourceText: string): void;
  cancelImport(): void;
  addFilesToWorkspace(workspacePath: string): void;
  addDroppedFilesToWorkspace(workspacePath: string, files: File[]): void;
  openWorkspaceFilter(workspacePath: string): void;
  closeWorkspaceFilter(): void;
  setWorkspaceFilterMode(mode: HvyDocumentSearchMode): void;
  setWorkspaceFilterBehavior(mode: SearchFilterMode): void;
  updateWorkspaceFilterQuery(query: string): void;
  submitWorkspaceFilter(): void;
  clearWorkspaceFilter(): void;
  openAbout(): void;
  closeAbout(): void;
  openAiSettings(): void;
  selectAiProvider(providerId: string, settings: AiSettings): void;
  openProviderDocs(url: string): void;
  saveAiSettings(settings: AiSettings): void;
  cancelAiSettings(settings?: AiSettings): void;
  openMcpSettings(): void;
  saveMcpSettings(settings: McpSettings): void;
  cancelMcpSettings(settings?: McpSettings): void;
  startMcpServer(): void;
  stopMcpServer(): void;
  restartMcpServer(): void;
  installMcpClient(target: McpClientInstallTarget): void;
  removeMcpClient(target: McpClientInstallTarget): void;
  restoreMcpClientBackup(target: McpClientInstallTarget): void;
  copyMcpConnectionUrl(url: string): void;
  copyMcpBearerToken(token: string): void;
  copyMcpSetupValue(value: string, label: string): void;
  openColorTheme(): void;
  closeColorTheme(): void;
  updateColorThemeName(name: string): void;
  saveColorTheme(): void;
  exportColorTheme(): void;
  importColorTheme(): void;
  selectColorTheme(id: string): void;
  deleteColorTheme(id: string): void;
  updateColorTheme(name: string, value: string): void;
  resetColorTheme(name: string): void;
  applyColorThemePalette(id: string | null): void;
  restoreBackup(id: string): void;
  discardBackup(id: string): void;
  cancelRecovery(): void;
  cancelCloseDocument(): void;
  closeDocumentWithoutSaving(): void;
  discardCloseDocumentDraft(): void;
  reviewCloseDocumentLater(): void;
  saveAndCloseApp(): void;
  closeAppWithoutSaving(): void;
  cancelAppClose(): void;
  selectDocumentTab(path: string): void;
  closeDocumentTab(path: string): void;
  cycleTabStack(direction: 1 | -1): void;
  commitTabStack(): void;
  cancelTabStack(): void;
  openWorkspace(): void;
  openFile(): void;
  openRecentWorkspace(path: string): void;
  openRecentFile(path: string): void;
  selectFile(path: string): void;
  refreshWorkspace(path: string): void;
  showFileInFolder(path: string): void;
  renameFile(path: string, currentName: string): void;
  copyWorkspaceFile(path: string, currentName: string): void;
  cutWorkspaceFile(path: string, currentName: string): void;
  pasteWorkspaceClipboard(workspacePath: string): void;
  copyFileToWorkspace(path: string, currentName: string): void;
  moveFileToWorkspace(path: string, currentName: string): void;
  submitRenameFile(name: string): void;
  cancelRenameFile(): void;
  saveCurrentToWorkspace(): void;
  submitWorkspaceTransfer(workspacePath: string, name: string): void;
  cancelWorkspaceTransfer(): void;
  setMode(mode: HvyMode): void;
  openDocumentMeta(): void;
  save(): void;
  saveAs(): void;
  closeDocument(): void;
  saveAndCloseDocument(): void;
  openSaveTemplate(): void;
  exportPdf(): void;
  saveBeforeExportPdf(): void;
  cancelExportPdfSavePrompt(): void;
  setSaveTemplateScope(scope: TemplateScope): void;
  saveAsTemplate(name: string, scope: TemplateScope, extension: TemplateExtension): void;
  cancelSaveTemplate(): void;
  openWorkspaceTemplateVisibility(workspacePath: string): void;
  saveWorkspaceTemplateVisibility(workspacePath: string, visibility: WorkspaceTemplateVisibility): void;
  cancelWorkspaceTemplateVisibility(): void;
  createFile(): void;
}

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('Missing #app root.');
}

const appRoot = app;
let bindController: AbortController | null = null;
let activeFileContextMenuCleanup: (() => void) | null = null;
let dismissBackdropPointerStart: HTMLElement | null = null;
let workspaceSidebarWidth = 320;
const MIN_PASTED_IMPORT_CHARS = 50;
const MIN_WORKSPACE_SIDEBAR_WIDTH = 240;
const MAX_WORKSPACE_SIDEBAR_WIDTH = 560;

export function render(state: AppState, handlers: UiHandlers, options: { preserveMount?: HTMLElement | null } = {}): HTMLElement {
  appRoot.innerHTML = `
    <main class="app-shell">
      <aside class="workspace-sidebar">
        <div class="sidebar-header">
          <div class="brand-lockup">
            <img class="brand-logo" src="${ufoLogoUrl}" alt="" aria-hidden="true" />
            <h1>HVY Galaxy</h1>
          </div>
          <button type="button" class="icon-button" data-action="create-file" title="New HVY document">+</button>
        </div>
        <div class="sidebar-actions">
          <button type="button" data-action="open-file">Open File</button>
        </div>
        <section class="workspaces-section">
          <div class="sidebar-section-heading">
            <h2>Workspaces</h2>
            <button type="button" class="icon-button workspace-manage-trigger" data-action="manage-workspaces" title="Manage workspaces" aria-label="Manage workspaces">${gearIcon()}</button>
            <button type="button" class="icon-button workspace-new-trigger" data-action="new-workspace" title="New workspace" aria-label="New workspace">+</button>
          </div>
          ${renderWorkspaces(state)}
        </section>
        <div class="workspace-sidebar-resizer" role="separator" aria-orientation="vertical" aria-label="Resize workspaces pane"></div>
      </aside>
      <section class="document-shell">
        ${renderDocumentTabs(state)}
        <header class="document-toolbar">
          ${renderToolbar(state)}
        </header>
        <div class="error-slot${state.error ? ' has-error' : ''}">${state.error ? escapeHtml(state.error) : ''}</div>
        <div class="document-stage">
          ${state.document ? renderModeControls(state.document.mode, state.document.readOnly, state.document.metaOpen) : ''}
          <div id="hvyMount" class="document-host${state.document ? ' hvy-vscode-has-mode-controls' : ''}">
            ${renderEmptyState(state)}
          </div>
        </div>
      </section>
      ${renderNewWorkspaceDialog(state)}
      ${renderWorkspaceManagerDialog(state)}
      ${renderNewDocumentDialog(state)}
      ${renderImportDialog(state)}
      ${renderImportProgressDialog(state)}
      ${renderExportDialog(state)}
      ${renderExportPdfSavePrompt(state)}
      ${renderWorkspaceTemplateVisibilityDialog(state)}
      ${renderAboutDialog(state)}
      ${renderAiSettingsDialog(state)}
      ${renderMcpSettingsDialog(state)}
      ${renderColorThemeDialog(state)}
      ${renderRecoveryDialog(state)}
      ${renderTabStackPopover(state)}
      ${renderCloseDocumentDialog(state)}
      ${renderCloseDocumentDraftDialog(state)}
      ${renderAppCloseDialog(state)}
      ${renderRenameFileDialog(state)}
      ${renderWorkspaceTransferDialog(state)}
      ${renderWorkspaceFilterDialog(state.workspaceFilter, state.workspaces, state.workspaceFilters)}
    </main>`;
  applyWorkspaceSidebarWidth(appRoot);

  const nextMount = appRoot.querySelector<HTMLElement>('#hvyMount')!;
  if (options.preserveMount && state.document) {
    nextMount.replaceWith(options.preserveMount);
  }
  bind(appRoot, handlers, state);
  return options.preserveMount && state.document ? options.preserveMount : nextMount;
}

function bind(root: HTMLElement, handlers: UiHandlers, state: AppState): void {
  bindController?.abort();
  bindController = new AbortController();
  const { signal } = bindController;
  bindWorkspaceSidebarResize(root, signal);
  document.addEventListener('keydown', (event) => {
    handleApplicationShortcut(event, root, handlers);
  }, { signal, capture: true });
  document.addEventListener('keyup', (event) => {
    if (!state.tabStackOpen) return;
    if (event.key === 'Meta' || event.key === 'Control') {
      event.preventDefault();
      handlers.commitTabStack();
    }
  }, { signal, capture: true });
  root.addEventListener('pointerdown', (event) => {
    dismissBackdropPointerStart = dismissBackdropFromTarget(event.target);
  }, { signal, capture: true });
  root.addEventListener('click', (event) => {
    const clickedDismissBackdrop = dismissBackdropFromTarget(event.target);
    const dismissBackdropClick = Boolean(clickedDismissBackdrop && clickedDismissBackdrop === dismissBackdropPointerStart);
    dismissBackdropPointerStart = null;
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target) {
      const backdrop = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('.modal-backdrop') : null;
      if (backdrop && backdrop === event.target && dismissBackdropClick) {
        if (backdrop.querySelector('.about-dialog')) {
          handlers.closeAbout();
          return;
        }
        if (backdrop.querySelector('.workspace-manager-dialog')) {
          handlers.closeWorkspaceManager();
          return;
        }
        if (backdrop.querySelector('.color-theme-dialog')) {
          handlers.closeColorTheme();
          return;
        }
        const mcpSettingsForm = backdrop.querySelector<HTMLFormElement>('form[data-form="mcp-settings"]');
        if (mcpSettingsForm) {
          handlers.cancelMcpSettings(readMcpSettingsForm(new FormData(mcpSettingsForm)));
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
        if (backdrop.querySelector('.app-close-dialog')) {
          handlers.cancelAppClose();
          return;
        }
        if (backdrop.querySelector('form[data-form="rename-file"]')) {
          handlers.cancelRenameFile();
          return;
        }
        if (backdrop.querySelector('form[data-form="workspace-transfer"]')) {
          handlers.cancelWorkspaceTransfer();
          return;
        }
        const aiSettingsForm = backdrop.querySelector<HTMLFormElement>('form[data-form="ai-settings"]');
        if (aiSettingsForm) {
          handlers.cancelAiSettings(readAiSettingsForm(new FormData(aiSettingsForm)));
          return;
        }
      }
      if (!(event.target as HTMLElement).closest('.workspace-actions-menu')) {
        handlers.closeWorkspaceActions();
      }
      return;
    }
    if (target.closest('#hvyMount')) return;
    if (target instanceof HTMLButtonElement && target.disabled) return;
    const action = target.dataset.action;
    if (action === 'close-workspace-filter' && clickedDismissBackdrop && !dismissBackdropClick) return;
    if (action === 'new-workspace') handlers.newWorkspace();
    if (action === 'manage-workspaces') handlers.openWorkspaceManager();
    if (action === 'close-workspace-manager') handlers.closeWorkspaceManager();
    if (action === 'show-workspace-in-folder' && target.dataset.workspacePath) handlers.showFileInFolder(target.dataset.workspacePath);
    if (action === 'archive-workspace' && target.dataset.workspacePath) handlers.archiveWorkspace(target.dataset.workspacePath);
    if (action === 'unarchive-workspace' && target.dataset.workspacePath) handlers.unarchiveWorkspace(target.dataset.workspacePath);
    if (action === 'toggle-workspace-actions' && target.dataset.workspacePath) {
      event.preventDefault();
      event.stopPropagation();
      handlers.toggleWorkspaceActions(target.dataset.workspacePath);
    }
    if (action === 'set-new-workspace-location' && isNewWorkspaceLocation(target.dataset.location)) {
      handlers.setNewWorkspaceLocation(target.dataset.location);
    }
    if (action === 'cancel-new-workspace') handlers.cancelNewWorkspace();
    if (action === 'new-document-in-workspace' && target.dataset.workspacePath) handlers.newDocumentInWorkspace(target.dataset.workspacePath);
    if (action === 'set-new-document-type' && isDocumentCreationType(target.dataset.documentType)) handlers.setNewDocumentType(target.dataset.documentType);
    if (action === 'import-in-workspace' && target.dataset.workspacePath) handlers.openImportInWorkspace(target.dataset.workspacePath);
    if (action === 'set-import-document-type' && isDocumentCreationType(target.dataset.documentType)) handlers.setImportDocumentType(target.dataset.documentType);
    if (action === 'add-files-to-workspace' && target.dataset.workspacePath) handlers.addFilesToWorkspace(target.dataset.workspacePath);
    if (action === 'workspace-template-visibility' && target.dataset.workspacePath) handlers.openWorkspaceTemplateVisibility(target.dataset.workspacePath);
    if (action === 'open-workspace-filter' && target.dataset.workspacePath) handlers.openWorkspaceFilter(target.dataset.workspacePath);
    if (action === 'close-workspace-filter') handlers.closeWorkspaceFilter();
    if (action === 'set-workspace-filter-mode' && isWorkspaceFilterMode(target.dataset.filterMode)) handlers.setWorkspaceFilterMode(target.dataset.filterMode);
    if (action === 'set-workspace-filter-behavior' && isWorkspaceFilterBehavior(target.dataset.filterBehavior)) handlers.setWorkspaceFilterBehavior(target.dataset.filterBehavior);
    if (action === 'clear-workspace-filter') handlers.clearWorkspaceFilter();
    if (action === 'cancel-new-document') handlers.cancelNewDocument();
    if (action === 'about') handlers.openAbout();
    if (action === 'close-about') handlers.closeAbout();
    if (action === 'ai-settings') handlers.openAiSettings();
    if (action === 'select-ai-provider' && target.dataset.providerId) {
      const form = target.closest<HTMLFormElement>('form[data-form="ai-settings"]');
      const settings = form ? readAiSettingsForm(new FormData(form)) : undefined;
      if (settings) handlers.selectAiProvider(target.dataset.providerId, settings);
    }
    if (action === 'provider-docs') {
      const url = target.dataset.url;
      if (url) handlers.openProviderDocs(url);
    }
    if (action === 'cancel-ai-settings') {
      const form = target.closest<HTMLFormElement>('form[data-form="ai-settings"]');
      handlers.cancelAiSettings(form ? readAiSettingsForm(new FormData(form)) : undefined);
    }
    if (action === 'mcp-settings') handlers.openMcpSettings();
    if (action === 'cancel-mcp-settings') {
      const form = target.closest<HTMLFormElement>('form[data-form="mcp-settings"]');
      handlers.cancelMcpSettings(form ? readMcpSettingsForm(new FormData(form)) : undefined);
    }
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
    if (action === 'restore-backup' && target.dataset.backupId) handlers.restoreBackup(target.dataset.backupId);
    if (action === 'discard-backup' && target.dataset.backupId) handlers.discardBackup(target.dataset.backupId);
    if (action === 'cancel-recovery') handlers.cancelRecovery();
    if (action === 'cancel-rename-file') handlers.cancelRenameFile();
    if (action === 'cancel-workspace-transfer') handlers.cancelWorkspaceTransfer();
    if (action === 'open-workspace') handlers.openWorkspace();
    if (action === 'open-file') handlers.openFile();
    if (action === 'set-mode' && isHvyMode(target.dataset.mode)) handlers.setMode(target.dataset.mode);
    if (action === 'open-document-meta') handlers.openDocumentMeta();
    if (action === 'save') handlers.save();
    if (action === 'save-as') handlers.saveAs();
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
    if (action === 'save-and-close-app') handlers.saveAndCloseApp();
    if (action === 'close-app-without-saving') handlers.closeAppWithoutSaving();
    if (action === 'cancel-app-close') handlers.cancelAppClose();
    if (action === 'save-to-workspace') handlers.saveCurrentToWorkspace();
    if (action === 'import-into-current') handlers.openImportIntoCurrent();
    if (action === 'set-import-source-tab' && isImportSourceTab(target.dataset.tab)) handlers.setImportSourceTab(target.dataset.tab);
    if (action === 'choose-import-source') handlers.chooseImportSource();
    if (action === 'cancel-import') handlers.cancelImport();
    if (action === 'export-pdf') handlers.exportPdf();
    if (action === 'save-template') handlers.openSaveTemplate();
    if (action === 'cancel-export') handlers.cancelSaveTemplate();
    if (action === 'save-before-export-pdf') handlers.saveBeforeExportPdf();
    if (action === 'cancel-export-pdf-save-prompt') handlers.cancelExportPdfSavePrompt();
    if (action === 'cancel-workspace-template-visibility') handlers.cancelWorkspaceTemplateVisibility();
    if (action === 'save-filter-file-visibility') {
      const form = target.closest<HTMLFormElement>('form[data-form="workspace-filter"]');
      if (form) {
        handlers.saveWorkspaceTemplateVisibility(String(form.dataset.workspacePath ?? ''), readWorkspaceTemplateVisibilityForm(new FormData(form)));
      }
    }
    if (action === 'set-save-template-scope' && isTemplateScope(target.dataset.scope)) handlers.setSaveTemplateScope(target.dataset.scope);
    if (action === 'create-file') handlers.createFile();
    if (action === 'select-file' && target.dataset.path) handlers.selectFile(target.dataset.path);
  }, { signal });
  root.addEventListener('dragover', (event) => {
    const workspaceRoot = workspaceRootFromEvent(event);
    if (!workspaceRoot || !hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'copy';
    workspaceRoot.classList.add('is-drag-over');
  }, { signal });
  root.addEventListener('dragleave', (event) => {
    const workspaceRoot = workspaceRootFromEvent(event);
    const relatedTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (!workspaceRoot || (relatedTarget && workspaceRoot.contains(relatedTarget))) return;
    workspaceRoot.classList.remove('is-drag-over');
  }, { signal });
  root.addEventListener('drop', (event) => {
    const workspaceRoot = workspaceRootFromEvent(event);
    const workspacePath = workspaceRoot?.dataset.workspacePath;
    if (!workspaceRoot || !workspacePath || !event.dataTransfer?.files.length) return;
    event.preventDefault();
    workspaceRoot.classList.remove('is-drag-over');
    handlers.addDroppedFilesToWorkspace(workspacePath, Array.from(event.dataTransfer.files));
  }, { signal });
  root.addEventListener('input', (event) => {
    const target = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ? event.target : null;
    const field = target?.dataset.field;
    if (!target || !field || target.closest('#hvyMount')) return;
    if (field === 'workspace-filter-query') {
      handlers.updateWorkspaceFilterQuery(target.value);
      const form = target.closest<HTMLFormElement>('form[data-form="workspace-filter"]');
      if (form) updateWorkspaceFilterSubmit(form);
      return;
    }
    if (field === 'import-source-text') {
      const form = target.closest<HTMLFormElement>('form[data-form="import-document"], form[data-form="import-current"]');
      if (form) updateImportSubmit(form);
      return;
    }
    if (field === 'mcp-port' || field === 'mcp-token') {
      const form = target.closest<HTMLFormElement>('form[data-form="mcp-settings"]');
      if (form) {
        updateMcpConnectionPreview(form);
        updateMcpUrlPreview(form);
      }
      return;
    }
    if (field === 'theme-color-filter') {
      const dialog = target.closest<HTMLElement>('.color-theme-dialog');
      const filter = target.value.trim().toLowerCase();
      dialog?.querySelectorAll<HTMLElement>('.theme-color-row').forEach((row) => {
        row.hidden = filter.length > 0 && !(row.dataset.themeSearch ?? '').includes(filter);
      });
      return;
    }
    if (field === 'theme-name') {
      handlers.updateColorThemeName(target.value);
      return;
    }
    if (field !== 'theme-color-picker' && field !== 'theme-color-value' && field !== 'theme-color-alpha') return;
    const name = target.dataset.colorName ?? '';
    if (!name) return;
    const row = target.closest<HTMLElement>('.theme-color-row');
    const valueInput = row?.querySelector<HTMLInputElement>('[data-field="theme-color-value"]');
    const pickerInput = row?.querySelector<HTMLInputElement>('[data-field="theme-color-picker"]');
    let nextValue = target.value;
    if (field === 'theme-color-picker') {
      nextValue = mergePickerHexIntoCssColor(target.value, valueInput?.value ?? '');
      if (valueInput) valueInput.value = nextValue;
    }
    if (field === 'theme-color-value' && pickerInput) {
      pickerInput.value = colorValueToPickerHex(target.value);
    }
    if (field === 'theme-color-alpha') {
      nextValue = mergeAlphaIntoCssColor(valueInput?.value ?? '', Number.parseFloat(target.value));
      if (valueInput) valueInput.value = nextValue;
      if (pickerInput) pickerInput.value = colorValueToPickerHex(nextValue);
    }
    syncThemeAlphaControl(row, nextValue);
    const overridden = nextValue.trim().length > 0;
    row?.classList.toggle('theme-color-row--override', overridden);
    syncThemeOverrideAction(row, name, overridden);
    handlers.updateColorTheme(name, nextValue);
  }, { signal });
  root.addEventListener('change', (event) => {
    const target = event.target instanceof HTMLSelectElement ? event.target : null;
    if (!target || target.closest('#hvyMount')) return;
    if (target.dataset.field === 'import-workspace-source') {
      handlers.selectImportWorkspaceSource(target.value);
    }
  }, { signal });
  root.addEventListener('contextmenu', (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const fileButton = target?.closest<HTMLButtonElement>('.tree-file');
    const path = fileButton?.dataset.path;
    const name = fileButton?.dataset.name;
    if (fileButton && path && name) {
      const workspacePath = workspacePathForTreeTarget(fileButton, state);
      if (!workspacePath) return;
      event.preventDefault();
      showFileContextMenu(event, path, name, workspacePath, state.workspaceClipboard, handlers, state.workspaces.length > 1);
      return;
    }
    const workspaceSummary = target?.closest<HTMLElement>('.workspace-root > summary');
    const workspacePath = workspaceSummary?.parentElement instanceof HTMLDetailsElement
      ? workspaceSummary.parentElement.dataset.workspacePath
      : null;
    if (!workspaceSummary || !workspacePath) return;
    event.preventDefault();
    showWorkspaceContextMenu(event, workspacePath, state.workspaceClipboard, handlers);
  }, { signal });
  root.addEventListener('mousedown', (event) => {
    if (event.button !== 2) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target?.closest('.tree-file, .tree summary')) return;
    event.preventDefault();
  }, { signal });
  root.addEventListener('click', (event) => {
    const summary = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('.workspace-root > summary') : null;
    const details = summary?.parentElement instanceof HTMLDetailsElement ? summary.parentElement : null;
    const workspacePath = details?.dataset.workspacePath;
    if (!details || !workspacePath || details.open) return;
    window.setTimeout(() => {
      if (details.open) handlers.refreshWorkspace(workspacePath);
    }, 0);
  }, { signal, capture: true });
  root.addEventListener('submit', (event) => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>('form[data-form]');
    if (!form) return;
    if (form.closest('#hvyMount')) return;
    event.preventDefault();
    if (form.dataset.form === 'new-workspace') {
      const data = new FormData(form);
      const location = String(data.get('workspaceLocation') ?? 'managed');
      handlers.createWorkspace(
        String(data.get('workspaceName') ?? ''),
        isNewWorkspaceLocation(location) ? location : 'managed'
      );
    }
    if (form.dataset.form === 'workspace-manager-rename') {
      const data = new FormData(form);
      handlers.renameWorkspace(String(data.get('workspacePath') ?? ''), String(data.get('workspaceName') ?? ''));
    }
    if (form.dataset.form === 'new-document') {
      const data = new FormData(form);
      handlers.createDocumentInWorkspace(
        String(data.get('documentName') ?? ''),
        String(data.get('templateId') ?? '')
      );
    }
    if (form.dataset.form === 'import-document') {
      const data = new FormData(form);
      handlers.createImportedDocument(
        String(data.get('documentName') ?? ''),
        String(data.get('templateId') ?? ''),
        String(data.get('instructions') ?? ''),
        String(data.get('importSourceText') ?? '')
      );
    }
    if (form.dataset.form === 'import-current') {
      const data = new FormData(form);
      handlers.importIntoCurrent(
        String(data.get('instructions') ?? ''),
        String(data.get('importSourceText') ?? '')
      );
    }
    if (form.dataset.form === 'export-document') {
      const data = new FormData(form);
      const scope = String(data.get('scope') ?? 'app');
      const extension = data.get('format');
      handlers.saveAsTemplate(
        String(data.get('templateName') ?? ''),
        isTemplateScope(scope) ? scope : 'app',
        isTemplateExtension(extension) ? extension : '.thvy'
      );
    }
    if (form.dataset.form === 'workspace-template-visibility') {
      const data = new FormData(form);
      handlers.saveWorkspaceTemplateVisibility(String(data.get('workspacePath') ?? ''), readWorkspaceTemplateVisibilityForm(data));
    }
    if (form.dataset.form === 'ai-settings') {
      const data = new FormData(form);
      handlers.saveAiSettings(readAiSettingsForm(data));
    }
    if (form.dataset.form === 'mcp-settings') {
      const data = new FormData(form);
      handlers.saveMcpSettings(readMcpSettingsForm(data));
    }
    if (form.dataset.form === 'workspace-filter') {
      handlers.submitWorkspaceFilter();
    }
    if (form.dataset.form === 'rename-file') {
      const data = new FormData(form);
      handlers.submitRenameFile(String(data.get('fileName') ?? ''));
    }
    if (form.dataset.form === 'workspace-transfer') {
      const data = new FormData(form);
      handlers.submitWorkspaceTransfer(String(data.get('workspacePath') ?? ''), String(data.get('fileName') ?? ''));
    }
  }, { signal });
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && handleWorkspaceClipboardShortcut(event, state, handlers)) {
      return;
    }
    if (event.key !== 'Escape') return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (root.querySelector('.about-dialog')) {
      event.preventDefault();
      handlers.closeAbout();
      return;
    }
    if (root.querySelector('.workspace-manager-dialog')) {
      event.preventDefault();
      handlers.closeWorkspaceManager();
      return;
    }
    if (root.querySelector('.color-theme-dialog')) {
      event.preventDefault();
      handlers.closeColorTheme();
      return;
    }
    const mcpSettingsForm = target?.closest<HTMLFormElement>('form[data-form="mcp-settings"]')
      ?? root.querySelector<HTMLFormElement>('form[data-form="mcp-settings"]');
    if (mcpSettingsForm) {
      event.preventDefault();
      handlers.cancelMcpSettings(readMcpSettingsForm(new FormData(mcpSettingsForm)));
      return;
    }
    if (root.querySelector('.workspace-filter-dialog')) {
      event.preventDefault();
      handlers.closeWorkspaceFilter();
      return;
    }
    if (root.querySelector('form[data-form="rename-file"]')) {
      event.preventDefault();
      handlers.cancelRenameFile();
      return;
    }
    if (root.querySelector('form[data-form="workspace-transfer"]')) {
      event.preventDefault();
      handlers.cancelWorkspaceTransfer();
      return;
    }
    if (root.querySelector('.close-document-dialog')) {
      event.preventDefault();
      handlers.cancelCloseDocument();
      return;
    }
    if (root.querySelector('.app-close-dialog')) {
      event.preventDefault();
      handlers.cancelAppClose();
      return;
    }
    if (root.querySelector('form[data-form="import-document"], form[data-form="import-current"]')) {
      event.preventDefault();
      handlers.cancelImport();
      return;
    }
    if (root.querySelector('form[data-form="export-document"]')) {
      event.preventDefault();
      handlers.cancelSaveTemplate();
      return;
    }
    const form = target?.closest<HTMLFormElement>('form[data-form="ai-settings"]')
      ?? root.querySelector<HTMLFormElement>('form[data-form="ai-settings"]');
    if (!form) return;
    event.preventDefault();
    handlers.cancelAiSettings(readAiSettingsForm(new FormData(form)));
  }, { signal });
  root.querySelectorAll<HTMLFormElement>('form[data-form="new-workspace"]').forEach((form) => {
    updateNewWorkspaceSubmit(form);
    form.addEventListener('input', () => updateNewWorkspaceSubmit(form), { signal });
  });
  root.querySelectorAll<HTMLFormElement>('form[data-form="workspace-filter"]').forEach((form) => {
    updateWorkspaceFilterSubmit(form);
  });
  root.querySelectorAll<HTMLFormElement>('form[data-form="import-document"], form[data-form="import-current"]').forEach((form) => {
    updateImportSubmit(form);
  });
  root.querySelector<HTMLInputElement>('form[data-form="rename-file"] input[name="fileName"]')?.focus();
}

function dismissBackdropFromTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  return target.classList.contains('modal-backdrop') || target.classList.contains('workspace-filter-backdrop')
    ? target
    : null;
}

function handleApplicationShortcut(event: KeyboardEvent, root: HTMLElement, handlers: UiHandlers): boolean {
  if (event.isComposing || event.altKey || event.defaultPrevented) return false;
  if (event.key === 'Escape') {
    handlers.cancelTabStack();
  }
  if (root.querySelector('.modal-backdrop')) return false;

  const key = event.key.toLowerCase();
  const meta = event.metaKey || event.ctrlKey;
  if (!meta) return false;

  if (key === 'p') {
    event.preventDefault();
    handlers.cycleTabStack(event.shiftKey ? -1 : 1);
    return true;
  }
  if (!event.shiftKey && key === 's') {
    event.preventDefault();
    handlers.save();
    return true;
  }
  if (event.shiftKey && key === 's') {
    event.preventDefault();
    handlers.saveAs();
    return true;
  }
  if (!event.shiftKey && key === 'w') {
    event.preventDefault();
    handlers.closeDocument();
    return true;
  }
  if (!event.shiftKey && key === 'n') {
    event.preventDefault();
    handlers.newWorkspace();
    return true;
  }
  if (!event.shiftKey && key === 'o') {
    event.preventDefault();
    handlers.openWorkspace();
    return true;
  }
  if (event.shiftKey && key === 'o') {
    event.preventDefault();
    handlers.openFile();
    return true;
  }
  if (!event.shiftKey && key === ',') {
    event.preventDefault();
    handlers.openAiSettings();
    return true;
  }
  return false;
}

function bindWorkspaceSidebarResize(root: HTMLElement, signal: AbortSignal): void {
  root.querySelector<HTMLElement>('.workspace-sidebar-resizer')?.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const shell = root.querySelector<HTMLElement>('.app-shell');
    const sidebar = root.querySelector<HTMLElement>('.workspace-sidebar');
    if (!shell || !sidebar) return;

    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebar.getBoundingClientRect().width;
    const maxWidth = Math.min(MAX_WORKSPACE_SIDEBAR_WIDTH, Math.max(MIN_WORKSPACE_SIDEBAR_WIDTH, shell.getBoundingClientRect().width - 420));
    sidebar.classList.add('is-resizing');
    sidebar.setPointerCapture(event.pointerId);

    const onMove = (moveEvent: PointerEvent) => {
      workspaceSidebarWidth = Math.round(Math.min(maxWidth, Math.max(MIN_WORKSPACE_SIDEBAR_WIDTH, startWidth + moveEvent.clientX - startX)));
      applyWorkspaceSidebarWidth(root);
    };
    const onEnd = () => {
      sidebar.classList.remove('is-resizing');
      sidebar.releasePointerCapture(event.pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd, { once: true });
    window.addEventListener('pointercancel', onEnd, { once: true });
  }, { signal });
}

function applyWorkspaceSidebarWidth(root: HTMLElement): void {
  root.style.setProperty('--workspace-sidebar-width', `${workspaceSidebarWidth}px`);
}

function handleWorkspaceClipboardShortcut(event: KeyboardEvent, state: AppState, handlers: UiHandlers): boolean {
  const key = event.key.toLowerCase();
  if (key !== 'c' && key !== 'x' && key !== 'v') return false;
  if ((key === 'c' || key === 'x') && hasActiveTextSelection()) return false;
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (target && (target.closest('#hvyMount') || isTextEditingTarget(target))) return false;
  const selectedFile = state.selectedFilePath ? findWorkspaceFileByPath(state.workspaces, state.selectedFilePath) : null;
  if ((key === 'c' || key === 'x') && selectedFile) {
    event.preventDefault();
    if (key === 'c') handlers.copyWorkspaceFile(selectedFile.path, selectedFile.name);
    else handlers.cutWorkspaceFile(selectedFile.path, selectedFile.name);
    return true;
  }
  if (key === 'v') {
    const workspacePath = selectedFile ? workspacePathForFileNode(state.workspaces, selectedFile.path) : state.selectedWorkspacePath;
    if (!workspacePath) return false;
    event.preventDefault();
    handlers.pasteWorkspaceClipboard(workspacePath);
    return true;
  }
  return false;
}

function hasActiveTextSelection(): boolean {
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().length > 0);
}

function isTextEditingTarget(target: HTMLElement): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target.isContentEditable;
}

function workspacePathForTreeTarget(target: HTMLElement, state: AppState): string | null {
  return target.closest<HTMLElement>('.workspace-root')?.dataset.workspacePath
    ?? workspacePathForFileNode(state.workspaces, target.dataset.path ?? '');
}

function workspacePathForFileNode(workspaces: AppState['workspaces'], filePath: string): string | null {
  return workspaces.find((workspace) => filePath.startsWith(workspace.path))?.path ?? null;
}

function findWorkspaceFileByPath(workspaces: AppState['workspaces'], filePath: string): { path: string; name: string } | null {
  for (const workspace of workspaces) {
    const node = findWorkspaceFileNode(workspace.files, filePath);
    if (node) return node;
  }
  return null;
}

function findWorkspaceFileNode(nodes: WorkspaceTreeNode[], filePath: string): { path: string; name: string } | null {
  for (const node of nodes) {
    if (node.kind === 'file' && node.path === filePath) return { path: node.path, name: node.name };
    if (node.kind === 'folder') {
      const match = findWorkspaceFileNode(node.children, filePath);
      if (match) return match;
    }
  }
  return null;
}

function workspaceRootFromEvent(event: Event): HTMLElement | null {
  return event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('.workspace-root') : null;
}

function hasDraggedFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

function renderWorkspaceFilterDialog(filter: WorkspaceFilterState, workspaces: Workspace[], activeFilters: AppState['workspaceFilters']): string {
  if (!filter.open) {
    return '';
  }
  const scopedWorkspace = filter.workspacePath ? workspaces.find((workspace) => workspace.path === filter.workspacePath) ?? null : null;
  const workspaceName = scopedWorkspace?.manifest.name ?? 'workspace';
  const activeFilter = filter.workspacePath ? activeFilters[filter.workspacePath] : null;
  const applied = Boolean(
    activeFilter
      && activeFilter.query.trim() === filter.queryDraft.trim()
      && activeFilter.mode === filter.mode
      && activeFilter.filterMode === filter.filterMode
  );
  const isSemantic = filter.mode === 'semantic';
  const stopSemanticFilter = filter.isLoading && isSemantic;
  const submitLabel = stopSemanticFilter ? 'Stop' : applied ? 'Update filter' : 'Filter';
  const visibility = workspaceTemplateVisibility(scopedWorkspace);
  const status = filter.isLoading
    ? filter.status ?? (isSemantic ? `Analyzing ${workspaceName}...` : `Filtering ${workspaceName}...`)
    : filter.error
    ? filter.error
    : '';
  return `
    <section class="workspace-filter-overlay" aria-label="Workspace filter">
      <div class="workspace-filter-backdrop" data-action="close-workspace-filter"></div>
      <form class="workspace-filter-dialog${isSemantic ? ' is-semantic-mode' : ''}" data-form="workspace-filter" data-workspace-path="${escapeAttr(filter.workspacePath ?? '')}" data-loading="${filter.isLoading ? 'true' : 'false'}" role="dialog" aria-modal="true" aria-label="Filter workspace">
        <div class="search-tabbar">
          <div class="workspace-filter-title">
            ${funnelIcon()}
            <span>Filter ${escapeHtml(workspaceName)}</span>
          </div>
          <button type="button" class="search-close-button ghost remove-x" data-action="close-workspace-filter" aria-label="Close workspace filter">${closeIcon()}</button>
        </div>
        ${renderWorkspaceFilterVisibilityControls(visibility, filter.isLoading)}
        <div class="search-input-row">
          <span class="search-input-icon" aria-hidden="true">${funnelIcon()}</span>
          <label>
            <span>Filter document</span>
            ${isSemantic
              ? `<textarea class="search-input search-prompt-textarea" data-field="workspace-filter-query" placeholder="Describe what should stay visible" rows="4" autofocus>${escapeHtml(filter.queryDraft)}</textarea>`
              : `<input class="search-input" data-field="workspace-filter-query" value="${escapeAttr(filter.queryDraft)}" placeholder="Filter document" autocomplete="off" spellcheck="false" autofocus>`
            }
          </label>
        </div>
        ${status ? `<div class="search-status${filter.error ? ' is-error' : ''}" role="status">${escapeHtml(status)}</div>` : ''}
        <div class="search-filter-box">
          <div class="search-filter-box-head">
            ${funnelIcon()}
            <span>Filter Technique</span>
            ${renderWorkspaceFilterModeButton('semantic', 'Semantic', filter)}
          </div>
          <div class="search-filter-mode-group" role="group" aria-label="Filter behavior">
            ${renderWorkspaceFilterBehaviorButton('deprioritize', 'Shade', filter)}
            ${renderWorkspaceFilterBehaviorButton('hide', 'Hide', filter)}
          </div>
        </div>
        <div class="workspace-filter-actions">
          <button
            type="submit"
            class="secondary${applied ? ' is-active' : ''}"
            data-role="workspace-filter-submit"
            aria-pressed="${applied ? 'true' : 'false'}"
            ${!stopSemanticFilter && (filter.isLoading || filter.queryDraft.trim().length === 0) ? 'disabled' : ''}
          >${submitLabel}</button>
          ${activeFilter ? `<button type="button" class="ghost" data-action="clear-workspace-filter" ${filter.isLoading ? 'disabled' : ''}>Turn off filter</button>` : ''}
        </div>
      </form>
    </section>`;
}

function renderRenameFileDialog(state: AppState): string {
  if (!state.renameFilePath || !state.renameFileCurrentName) {
    return '';
  }
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="dialog" data-form="rename-file">
        <h2>Rename</h2>
        <label>
          <span>Name</span>
          <input name="fileName" type="text" autocomplete="off" value="${escapeAttr(displayDocumentName(state.renameFileCurrentName))}" required>
        </label>
        <div class="dialog-actions">
          <button type="button" data-action="cancel-rename-file">Cancel</button>
          <button type="submit" ${state.busy ? 'disabled' : ''}>Rename</button>
        </div>
      </form>
    </div>`;
}

function renderWorkspaceTransferDialog(state: AppState): string {
  const transfer = state.workspaceTransfer;
  if (!transfer) return '';
  const workspaces = state.workspaces.filter((workspace) => workspace.path !== transfer.excludedWorkspacePath);
  const title = transfer.mode === 'saveCurrent'
    ? 'Save to Workspace'
    : transfer.mode === 'copyFile'
    ? 'Copy to Workspace'
    : 'Move to Workspace';
  const submitLabel = transfer.mode === 'moveFile' ? 'Move' : transfer.mode === 'copyFile' ? 'Copy' : 'Save';
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="dialog" data-form="workspace-transfer">
        <h2>${escapeHtml(title)}</h2>
        <label>
          <span>Workspace</span>
          <select name="workspacePath" required>
            ${workspaces.map((workspace) => `<option value="${escapeAttr(workspace.path)}">${escapeHtml(workspace.manifest.name)}</option>`).join('')}
          </select>
        </label>
        ${transfer.mode === 'saveCurrent' ? `
          <label>
            <span>Name</span>
            <input name="fileName" type="text" autocomplete="off" value="${escapeAttr(transfer.nameDraft)}" required>
          </label>
        ` : ''}
        <p class="dialog-note">${escapeHtml(transfer.fileName)}</p>
        <div class="dialog-actions">
          <button type="button" data-action="cancel-workspace-transfer">Cancel</button>
          <button type="submit" ${state.busy || workspaces.length === 0 ? 'disabled' : ''}>${escapeHtml(submitLabel)}</button>
        </div>
      </form>
    </div>`;
}

function renderWorkspaceFilterModeButton(mode: HvyDocumentSearchMode, label: string, filter: WorkspaceFilterState): string {
  const active = filter.mode === mode;
  return `
    <button
      type="button"
      class="search-tab${active ? ' is-active' : ''}"
      data-action="set-workspace-filter-mode"
      data-filter-mode="${escapeAttr(filter.mode === 'semantic' ? 'keyword' : mode)}"
      aria-pressed="${active ? 'true' : 'false'}"
    >${sparklesIcon()}<span>${escapeHtml(label)}</span></button>`;
}

function renderWorkspaceFilterBehaviorButton(mode: SearchFilterMode, label: string, filter: WorkspaceFilterState): string {
  const active = filter.filterMode === mode;
  return `
    <button
      type="button"
      class="search-filter-mode-button${active ? ' is-active' : ''}"
      data-action="set-workspace-filter-behavior"
      data-filter-behavior="${escapeAttr(mode)}"
      aria-pressed="${active ? 'true' : 'false'}"
    >${escapeHtml(label)}</button>`;
}

function renderWorkspaceFilterVisibilityControls(visibility: WorkspaceTemplateVisibility, disabled: boolean): string {
  return `
    <div class="search-filter-box">
      <div class="search-filter-box-head">
        ${eyeIcon()}
        <span>File Visibility</span>
      </div>
      <div class="workspace-filter-visibility-list">
        <label class="checkbox-row">
          <input type="checkbox" name="hvyDocuments" ${visibility.hvyDocuments ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
          <span>HVY</span>
        </label>
        <label class="checkbox-row">
          <input type="checkbox" name="thvyTemplates" ${visibility.thvyTemplates ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
          <span>THVY</span>
        </label>
        <label class="checkbox-row">
          <input type="checkbox" name="phvyTemplates" ${visibility.phvyTemplates ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
          <span>PHVY</span>
        </label>
      </div>
      <div class="workspace-filter-actions">
        <button type="button" class="secondary" data-action="save-filter-file-visibility" ${disabled ? 'disabled' : ''}>Save visibility</button>
      </div>
    </div>`;
}

function readWorkspaceTemplateVisibilityForm(data: FormData): WorkspaceTemplateVisibility {
  return {
    hvyDocuments: data.has('hvyDocuments'),
    thvyTemplates: data.has('thvyTemplates'),
    phvyTemplates: data.has('phvyTemplates'),
  };
}

function showFileContextMenu(
  event: MouseEvent,
  path: string,
  name: string,
  workspacePath: string,
  clipboard: WorkspaceClipboardState | null,
  handlers: UiHandlers,
  showWorkspaceActions: boolean,
): void {
  void clipboard;
  closeFileContextMenu();
  const menu = document.createElement('div');
  menu.className = 'file-context-menu';
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
  menu.innerHTML = `
    <button type="button" data-menu-action="reveal">${escapeHtml(revealMenuLabel())}</button>
    <button type="button" data-menu-action="rename">Rename</button>
    <button type="button" data-menu-action="copy">Copy</button>
    <button type="button" data-menu-action="cut">Cut</button>
    <button type="button" data-menu-action="paste">Paste</button>
    ${showWorkspaceActions ? '<button type="button" data-menu-action="copy-to-workspace">Copy to...</button><button type="button" data-menu-action="move-to-workspace">Move to...</button>' : ''}
  `;
  const cleanup = () => {
    menu.remove();
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    if (activeFileContextMenuCleanup === cleanup) activeFileContextMenuCleanup = null;
  };
  const onPointerDown = (pointerEvent: PointerEvent) => {
    if (!menu.contains(pointerEvent.target as Node)) cleanup();
  };
  const onKeyDown = (keyEvent: KeyboardEvent) => {
    if (keyEvent.key === 'Escape') cleanup();
  };
  menu.addEventListener('click', (clickEvent) => {
    const button = (clickEvent.target as HTMLElement).closest<HTMLButtonElement>('button[data-menu-action]');
    if (!button) return;
    cleanup();
    if (button.dataset.menuAction === 'reveal') handlers.showFileInFolder(path);
    if (button.dataset.menuAction === 'rename') handlers.renameFile(path, name);
    if (button.dataset.menuAction === 'copy') handlers.copyWorkspaceFile(path, name);
    if (button.dataset.menuAction === 'cut') handlers.cutWorkspaceFile(path, name);
    if (button.dataset.menuAction === 'paste') handlers.pasteWorkspaceClipboard(workspacePath);
    if (button.dataset.menuAction === 'copy-to-workspace') handlers.copyFileToWorkspace(path, name);
    if (button.dataset.menuAction === 'move-to-workspace') handlers.moveFileToWorkspace(path, name);
  });
  document.body.append(menu);
  activeFileContextMenuCleanup = cleanup;
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    const left = Math.min(event.clientX, window.innerWidth - rect.width - 8);
    const top = Math.min(event.clientY, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
  });
}

function showWorkspaceContextMenu(
  event: MouseEvent,
  workspacePath: string,
  clipboard: WorkspaceClipboardState | null,
  handlers: UiHandlers,
): void {
  closeFileContextMenu();
  const menu = document.createElement('div');
  menu.className = 'file-context-menu';
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
  void clipboard;
  menu.innerHTML = `
    <button type="button" data-menu-action="paste">Paste</button>
    <button type="button" data-menu-action="template-visibility">Template Visibility</button>
  `;
  const cleanup = () => {
    menu.remove();
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    if (activeFileContextMenuCleanup === cleanup) activeFileContextMenuCleanup = null;
  };
  const onPointerDown = (pointerEvent: PointerEvent) => {
    if (!menu.contains(pointerEvent.target as Node)) cleanup();
  };
  const onKeyDown = (keyEvent: KeyboardEvent) => {
    if (keyEvent.key === 'Escape') cleanup();
  };
  menu.addEventListener('click', (clickEvent) => {
    const button = (clickEvent.target as HTMLElement).closest<HTMLButtonElement>('button[data-menu-action]');
    if (!button || button.disabled) return;
    cleanup();
    if (button.dataset.menuAction === 'paste') handlers.pasteWorkspaceClipboard(workspacePath);
    if (button.dataset.menuAction === 'template-visibility') handlers.openWorkspaceTemplateVisibility(workspacePath);
  });
  document.body.append(menu);
  activeFileContextMenuCleanup = cleanup;
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    const left = Math.min(event.clientX, window.innerWidth - rect.width - 8);
    const top = Math.min(event.clientY, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
  });
}

function closeFileContextMenu(): void {
  activeFileContextMenuCleanup?.();
  document.querySelector('.file-context-menu')?.remove();
}

function revealMenuLabel(): string {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes('mac')) return 'Show in Finder';
  if (platform.includes('win')) return 'Open in Explorer';
  return 'Open Containing Folder';
}

function renderDocumentTabs(state: AppState): string {
  return `
    <nav class="document-tabs${state.documentTabs.length === 0 ? ' is-empty' : ''}" aria-label="Open documents">
      ${state.documentTabs.map((tab) => `
        <div class="document-tab${tab.active ? ' is-active' : ''}${tab.dirty ? ' is-dirty' : ''}${tab.readOnly ? ' is-read-only' : ''}">
          <button type="button" class="document-tab-main" data-action="select-document-tab" data-path="${escapeAttr(tab.path)}" title="${escapeAttr(tab.path)}" aria-current="${tab.active ? 'page' : 'false'}">
            <span class="document-tab-dirty" aria-hidden="true"></span>
            <span class="document-tab-name">${escapeHtml(tab.name)}</span>
          </button>
          <button type="button" class="document-tab-close" data-action="close-document-tab" data-path="${escapeAttr(tab.path)}" title="Close ${escapeAttr(tab.name)}" aria-label="Close ${escapeAttr(tab.name)}">&times;</button>
        </div>
      `).join('')}
    </nav>`;
}

function renderTabStackPopover(state: AppState): string {
  if (!state.tabStackOpen || state.documentTabs.length === 0) {
    return '';
  }
  const activeIndex = ((state.tabStackIndex % state.documentTabs.length) + state.documentTabs.length) % state.documentTabs.length;
  return `
    <div class="tab-stack-popover" role="listbox" aria-label="Open documents">
      ${state.documentTabs.map((tab, index) => `
        <button type="button" class="tab-stack-item${index === activeIndex ? ' is-selected' : ''}${tab.dirty ? ' is-dirty' : ''}" role="option" aria-selected="${index === activeIndex ? 'true' : 'false'}" data-action="select-tab-stack-item" data-path="${escapeAttr(tab.path)}">
          <span class="tab-stack-dirty" aria-hidden="true"></span>
          <span>${escapeHtml(tab.name)}</span>
        </button>
      `).join('')}
    </div>`;
}

function renderToolbar(state: AppState): string {
  const document = state.document;
  if (!document) {
    return `
      <div class="toolbar-title">No document selected</div>
      <div class="toolbar-actions"></div>`;
  }
  const dirtyState = document.readOnly ? 'read-only' : document.dirty ? 'dirty' : 'clean';
  const dirtyLabel = document.readOnly ? 'Read only' : document.dirty ? 'Unsaved' : 'Saved';
  const fileActions = getFileActionAvailability(state);
  const showExportPdf = document.extension === '.phvy';
  return `
    <div class="toolbar-title">
      <strong title="${escapeAttr(document.path)}">${escapeHtml(document.name)}</strong>
      <span>${document.readOnly ? 'Read-only guide' : document.isNew ? 'Unsaved document' : 'Document'}</span>
    </div>
    <div class="toolbar-actions">
      <span class="dirty-indicator" data-state="${dirtyState}">${dirtyLabel}</span>
      ${fileActions.saveToWorkspace ? '<button type="button" data-action="save-to-workspace">Save to Workspace</button>' : ''}
      <button type="button" data-action="import-into-current" ${fileActions.importCurrent ? '' : 'disabled'}>Import</button>
      ${showExportPdf ? `<button type="button" data-action="export-pdf" ${fileActions.exportPdf ? '' : 'disabled'}>Export PDF</button>` : ''}
      <button type="button" data-action="save-template" ${fileActions.saveTemplate ? '' : 'disabled'}>Save as Template</button>
      <button type="button" data-action="close-document">Close</button>
    </div>`;
}

function renderModeControls(activeMode: HvyMode, readOnly: boolean, metaOpen: boolean): string {
  const modes: Array<{ mode: HvyMode; label: string }> = [
    { mode: 'viewer', label: 'Viewer' },
    { mode: 'ai', label: 'AI' },
    { mode: 'editor', label: 'Editor' },
    { mode: 'hvy', label: 'HVY' },
    { mode: 'advanced', label: 'Advanced' },
  ];
  const showEditorSubmodes = activeMode === 'editor' || activeMode === 'hvy' || activeMode === 'advanced';
  const buttonHtml = ({ mode, label }: { mode: HvyMode; label: string }) => {
    const active = mode === activeMode && !(metaOpen && mode === 'advanced') ? ' is-active' : '';
    const disabled = readOnly && mode !== 'viewer' ? ' disabled' : '';
    const contents = mode === 'advanced' || mode === 'hvy'
      ? `<span>${escapeHtml(mode === 'advanced' ? 'ADV' : 'HVY')}</span>`
      : `${modeIcon(mode)}<span>${escapeHtml(label)}</span>`;
    return `<button type="button" class="mode-button${active}" data-action="set-mode" data-mode="${mode}" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}" aria-pressed="${active ? 'true' : 'false'}"${disabled}>${contents}</button>`;
  };
  return `
    <nav class="mode-controls${showEditorSubmodes ? ' is-editor-enabled' : ''}" aria-label="HVY editor mode">
      ${showEditorSubmodes ? `<div class="mode-editor-submodes">${buttonHtml(modes[3])}${buttonHtml(modes[4])}<button type="button" class="mode-button mode-button-meta${metaOpen ? ' is-active' : ''}" data-action="open-document-meta" title="Document Meta" aria-label="Document Meta" aria-pressed="${metaOpen ? 'true' : 'false'}"${readOnly ? ' disabled' : ''}><span>Meta</span></button></div>` : ''}
      <div class="mode-primary-controls">
        ${buttonHtml(modes[2])}
        ${buttonHtml(modes[1])}
        ${buttonHtml(modes[0])}
      </div>
    </nav>`;
}

function modeIcon(mode: HvyMode): string {
  if (mode === 'viewer') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>';
  }
  if (mode === 'ai') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z"/><path d="M19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z"/></svg>';
  }
  if (mode === 'editor') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/></svg>';
  }
  return '';
}

function sparklesIcon(): string {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z"/><path d="M19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z"/></svg>';
}

function funnelIcon(): string {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18l-7 8v5l-4 2v-7L3 5Z"/></svg>';
}

function closeIcon(): string {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
}

function eyeIcon(): string {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>';
}

function eyeOffIcon(): string {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.4 5.4A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a18.5 18.5 0 0 1-3.1 4.1"/><path d="M6.6 6.6C3.6 8.5 2 12 2 12s3.5 7 10 7c1.4 0 2.7-.3 3.9-.9"/></svg>';
}

function copyIcon(): string {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
}

function gearIcon(): string {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 1 1 4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.3 7A2 2 0 1 1 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 .9-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6.9h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z"/></svg>';
}

function renderWorkspaces(state: AppState): string {
  if (state.workspaces.length === 0) {
    return '<div class="empty-panel">Open or create a workspace to browse HVY files.</div>';
  }
  return `<div class="tree-list">${state.workspaces.map((workspace) => renderWorkspace(workspace, state.selectedFilePath, state.openWorkspaceActionsPath, state.workspaceFilters, state.workspaceClipboard)).join('')}</div>`;
}

function renderWorkspaceManagerDialog(state: AppState): string {
  if (!state.workspaceManagerOpen) {
    return '';
  }
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog wide-dialog workspace-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="workspaceManagerTitle">
        <h2 id="workspaceManagerTitle">Manage Workspaces</h2>
        <div class="workspace-manager-section">
          <h3>Open</h3>
          <div class="workspace-manager-list">
            ${state.workspaces.length === 0 ? '<div class="empty-panel compact">No open workspaces.</div>' : state.workspaces.map(renderWorkspaceManagerRow).join('')}
          </div>
        </div>
        <div class="workspace-manager-section">
          <h3>Archived</h3>
          <div class="workspace-manager-list">
            ${state.archivedWorkspaces.length === 0 ? '<div class="empty-panel compact">No archived workspaces.</div>' : state.archivedWorkspaces.map(renderArchivedWorkspaceRow).join('')}
          </div>
        </div>
        <div class="dialog-actions">
          <button type="button" data-action="close-workspace-manager">Done</button>
        </div>
      </section>
    </div>`;
}

function renderWorkspaceManagerRow(workspace: Workspace): string {
  return `
    <form class="workspace-manager-row" data-form="workspace-manager-rename">
      <input name="workspacePath" type="hidden" value="${escapeAttr(workspace.path)}">
      <label>
        <span>Name</span>
        <input name="workspaceName" type="text" autocomplete="off" value="${escapeAttr(workspace.manifest.name)}" required>
      </label>
      <div class="workspace-manager-location">
        <span>Location</span>
        <code title="${escapeAttr(workspace.path)}">${escapeHtml(workspace.path)}</code>
      </div>
      <div class="workspace-manager-actions">
        <button type="submit">Save</button>
        <button type="button" data-action="show-workspace-in-folder" data-workspace-path="${escapeAttr(workspace.path)}">${escapeHtml(revealMenuLabel())}</button>
        <button type="button" class="danger-button" data-action="archive-workspace" data-workspace-path="${escapeAttr(workspace.path)}">Archive</button>
      </div>
    </form>`;
}

function renderArchivedWorkspaceRow(workspace: ArchivedWorkspace): string {
  return `
    <div class="workspace-manager-row workspace-manager-row-archived">
      <div class="workspace-manager-name">
        <span>Name</span>
        <strong>${escapeHtml(workspace.name)}</strong>
      </div>
      <div class="workspace-manager-location">
        <span>Location</span>
        <code title="${escapeAttr(workspace.path)}">${escapeHtml(workspace.path)}</code>
      </div>
      <div class="workspace-manager-actions">
        <button type="button" data-action="unarchive-workspace" data-workspace-path="${escapeAttr(workspace.path)}">Unarchive</button>
        <button type="button" data-action="show-workspace-in-folder" data-workspace-path="${escapeAttr(workspace.path)}">${escapeHtml(revealMenuLabel())}</button>
      </div>
    </div>`;
}

function renderWorkspace(
  workspace: Workspace,
  selectedFilePath: string | null,
  openWorkspaceActionsPath: string | null,
  activeFilters: AppState['workspaceFilters'],
  workspaceClipboard: WorkspaceClipboardState | null,
): string {
  const actionsOpen = workspace.path === openWorkspaceActionsPath;
  const filter = activeFilters[workspace.path];
  const matchedDocumentIds = filter
    ? new Set(Object.entries(filter.snapshots).flatMap(([documentId, snapshot]) => snapshot.results.length > 0 ? [documentId] : []))
    : null;
  const filterTitle = filter
    ? `Filter ${workspace.manifest.name}: ${filter.query}`
    : `Filter ${workspace.manifest.name}`;
  const visibleFiles = filterNodesByTemplateVisibility(workspace.files, workspaceTemplateVisibility(workspace));
  return `
    <details class="workspace-root" data-workspace-path="${escapeAttr(workspace.path)}" open>
      <summary title="${escapeAttr(workspace.path)}">
        <span>${escapeHtml(workspace.manifest.name)}</span>
      </summary>
      <button type="button" class="workspace-filter-trigger${filter ? ' is-active' : ''}" data-action="open-workspace-filter" data-workspace-path="${escapeAttr(workspace.path)}" title="${escapeAttr(filterTitle)}" aria-label="${escapeAttr(filterTitle)}">${funnelIcon()}</button>
      <div class="workspace-actions-menu${actionsOpen ? ' is-open' : ''}">
        <button type="button" class="workspace-action-trigger" data-action="toggle-workspace-actions" data-workspace-path="${escapeAttr(workspace.path)}" title="Workspace actions" aria-label="Workspace actions" aria-expanded="${actionsOpen ? 'true' : 'false'}">+</button>
        <div class="workspace-action-popover" role="menu" ${actionsOpen ? '' : 'hidden'}>
          <button type="button" role="menuitem" data-action="new-document-in-workspace" data-workspace-path="${escapeAttr(workspace.path)}">New</button>
          <button type="button" role="menuitem" data-action="add-files-to-workspace" data-workspace-path="${escapeAttr(workspace.path)}">Add</button>
          <button type="button" role="menuitem" data-action="import-in-workspace" data-workspace-path="${escapeAttr(workspace.path)}">Import</button>
          <button type="button" role="menuitem" data-action="workspace-template-visibility" data-workspace-path="${escapeAttr(workspace.path)}">Template Visibility</button>
        </div>
      </div>
      ${visibleFiles.length === 0 ? '' : `<ul class="tree">${sortNodesForFilter(visibleFiles, matchedDocumentIds).map((node) => renderNode(node, selectedFilePath, matchedDocumentIds, workspaceClipboard)).join('')}</ul>`}
    </details>`;
}

function filterNodesByTemplateVisibility(nodes: WorkspaceTreeNode[], visibility: WorkspaceTemplateVisibility): WorkspaceTreeNode[] {
  const visibleNodes: WorkspaceTreeNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'folder') {
      const children = filterNodesByTemplateVisibility(node.children, visibility);
      if (children.length > 0) visibleNodes.push({ ...node, children });
      continue;
    }
    if (node.extension === '.hvy' && !visibility.hvyDocuments) continue;
    if (node.extension === '.thvy' && !visibility.thvyTemplates) continue;
    if (node.extension === '.phvy' && !visibility.phvyTemplates) continue;
    visibleNodes.push(node);
  }
  return visibleNodes;
}

function renderNode(
  node: WorkspaceTreeNode,
  selectedFilePath: string | null,
  matchedDocumentIds: Set<string> | null,
  workspaceClipboard: WorkspaceClipboardState | null,
): string {
  if (node.kind === 'folder') {
    const hasMatch = nodeHasFilterMatch(node, matchedDocumentIds);
    return `
      <li class="${matchedDocumentIds && !hasMatch ? 'tree-item-filter-empty' : ''}">
        <details open>
          <summary>${escapeHtml(node.name)}</summary>
          <ul class="tree">${sortNodesForFilter(node.children, matchedDocumentIds).map((child) => renderNode(child, selectedFilePath, matchedDocumentIds, workspaceClipboard)).join('')}</ul>
        </details>
      </li>`;
  }
  const selected = node.path === selectedFilePath ? ' is-selected' : '';
  const noFilterMatch = matchedDocumentIds !== null && !matchedDocumentIds.has(node.path);
  const cutPending = workspaceClipboard?.mode === 'cut' && workspaceClipboard.path === node.path;
  const extensionBadge = node.extension === '.thvy' || node.extension === '.phvy'
    ? `<span class="tree-file-extension" data-extension="${escapeAttr(node.extension)}">${escapeHtml(node.extension)}</span>`
    : '';
  return `
    <li>
      <button type="button" class="tree-file${selected}${noFilterMatch ? ' is-filter-empty' : ''}${cutPending ? ' is-cut-pending' : ''}" data-action="select-file" data-path="${escapeAttr(node.path)}" data-name="${escapeAttr(node.name)}" ${cutPending ? 'aria-label="' + escapeAttr(`${displayDocumentName(node.name)} cut`) + '"' : ''}>
        <span class="tree-file-name">${escapeHtml(displayDocumentName(node.name))}</span>
        ${extensionBadge}
      </button>
    </li>`;
}

function sortNodesForFilter(nodes: WorkspaceTreeNode[], matchedDocumentIds: Set<string> | null): WorkspaceTreeNode[] {
  if (!matchedDocumentIds) return nodes;
  return [...nodes].sort((left, right) => Number(nodeHasFilterMatch(right, matchedDocumentIds)) - Number(nodeHasFilterMatch(left, matchedDocumentIds)));
}

function nodeHasFilterMatch(node: WorkspaceTreeNode, matchedDocumentIds: Set<string> | null): boolean {
  if (!matchedDocumentIds) return true;
  if (node.kind === 'file') return matchedDocumentIds.has(node.path);
  return node.children.some((child) => nodeHasFilterMatch(child, matchedDocumentIds));
}

function displayDocumentName(name: string): string {
  return name.replace(/\.([tp]?hvy|md)$/i, '');
}

function renderEmptyState(state: AppState): string {
  if (state.document) {
    return '';
  }
  return `
    <div class="empty-state">
      <h2>Choose a file from a workspace</h2>
      <p>Open a workspace folder or a standalone HVY file to start viewing and editing.</p>
    </div>`;
}

function renderNewWorkspaceDialog(state: AppState): string {
  if (!state.newWorkspaceDialogOpen) {
    return '';
  }
  const managedActive = state.newWorkspaceLocation === 'managed';
  const chooseActive = state.newWorkspaceLocation === 'choose';
  const existingNames = state.workspaces.map((workspace) => workspace.manifest.name.toLowerCase());
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="dialog" data-form="new-workspace" data-existing-workspace-names="${escapeAttr(JSON.stringify(existingNames))}">
        <h2>New Workspace</h2>
        <div class="field-group">
          <span>Location</span>
          <div class="segmented-control">
            <button type="button" class="${managedActive ? 'is-active' : ''}" data-action="set-new-workspace-location" data-location="managed" aria-pressed="${managedActive ? 'true' : 'false'}">App managed</button>
            <button type="button" class="${chooseActive ? 'is-active' : ''}" data-action="set-new-workspace-location" data-location="choose" aria-pressed="${chooseActive ? 'true' : 'false'}">Choose folder</button>
          </div>
        </div>
        <input name="workspaceLocation" type="hidden" value="${escapeAttr(state.newWorkspaceLocation)}">
        ${managedActive ? `
          <label>
            <span>Name</span>
            <input name="workspaceName" type="text" autocomplete="off" autofocus required>
          </label>
          <p class="dialog-note" data-role="workspace-name-note">Choose a unique name for a new app-managed workspace.</p>
        ` : ''}
        <p class="dialog-note">${chooseActive ? 'Pick any folder, including a synced Google Drive or OneDrive folder.' : 'Stored in the app data folder on this device.'}</p>
        <div class="dialog-actions">
          <button type="button" data-action="cancel-new-workspace">Cancel</button>
          <button type="submit" data-role="new-workspace-submit" ${state.busy || managedActive ? 'disabled' : ''}>${chooseActive ? 'Select' : 'Create'}</button>
        </div>
      </form>
    </div>`;
}

function updateNewWorkspaceSubmit(form: HTMLFormElement): void {
  const location = new FormData(form).get('workspaceLocation');
  const submit = form.querySelector<HTMLButtonElement>('[data-role="new-workspace-submit"]');
  if (!submit || location !== 'managed') return;
  const input = form.querySelector<HTMLInputElement>('input[name="workspaceName"]');
  const note = form.querySelector<HTMLElement>('[data-role="workspace-name-note"]');
  const name = input?.value.trim().toLowerCase() ?? '';
  const existingNames = parseExistingWorkspaceNames(form.dataset.existingWorkspaceNames);
  const duplicate = name.length > 0 && existingNames.includes(name);
  submit.disabled = name.length === 0 || duplicate;
  if (note) {
    note.textContent = duplicate
      ? 'A workspace with that name is already open.'
      : 'Choose a unique name for a new app-managed workspace.';
    note.dataset.state = duplicate ? 'error' : 'neutral';
  }
}

function updateWorkspaceFilterSubmit(form: HTMLFormElement): void {
  const submit = form.querySelector<HTMLButtonElement>('[data-role="workspace-filter-submit"]');
  const query = form.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-field="workspace-filter-query"]')?.value.trim() ?? '';
  if (submit) {
    const isSemanticLoading = form.classList.contains('is-semantic-mode') && form.dataset.loading === 'true';
    submit.disabled = !isSemanticLoading && query.length === 0;
  }
}

function parseExistingWorkspaceNames(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const names = JSON.parse(value);
    return Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string') : [];
  } catch {
    return [];
  }
}

function isNewWorkspaceLocation(value: unknown): value is 'managed' | 'choose' {
  return value === 'managed' || value === 'choose';
}

function isTemplateScope(value: unknown): value is TemplateScope {
  return value === 'app' || value === 'workspace';
}

function isTemplateExtension(value: unknown): value is TemplateExtension {
  return value === '.thvy' || value === '.phvy';
}

function isDocumentCreationType(value: unknown): value is DocumentCreationType {
  return value === 'hvy' || value === 'thvy' || value === 'phvy';
}

function isImportSourceTab(value: unknown): value is AppState['importSourceTab'] {
  return value === 'workspace' || value === 'anywhere';
}

function renderNewDocumentDialog(state: AppState): string {
  if (!state.newDocumentWorkspacePath) {
    return '';
  }
  const workspace = state.workspaces.find((candidate) => candidate.path === state.newDocumentWorkspacePath) ?? null;
  const visibility = workspaceTemplateVisibility(workspace);
  const templates = templatesForDocumentType(mergeSavedTemplates(state.savedTemplates), state.newDocumentType, visibility);
  const showTemplatePicker = state.newDocumentType === 'hvy';
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="dialog" data-form="new-document">
        <h2>New Document</h2>
        ${renderDocumentTypeControl('new', state.newDocumentType, visibility)}
        <label>
          <span>Name</span>
          <input name="documentName" type="text" autocomplete="off" autofocus required>
        </label>
        ${showTemplatePicker ? `<label>
          <span>Template</span>
          <select name="templateId">
            ${templates.map(renderTemplateOption).join('')}
          </select>
        </label>` : ''}
        <div class="dialog-actions">
          <button type="button" data-action="cancel-new-document">Cancel</button>
          <button type="submit" ${state.busy ? 'disabled' : ''}>Create</button>
        </div>
      </form>
    </div>`;
}

function renderImportDialog(state: AppState): string {
  const workspacePath = state.importWorkspacePath;
  const importCurrent = state.importIntoCurrentDialogOpen;
  if (!workspacePath && !importCurrent) {
    return '';
  }
  const currentWorkspacePath = importCurrent ? currentDocumentWorkspacePath(state) : workspacePath;
  const workspace = state.workspaces.find((candidate) => candidate.path === currentWorkspacePath) ?? null;
  const visibility = workspaceTemplateVisibility(workspace);
  const templates = templatesForDocumentType(mergeSavedTemplates(state.savedTemplates), state.importDocumentType, visibility);
  const showTemplatePicker = state.importDocumentType === 'hvy';
  const source = state.importSource;
  const title = importCurrent ? 'Import Into Current' : 'Import Document';
  const baseDisabled = state.busy || (!importCurrent && showTemplatePicker && templates.length === 0);
  const sourceControls = importCurrent
    ? renderImportCurrentSourceControls(state, workspace)
    : renderAnywhereImportSourceControls(source);
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="dialog wide-dialog" data-form="${importCurrent ? 'import-current' : 'import-document'}">
        <h2>${escapeHtml(title)}</h2>
        ${importCurrent ? '' : `
          ${renderDocumentTypeControl('import', state.importDocumentType, visibility)}
          <label>
            <span>Name</span>
            <input name="documentName" type="text" autocomplete="off" autofocus required>
          </label>
          ${showTemplatePicker ? `<label>
            <span>Template</span>
            <select name="templateId">
              ${templates.map(renderTemplateOption).join('')}
            </select>
          </label>` : ''}
        `}
        <div class="field-group">
          <span>Source</span>
          ${sourceControls}
        </div>
        <label>
          <span>Instructions</span>
          <textarea name="instructions" rows="4" placeholder="Optional import guidance"></textarea>
        </label>
        <div class="dialog-actions">
          <button type="button" data-action="cancel-import">Cancel</button>
          <button type="submit" data-role="import-submit" data-has-file-source="${source ? 'true' : 'false'}" data-base-disabled="${baseDisabled ? 'true' : 'false'}" ${baseDisabled || !source ? 'disabled' : ''}>Import</button>
        </div>
      </form>
    </div>`;
}

function renderImportProgressDialog(state: AppState): string {
  if (!state.importProgressDialogOpen) {
    return '';
  }
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog" role="dialog" aria-modal="true" aria-label="Import progress">
        <h2>Importing</h2>
        <p class="dialog-note">${escapeHtml(state.status || 'Importing...')}</p>
      </section>
    </div>`;
}

function renderImportCurrentSourceControls(state: AppState, workspace: AppState['workspaces'][number] | null): string {
  const workspaceFiles = workspace ? sortedWorkspaceHvySourceFiles(workspace.files) : [];
  const workspaceDisabled = workspaceFiles.length === 0;
  const workspaceActive = state.importSourceTab === 'workspace' && !workspaceDisabled;
  const anywhereActive = state.importSourceTab === 'anywhere' || workspaceDisabled;
  return `
    <div class="segmented-control import-source-tabs" role="tablist" aria-label="Import source">
      <button type="button" class="${workspaceActive ? 'is-active' : ''}" data-action="set-import-source-tab" data-tab="workspace" aria-pressed="${workspaceActive ? 'true' : 'false'}" ${workspaceDisabled ? 'disabled' : ''}>Workspace</button>
      <button type="button" class="${anywhereActive ? 'is-active' : ''}" data-action="set-import-source-tab" data-tab="anywhere" aria-pressed="${anywhereActive ? 'true' : 'false'}">Anywhere</button>
    </div>
    ${workspaceActive ? renderImportCurrentWorkspaceSourcePicker(state, workspaceFiles) : renderAnywhereImportSourceControls(state.importSource)}
  `;
}

function renderAnywhereImportSourceControls(source: AppState['importSource']): string {
  return `
    <div class="source-picker-row">
      <button type="button" data-action="choose-import-source">Choose file</button>
      <span>${source ? escapeHtml(source.name) : 'No source selected'}</span>
    </div>
    <textarea name="importSourceText" class="import-source-textarea" data-field="import-source-text" rows="8" placeholder="Or paste at least 50 characters of source text here"></textarea>
    <p class="dialog-note" data-role="import-source-note">${source ? 'Using selected file unless pasted text is provided.' : 'Choose a file or paste at least 50 characters.'}</p>`;
}

function renderImportCurrentWorkspaceSourcePicker(state: AppState, options: WorkspaceFileNode[]): string {
  return `
    <label>
      <span>Workspace HVY</span>
      <select data-field="import-workspace-source">
        <option value="">Choose from current workspace</option>
        ${options.map((file) => `
          <option value="${escapeAttr(file.path)}" ${state.importSource?.path === file.path ? 'selected' : ''}>${escapeHtml(workspaceSourceLabel(file))}</option>
        `).join('')}
      </select>
    </label>`;
}

function sortedWorkspaceHvySourceFiles(nodes: WorkspaceTreeNode[]): WorkspaceFileNode[] {
  return flattenWorkspaceHvySourceFiles(nodes)
    .sort((left, right) => workspaceSourceSortKey(left).localeCompare(workspaceSourceSortKey(right)));
}

function workspaceSourceLabel(file: WorkspaceFileNode): string {
  return file.relativePath || file.name;
}

function workspaceSourceSortKey(file: WorkspaceFileNode): string {
  return workspaceSourceLabel(file).toLocaleLowerCase();
}

function flattenWorkspaceHvySourceFiles(nodes: WorkspaceTreeNode[]): WorkspaceFileNode[] {
  return nodes.flatMap((node) => {
    if (node.kind === 'folder') {
      return flattenWorkspaceHvySourceFiles(node.children);
    }
    return node.extension === '.hvy' ? [node] : [];
  });
}

function renderDocumentTypeControl(
  context: 'new' | 'import',
  activeType: DocumentCreationType,
  visibility: WorkspaceTemplateVisibility,
): string {
  const action = context === 'new' ? 'set-new-document-type' : 'set-import-document-type';
  const hvyDisabled = !visibility.thvyTemplates;
  const thvyDisabled = !visibility.thvyTemplates;
  const phvyDisabled = !visibility.phvyTemplates;
  return `
    <div class="field-group">
      <span>Document Type</span>
      <div class="segmented-control document-type-control">
        <button type="button" class="${activeType === 'hvy' ? 'is-active' : ''}" data-action="${action}" data-document-type="hvy" aria-pressed="${activeType === 'hvy' ? 'true' : 'false'}" ${hvyDisabled ? 'disabled' : ''}>HVY</button>
        <button type="button" class="${activeType === 'thvy' ? 'is-active' : ''}" data-action="${action}" data-document-type="thvy" aria-pressed="${activeType === 'thvy' ? 'true' : 'false'}" ${thvyDisabled ? 'disabled' : ''}>THVY</button>
        <button type="button" class="${activeType === 'phvy' ? 'is-active' : ''}" data-action="${action}" data-document-type="phvy" aria-pressed="${activeType === 'phvy' ? 'true' : 'false'}" ${phvyDisabled ? 'disabled' : ''}>PHVY</button>
      </div>
    </div>`;
}

function updateImportSubmit(form: HTMLFormElement): void {
  const submit = form.querySelector<HTMLButtonElement>('[data-role="import-submit"]');
  if (!submit) return;
  const pastedLength = form.querySelector<HTMLTextAreaElement>('[data-field="import-source-text"]')?.value.trim().length ?? 0;
  const hasFileSource = submit.dataset.hasFileSource === 'true';
  const baseDisabled = submit.dataset.baseDisabled === 'true';
  const hasValidSource = hasFileSource || pastedLength >= MIN_PASTED_IMPORT_CHARS;
  submit.disabled = baseDisabled || !hasValidSource;
  const note = form.querySelector<HTMLElement>('[data-role="import-source-note"]');
  if (note) {
    note.textContent = hasFileSource
      ? pastedLength > 0 && pastedLength < MIN_PASTED_IMPORT_CHARS
        ? `Pasted text needs ${MIN_PASTED_IMPORT_CHARS} characters to replace the selected file.`
        : 'Using selected file unless pasted text is provided.'
      : pastedLength > 0
      ? `${Math.min(pastedLength, MIN_PASTED_IMPORT_CHARS)}/${MIN_PASTED_IMPORT_CHARS} characters.`
      : `Choose a file or paste at least ${MIN_PASTED_IMPORT_CHARS} characters.`;
    note.dataset.state = !hasValidSource && pastedLength > 0 ? 'error' : 'neutral';
  }
}

function renderExportDialog(state: AppState): string {
  if (!state.saveTemplateDialogOpen) {
    return '';
  }
  const workspaceDisabled = !currentDocumentWorkspacePath(state);
  const appActive = state.saveTemplateScope === 'app';
  const workspaceActive = state.saveTemplateScope === 'workspace' && !workspaceDisabled;
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="dialog" data-form="export-document">
        <h2>Save as Template</h2>
        <label>
          <span>Format</span>
          <select name="format">
            <option value=".thvy" ${state.document?.extension === '.phvy' ? '' : 'selected'}>THVY template (.thvy)</option>
            <option value=".phvy" ${state.document?.extension === '.phvy' ? 'selected' : ''}>PHVY template (.phvy)</option>
          </select>
        </label>
        <label>
          <span>Name</span>
          <input name="templateName" type="text" autocomplete="off" value="${escapeAttr(state.document?.name.replace(/\.(t?hvy|phvy|md)$/i, '') ?? '')}" autofocus required>
        </label>
        <div class="field-group">
          <span>Scope</span>
          <div class="segmented-control">
            <button type="button" class="${appActive ? 'is-active' : ''}" data-action="set-save-template-scope" data-scope="app" aria-pressed="${appActive ? 'true' : 'false'}">App</button>
            <button type="button" class="${workspaceActive ? 'is-active' : ''}" data-action="set-save-template-scope" data-scope="workspace" aria-pressed="${workspaceActive ? 'true' : 'false'}" ${workspaceDisabled ? 'disabled' : ''}>Workspace</button>
          </div>
        </div>
        <input name="scope" type="hidden" value="${escapeAttr(workspaceActive ? 'workspace' : 'app')}">
        <p class="dialog-note">${workspaceDisabled ? 'Templates can be saved to app templates. Workspace templates are available when the document belongs to an open workspace.' : 'App templates are available everywhere; workspace templates stay with this workspace.'}</p>
        <div class="dialog-actions">
          <button type="button" data-action="cancel-export">Cancel</button>
          <button type="submit" ${state.busy ? 'disabled' : ''}>Save</button>
        </div>
      </form>
    </div>`;
}

function renderExportPdfSavePrompt(state: AppState): string {
  if (!state.exportPdfSavePromptOpen || !state.document) return '';
  const saveLabel = state.document.isNew ? 'Save As' : 'Save';
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog" role="dialog" aria-modal="true" aria-label="Save before PDF export">
        <h2>Export PDF</h2>
        <p class="dialog-note">Save ${escapeHtml(state.document.name)} before exporting it to PDF.</p>
        <div class="dialog-actions">
          <button type="button" data-action="cancel-export-pdf-save-prompt">Cancel</button>
          <button type="button" data-action="save-before-export-pdf" ${state.busy ? 'disabled' : ''}>${saveLabel}</button>
        </div>
      </section>
    </div>`;
}

function renderWorkspaceTemplateVisibilityDialog(state: AppState): string {
  const workspace = state.workspaceTemplateVisibilityPath
    ? state.workspaces.find((candidate) => candidate.path === state.workspaceTemplateVisibilityPath) ?? null
    : null;
  if (!workspace) return '';
  const visibility = workspaceTemplateVisibility(workspace);
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="dialog" data-form="workspace-template-visibility">
        <h2>Template Visibility</h2>
        <input type="hidden" name="workspacePath" value="${escapeAttr(workspace.path)}">
        <div class="field-group">
          <span>${escapeHtml(workspace.manifest.name)}</span>
          <label class="checkbox-row">
            <input type="checkbox" name="hvyDocuments" ${visibility.hvyDocuments ? 'checked' : ''}>
            <span>HVY documents</span>
          </label>
          <label class="checkbox-row">
            <input type="checkbox" name="thvyTemplates" ${visibility.thvyTemplates ? 'checked' : ''}>
            <span>THVY templates</span>
          </label>
          <label class="checkbox-row">
            <input type="checkbox" name="phvyTemplates" ${visibility.phvyTemplates ? 'checked' : ''}>
            <span>PHVY templates</span>
          </label>
        </div>
        <div class="dialog-actions">
          <button type="button" data-action="cancel-workspace-template-visibility">Cancel</button>
          <button type="submit" ${state.busy ? 'disabled' : ''}>Save</button>
        </div>
      </form>
    </div>`;
}

function renderTemplateOption(template: ReturnType<typeof mergeSavedTemplates>[number]): string {
  const name = isBlankBundledTemplate(template) ? 'None' : template.name;
  const label = template.scope === 'bundled' ? name : `${name} (${template.scope})`;
  return `<option value="${escapeAttr(template.id)}">${escapeHtml(label)}</option>`;
}

function isBlankBundledTemplate(template: ReturnType<typeof mergeSavedTemplates>[number]): boolean {
  return template.scope === 'bundled' && /^blank\.(thvy|phvy)$/i.test(template.fileName);
}

function renderAboutDialog(state: AppState): string {
  if (!state.aboutDialogOpen) {
    return '';
  }
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog about-dialog" role="dialog" aria-modal="true" aria-labelledby="aboutTitle">
        <img class="about-logo" src="${escapeAttr(appIconUrl)}" alt="" aria-hidden="true">
        <h2 id="aboutTitle">HVY Galaxy</h2>
        <p class="about-version">Version 0.1.0</p>
        <p class="about-copy">Desktop app for HVY files</p>
        <div class="about-attribution">
          <span>Created by Heavy Resume</span>
          <a href="https://heavyresume.com" target="_blank" rel="noreferrer">https://heavyresume.com</a>
        </div>
        <div class="dialog-actions about-actions">
          <button type="button" data-action="close-about">OK</button>
        </div>
      </section>
    </div>`;
}

function renderAiSettingsDialog(state: AppState): string {
  if (!state.aiSettingsDialogOpen) {
    return '';
  }
  const settings = state.aiSettingsDraft ?? state.aiSettings;
  const providerConfig = activeProviderConfig(settings);
  const provider = aiProviderPreset(settings.activeProviderId);
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="dialog wide-dialog" data-form="ai-settings">
        <h2>LLM Settings</h2>
        <p class="dialog-note">Configure providers once, then choose the provider and model each action should use.</p>
        <textarea name="settingsJson" hidden>${escapeHtml(JSON.stringify(settings))}</textarea>
        <div class="ai-provider-picker" aria-label="Configured AI providers">
          <span>Providers</span>
          <div>
            ${aiProviderPresets.map((option) => `
              <button
                type="button"
                class="${option.id === settings.activeProviderId ? 'is-active' : ''}"
                data-action="select-ai-provider"
                data-provider-id="${escapeAttr(option.id)}"
                aria-pressed="${option.id === settings.activeProviderId ? 'true' : 'false'}"
              >${escapeHtml(option.name)}</button>
            `).join('')}
          </div>
        </div>
        <button type="button" class="provider-docs-link" data-action="provider-docs" data-provider-docs data-url="${escapeAttr(provider.docsUrl)}">Setup instructions</button>
        <input name="activeProviderId" type="hidden" value="${escapeAttr(settings.activeProviderId)}">
        <div class="ai-provider-fields">
          <label>
            <span>Base URL</span>
            <input name="baseUrl" type="url" value="${escapeAttr(providerConfig.baseUrl)}" placeholder="${escapeAttr(provider.baseUrl || 'http://127.0.0.1:8000/v1')}" required>
          </label>
        </div>
        <label>
          <span>API Key</span>
          <input name="apiKey" type="password" value="${escapeAttr(providerConfig.apiKey)}" placeholder="${escapeAttr(provider.apiKeyPlaceholder)}">
        </label>
        <label>
          <span>Maximum import chunk size</span>
          <input name="maxContextChars" type="number" min="1" step="1000" value="${escapeAttr(String(normalizeAiMaxContextChars(settings.maxContextChars)))}">
        </label>
        <div class="ai-task-grid">
          ${renderActionConfigField('chat', 'Chat / Q&A', settings)}
          ${renderActionConfigField('edit', 'Document and component edit', settings)}
          ${renderActionConfigField('importPlanning', 'Import planning', settings)}
          ${renderActionConfigField('importWriting', 'Import writing', settings)}
          ${renderActionConfigField('importCleanup', 'Import cleanup', settings)}
          ${renderActionConfigField('semanticFilter', 'Semantic search', settings)}
          ${renderActionConfigField('compaction', 'Compaction', settings)}
        </div>
        <div class="dialog-actions">
          <button type="button" data-action="cancel-ai-settings">Cancel</button>
          <button type="submit" ${state.busy ? 'disabled' : ''}>Save</button>
        </div>
      </form>
    </div>`;
}

function renderMcpSettingsDialog(state: AppState): string {
  if (!state.mcpSettingsDialogOpen) {
    return '';
  }
  const settings = state.mcpSettingsDraft ?? state.mcpSettings;
  const status = state.mcpServerStatus;
  const endpointUrl = status.url ?? mcpConnectionUrl(settings);
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="dialog wide-dialog mcp-settings-dialog" data-form="mcp-settings">
        <h2>MCP Settings</h2>
        <p class="dialog-note">Let local AI agents search workspaces and edit HVY files through the low-context HVY CLI surface.</p>
        <textarea name="settingsJson" hidden>${escapeHtml(JSON.stringify(settings))}</textarea>
        <div class="mcp-settings-grid mcp-settings-grid--global">
          <label>
            <span>Write access</span>
            <select name="writeAccess">
              <option value="searchOnly" ${settings.writeAccess === 'searchOnly' ? 'selected' : ''}>Search only</option>
              <option value="hvyCliEdits" ${settings.writeAccess === 'hvyCliEdits' ? 'selected' : ''}>Search &amp; Alter files</option>
              <option value="createImportSave" ${settings.writeAccess === 'createImportSave' ? 'selected' : ''}>Full access</option>
            </select>
          </label>
        </div>
        <div class="mcp-config-preview">
          <div class="mcp-config-header">
            <span>Connection config</span>
            <div class="segmented-control mcp-transport-tabs" role="tablist" aria-label="MCP transport">
              <button type="button" class="is-active" data-action="select-mcp-transport" data-transport="stdio" data-transport-tab="stdio" role="tab" aria-selected="true">STDIO</button>
              <button type="button" data-action="select-mcp-transport" data-transport="http" data-transport-tab="http" role="tab" aria-selected="false">Streamable HTTP</button>
            </div>
          </div>
          <section class="mcp-config-panel" data-transport-panel="stdio">
            <div class="mcp-setup-grid">
              ${renderMcpReadonlyField('Command to launch', state.mcpStdioLaunchConfig.command)}
              ${renderMcpReadonlyField('Command line arguments', formatShellArgs(state.mcpStdioLaunchConfig.args) || '(none)')}
              ${renderMcpReadonlyField('Working directory', state.mcpStdioLaunchConfig.workingDirectory)}
            </div>
            <div class="mcp-install-list">
              ${state.mcpClientInstallStatus.map((client) => {
                const installDisabled = state.busy || !client.configExists || !client.executableExists;
                const removeDisabled = state.busy || !client.configExists || !client.installed;
                const restoreDisabled = state.busy || !client.latestBackupPath;
                const actionLabel = client.installed ? `Refresh ${client.label}` : `Install for ${client.label}`;
                return `
                  <article class="mcp-install-card${client.installed ? ' is-installed' : ''}">
                    <div>
                      <strong>${escapeHtml(client.label)}</strong>
                      <span>${escapeHtml(client.message)}</span>
                      <small>${escapeHtml(client.configPath)}</small>
                      ${client.latestBackupLabel ? `<small>Latest backup: ${escapeHtml(client.latestBackupLabel)}</small>` : ''}
                    </div>
                    <div class="mcp-install-actions">
                      <button type="button" data-action="install-mcp-client" data-target="${escapeAttr(client.target)}" ${installDisabled ? 'disabled' : ''}>${escapeHtml(actionLabel)}</button>
                      <button type="button" class="ghost" data-action="remove-mcp-client" data-target="${escapeAttr(client.target)}" ${removeDisabled ? 'disabled' : ''}>Remove</button>
                      <button type="button" class="ghost" data-action="restore-mcp-client-backup" data-target="${escapeAttr(client.target)}" ${restoreDisabled ? 'disabled' : ''}>Restore Latest</button>
                    </div>
                  </article>`;
              }).join('')}
            </div>
          </section>
          <section class="mcp-config-panel" data-transport-panel="http" hidden>
            <div class="mcp-status-card" data-state="${status.running ? 'running' : 'stopped'}">
              <div>
                <strong>${status.running ? 'Running' : 'Stopped'}</strong>
                <span>${escapeHtml(status.message)}</span>
                ${renderMcpReadonlyField('URL', endpointUrl, 'mcp-url', 'copy-mcp-url', status.running ? 'true' : 'false')}
                ${status.lastError ? `<small>${escapeHtml(status.lastError)}</small>` : ''}
              </div>
              <div class="mcp-status-actions">
                <button type="button" data-action="start-mcp-server" ${status.running || state.busy ? 'disabled' : ''}>Start</button>
                <button type="button" data-action="stop-mcp-server" ${!status.running || state.busy ? 'disabled' : ''}>Stop</button>
                <button type="button" data-action="restart-mcp-server" ${state.busy ? 'disabled' : ''}>Restart</button>
              </div>
            </div>
            <label class="checkbox-row">
              <input name="startAutomatically" type="checkbox" ${settings.startAutomatically ? 'checked' : ''}>
              <span>Start automatically with HVY Galaxy</span>
            </label>
            <div class="mcp-settings-grid">
              <label>
                <span>Port</span>
                <input name="port" data-field="mcp-port" type="number" min="1" max="65535" step="1" value="${escapeAttr(String(settings.port ?? 8794))}">
              </label>
              <label class="mcp-token-field">
                <span>Bearer token</span>
                <div class="mcp-token-control">
                  <input name="bearerToken" data-field="mcp-token" type="password" value="${escapeAttr(settings.bearerToken)}" autocomplete="off" spellcheck="false">
                  <button type="button" class="icon-button" data-action="toggle-mcp-token" title="Show bearer token" aria-label="Show bearer token">${eyeIcon()}</button>
                  <button type="button" class="icon-button" data-action="copy-mcp-token" title="Copy bearer token" aria-label="Copy bearer token">${copyIcon()}</button>
                  <button type="button" data-action="generate-mcp-token">Generate</button>
                </div>
              </label>
            </div>
            <div class="mcp-setup-grid">
              ${renderMcpReadonlyField('Connection URL', endpointUrl, 'mcp-http-url')}
            </div>
          </section>
        </div>
        <div class="dialog-actions">
          <button type="button" data-action="cancel-mcp-settings">Cancel</button>
          <button type="submit" ${state.busy ? 'disabled' : ''}>Save</button>
        </div>
      </form>
    </div>`;
}

function renderMcpReadonlyField(
  label: string,
  value: string,
  role?: string,
  copyAction = 'copy-mcp-value',
  running?: string,
): string {
  return `
    <div class="mcp-copy-field" data-copy-label="${escapeAttr(label)}">
      <span>${escapeHtml(label)}</span>
      <span class="mcp-copy-control">
        <input
          type="text"
          readonly
          aria-label="${escapeAttr(label)}"
          value="${escapeAttr(value)}"
          ${role ? `data-role="${escapeAttr(role)}"` : ''}
          ${running ? `data-running="${escapeAttr(running)}"` : ''}
          spellcheck="false"
        >
        <button type="button" class="icon-button" data-action="${escapeAttr(copyAction)}" title="Copy ${escapeAttr(label)}" aria-label="Copy ${escapeAttr(label)}">${copyIcon()}</button>
      </span>
    </div>`;
}

function renderColorThemeDialog(state: AppState): string {
  if (!state.colorThemeDialogOpen) {
    return '';
  }
  const colors = state.colorTheme.colors;
  const selectedPaletteId = getMatchedPaletteId(colors);
  const selectedCustomThemeId = getMatchedSavedThemeId(colors, state.colorTheme.savedThemes);
  const themeName = state.colorTheme.themeName || selectedThemeName(selectedPaletteId, selectedCustomThemeId, state) || 'Untitled Theme';
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog wide-dialog color-theme-dialog" role="dialog" aria-modal="true" aria-labelledby="colorThemeTitle">
        <h2 id="colorThemeTitle">Colors</h2>
        <p class="dialog-note">Global HVY colors apply across documents on this device.</p>
        <div class="theme-file-panel">
          <label class="theme-name-field">
            <span>Theme Name</span>
            <input data-field="theme-name" value="${escapeAttr(themeName)}" placeholder="Untitled Theme" spellcheck="false">
          </label>
          <div class="theme-file-actions">
            <button type="button" class="secondary-action" data-action="theme-save">Save Theme</button>
            <button type="button" class="secondary-action" data-action="theme-export">Export</button>
            <button type="button" class="secondary-action" data-action="theme-import">Import</button>
          </div>
        </div>
        <div class="theme-palette-grid" aria-label="Theme palettes">
          ${renderThemeCards(state, selectedPaletteId, selectedCustomThemeId)}
        </div>
        <div class="theme-filter-shell">
          <span>Filter</span>
          <input type="search" placeholder="Color name or variable" data-field="theme-color-filter">
        </div>
        <div class="theme-color-list">
          ${THEME_COLOR_NAMES.map((name) => renderThemeColorRow(name, colors[name] ?? '', getResolvedThemeColor(name, colors[name]))).join('')}
        </div>
        <div class="dialog-actions">
          <button type="button" data-action="cancel-color-theme">Done</button>
        </div>
      </section>
    </div>`;
}

interface ThemeCard {
  id: string;
  name: string;
  description: string;
  colors: Record<string, string>;
  builtIn: boolean;
  selected: boolean;
  lastUsedAt: number;
}

function renderThemeCards(state: AppState, selectedPaletteId: string | null, selectedCustomThemeId: string | null): string {
  const cards: ThemeCard[] = [
    {
      id: 'default',
      name: 'Default',
      description: 'Use the built-in HVY colors.',
      colors: {},
      builtIn: true,
      selected: selectedCustomThemeId === null && selectedPaletteId === null && Object.keys(state.colorTheme.colors).length === 0,
      lastUsedAt: state.colorTheme.themeUses.default ?? 0,
    },
    ...HVY_PALETTES.map((palette) => ({
      id: `palette:${palette.id}`,
      name: palette.name,
      description: palette.description,
      colors: palette.colors,
      builtIn: true,
      selected: selectedCustomThemeId === null && selectedPaletteId === palette.id,
      lastUsedAt: state.colorTheme.themeUses[`palette:${palette.id}`] ?? 0,
    })),
    ...state.colorTheme.savedThemes.map((theme) => ({
      id: `custom:${theme.id}`,
      name: theme.name,
      description: 'Custom theme',
      colors: theme.colors,
      builtIn: false,
      selected: selectedCustomThemeId === theme.id,
      lastUsedAt: theme.lastUsedAt,
    })),
  ];
  return cards
    .sort((left, right) => (right.lastUsedAt - left.lastUsedAt) || left.name.localeCompare(right.name))
    .map(renderThemeCard)
    .join('');
}

function renderThemeCard(theme: ThemeCard): string {
  const preview = [
    theme.colors['--hvy-bg'] ?? '#f5f9ff',
    theme.colors['--hvy-accent-1'] ?? '#4a8fab',
    theme.colors['--hvy-surface'] ?? '#ffffff',
  ];
  return `
    <article class="theme-palette-card${theme.selected ? ' is-selected' : ''}${theme.builtIn ? '' : ' theme-palette-card--custom'}">
      <div class="theme-palette-preview${theme.id === 'default' ? ' theme-palette-preview-document' : ''}" aria-hidden="true">
        ${preview.map((color) => `<span style="background: ${escapeAttr(color)}"></span>`).join('')}
      </div>
      <div class="theme-palette-copy">
        <strong>${escapeHtml(theme.name)}</strong>
        <span>${escapeHtml(theme.description)}</span>
      </div>
      <div class="theme-palette-actions">
        <button type="button" data-action="theme-select" data-theme-id="${escapeAttr(theme.id)}">${theme.selected ? 'Using' : 'Use'}</button>
        ${theme.builtIn ? '' : `<button type="button" class="ghost" data-action="theme-delete" data-theme-id="${escapeAttr(theme.id)}">Delete</button>`}
      </div>
    </article>`;
}

function selectedThemeName(paletteId: string | null, customThemeId: string | null, state: AppState): string | null {
  if (customThemeId) return state.colorTheme.savedThemes.find((theme) => theme.id === customThemeId)?.name ?? null;
  if (paletteId) return HVY_PALETTES.find((palette) => palette.id === paletteId)?.name ?? null;
  return Object.keys(state.colorTheme.colors).length === 0 ? 'Default' : null;
}

function renderThemeColorRow(name: string, value: string, displayValue: string): string {
  const label = getThemeColorLabel(name);
  const search = `${name} ${label} ${value} ${displayValue}`;
  const overridden = value.trim().length > 0;
  const pickerValue = colorValueToPickerHex(displayValue);
  const alphaValue = colorValueToAlpha(displayValue);
  const valueLabel = `${label} color value`;
  return `
    <div class="theme-color-row${overridden ? ' theme-color-row--override' : ''}" data-theme-color-name="${escapeAttr(name)}" data-theme-search="${escapeAttr(search.toLowerCase())}">
      <div class="theme-color-meta">
        <strong>${escapeHtml(label)}</strong><span class="theme-color-var">${escapeHtml(name)}</span>
      </div>
      <input
        class="theme-color-picker"
        type="color"
        data-field="theme-color-picker"
        data-color-name="${escapeAttr(name)}"
        value="${escapeAttr(pickerValue)}"
        aria-label="${escapeAttr(`${label} color picker`)}"
      >
      <input
        class="theme-color-value"
        data-field="theme-color-value"
        data-color-name="${escapeAttr(name)}"
        value="${escapeAttr(displayValue)}"
        placeholder="CSS color"
        aria-label="${escapeAttr(valueLabel)}"
        spellcheck="false"
      >
      <label class="theme-alpha-control" title="Alpha">
        <span>A</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          data-field="theme-color-alpha"
          data-color-name="${escapeAttr(name)}"
          value="${escapeAttr(String(alphaValue))}"
          aria-label="${escapeAttr(`${label} alpha`)}"
        >
        <output>${escapeHtml(String(Math.round(alphaValue * 100)))}</output>
      </label>
      <span class="theme-color-swatch" style="${displayValue ? `background: ${escapeAttr(displayValue)};` : ''}" aria-hidden="true"></span>
      ${overridden
        ? `<span class="theme-color-reset-group"><button type="button" class="ghost theme-color-action" data-action="theme-reset-color" data-color-name="${escapeAttr(name)}" title="Reset to default">Reset</button></span>`
        : '<span class="theme-color-action theme-color-default muted">Default</span>'}
    </div>`;
}

function syncThemeAlphaControl(row: HTMLElement | null | undefined, value: string): void {
  if (!row) return;
  const alpha = colorValueToAlpha(value);
  const alphaInput = row.querySelector<HTMLInputElement>('[data-field="theme-color-alpha"]');
  const alphaOutput = row.querySelector<HTMLOutputElement>('.theme-alpha-control output');
  if (alphaInput) {
    alphaInput.value = String(alpha);
  }
  if (alphaOutput) {
    alphaOutput.value = String(Math.round(alpha * 100));
    alphaOutput.textContent = alphaOutput.value;
  }
}

function syncThemeOverrideAction(row: HTMLElement | null | undefined, name: string, overridden: boolean): void {
  if (!row) return;
  const defaultLabel = row.querySelector<HTMLElement>('.theme-color-default');
  if (overridden && defaultLabel) {
    defaultLabel.outerHTML = `<span class="theme-color-reset-group"><button type="button" class="ghost theme-color-action" data-action="theme-reset-color" data-color-name="${escapeAttr(name)}" title="Reset to default">Reset</button></span>`;
    return;
  }
  const resetGroup = row.querySelector<HTMLElement>('.theme-color-reset-group');
  if (!overridden && resetGroup) {
    resetGroup.outerHTML = '<span class="theme-color-action theme-color-default muted">Default</span>';
  }
}

function getResolvedThemeColor(name: string, overrideValue: string | undefined): string {
  if (overrideValue) return overrideValue;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function renderRecoveryDialog(state: AppState): string {
  if (!state.recoveryDialogOpen) {
    return '';
  }
  const backups = state.recoveryBackups;
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog wide-dialog recovery-dialog" role="dialog" aria-modal="true" aria-labelledby="recoveryTitle">
        <h2 id="recoveryTitle">Recover Unsaved Edits</h2>
        <p class="dialog-note">Recoverable edits are kept for seven days and refreshed while a document has edits.</p>
        ${
          backups.length === 0
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
                      <button type="button" data-action="restore-backup" data-backup-id="${escapeAttr(backup.id)}">Restore Edits</button>
                      <button type="button" class="danger-button" data-action="discard-backup" data-backup-id="${escapeAttr(backup.id)}">Discard</button>
                    </div>
                  </article>
                `).join('')}
              </div>`
        }
        <div class="dialog-actions">
          <button type="button" data-action="cancel-recovery">Close</button>
        </div>
      </section>
    </div>`;
}

function renderCloseDocumentDialog(state: AppState): string {
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
          <button type="button" data-action="save-and-close-document">Save and Close</button>
          <button type="button" data-action="close-document-without-saving">Don't Save</button>
          <button type="button" data-action="cancel-close-document">Cancel</button>
        </div>
      </section>
    </div>`;
}

function renderCloseDocumentDraftDialog(state: AppState): string {
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
          <button type="button" data-action="review-close-document-later">Review Later</button>
          <button type="button" class="danger-button" data-action="discard-close-document-draft">Discard Draft</button>
          <button type="button" data-action="cancel-close-document">Cancel</button>
        </div>
      </section>
    </div>`;
}

function renderAppCloseDialog(state: AppState): string {
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
          <button type="button" data-action="save-and-close-app">Save and Close</button>
          <button type="button" class="danger-button" data-action="close-app-without-saving">Close Without Saving</button>
          <button type="button" data-action="cancel-app-close">Cancel</button>
        </div>
      </section>
    </div>`;
}

function readMcpSettingsForm(data: FormData): McpSettings {
  const parsed = parseMcpSettings(String(data.get('settingsJson') ?? ''));
  const portValue = Number(data.get('port') ?? '');
  const writeAccess = data.get('writeAccess');
  const bearerToken = String(data.get('bearerToken') ?? '').trim();
  return {
    ...(parsed ?? {
      startAutomatically: false,
      port: 8794,
      writeAccess: 'hvyCliEdits',
      bearerToken: generateMcpBearerToken(),
    }),
    startAutomatically: data.get('startAutomatically') === 'on',
    port: Number.isInteger(portValue) && portValue > 0 && portValue <= 65535 ? portValue : 8794,
    writeAccess: isMcpWriteAccess(writeAccess) ? writeAccess : 'hvyCliEdits',
    bearerToken,
  };
}

function parseMcpSettings(value: string): McpSettings | null {
  try {
    const parsed = JSON.parse(value) as McpSettings;
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

function isMcpWriteAccess(value: FormDataEntryValue | null): value is McpSettings['writeAccess'] {
  return value === 'searchOnly' || value === 'hvyCliEdits' || value === 'createImportSave';
}

function isMcpClientInstallTarget(value: string | undefined): value is McpClientInstallTarget {
  return value === 'codex' || value === 'claude';
}

function updateMcpConnectionPreview(form: HTMLFormElement): void {
  const settings = readMcpSettingsForm(new FormData(form));
  const nextUrl = mcpConnectionUrl(settings);
  const httpUrl = form.querySelector<HTMLInputElement>('[data-role="mcp-http-url"]');
  if (httpUrl) httpUrl.value = nextUrl;
}

function updateMcpUrlPreview(form: HTMLFormElement): void {
  const url = form.querySelector<HTMLInputElement>('[data-role="mcp-url"]');
  if (!url || url.dataset.running === 'true') return;
  url.value = mcpConnectionUrl(readMcpSettingsForm(new FormData(form)));
}

function formatShellArgs(args: string[]): string {
  return args.map(shellQuoteArg).join(' ');
}

function shellQuoteArg(arg: string): string {
  if (arg.length === 0) {
    return "''";
  }
  if (/^[A-Za-z0-9_./:=+-]+$/.test(arg)) {
    return arg;
  }
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

function mcpConnectionUrl(settings: McpSettings): string {
  return `http://127.0.0.1:${settings.port ?? 8794}/mcp`;
}

function renderActionConfigField(action: AiActionKey, label: string, settings: AiSettings): string {
  const config = settings.actions[action];
  const effectiveProviderId = config.providerId && config.providerId !== 'default' ? config.providerId : settings.activeProviderId;
  const provider = aiProviderPreset(effectiveProviderId);
  return `
    <fieldset class="ai-action-config">
      <legend>${escapeHtml(label)}</legend>
      <label>
        <span>Provider</span>
        <select name="${action}ProviderId">
          <option value="default" ${config.providerId === 'default' ? 'selected' : ''}>Default (${escapeHtml(provider.name)})</option>
          ${aiProviderPresets.map((option) => `<option value="${escapeAttr(option.id)}" ${option.id === config.providerId ? 'selected' : ''}>${escapeHtml(option.name)}</option>`).join('')}
        </select>
      </label>
      <label>
        <span>Model</span>
        <input name="${action}Model" type="text" value="${escapeAttr(config.model)}" placeholder="${escapeAttr(provider.modelPlaceholder)}" autocomplete="off" spellcheck="false">
      </label>
    </fieldset>`;
}

function readAiSettingsForm(data: FormData): AiSettings {
  const providerId = String(data.get('activeProviderId') ?? '').trim() || 'openai';
  const current: AiProviderConfig = {
    provider: providerId,
    baseUrl: String(data.get('baseUrl') ?? '').trim(),
    apiKey: String(data.get('apiKey') ?? '').trim(),
  };
  const settings = parseAiSettings(String(data.get('settingsJson') ?? '')) ?? {
    activeProviderId: providerId,
    providers: [],
    actions: readActionSettings(data, providerId),
  };
  const providers = [...settings.providers.filter((provider) => provider.provider !== providerId), current];
  return {
    activeProviderId: providerId,
    providers,
    actions: readActionSettings(data, providerId),
    maxContextChars: normalizeAiMaxContextChars(data.get('maxContextChars')),
  };
}

function parseAiSettings(value: string): AiSettings | null {
  try {
    const parsed = JSON.parse(value) as AiSettings;
    return Array.isArray(parsed.providers) && parsed.actions
      ? { ...parsed, maxContextChars: normalizeAiMaxContextChars(parsed.maxContextChars) }
      : null;
  } catch {
    return null;
  }
}

function readActionSettings(data: FormData, fallbackProviderId: string): AiActionSettings {
  return {
    chat: readActionConfig(data, 'chat', fallbackProviderId),
    edit: readActionConfig(data, 'edit', fallbackProviderId),
    importPlanning: readActionConfig(data, 'importPlanning', fallbackProviderId),
    importWriting: readActionConfig(data, 'importWriting', fallbackProviderId),
    importCleanup: readActionConfig(data, 'importCleanup', fallbackProviderId),
    semanticFilter: readActionConfig(data, 'semanticFilter', fallbackProviderId),
    compaction: readActionConfig(data, 'compaction', fallbackProviderId),
  };
}

function readActionConfig(data: FormData, action: AiActionKey, fallbackProviderId: string) {
  return {
    providerId: String(data.get(`${action}ProviderId`) ?? fallbackProviderId).trim() || fallbackProviderId,
    model: String(data.get(`${action}Model`) ?? '').trim(),
  };
}

function normalizeAiMaxContextChars(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 40_000;
}

function activeProviderConfig(settings: AiSettings): AiProviderConfig {
  const preset = aiProviderPreset(settings.activeProviderId);
  return settings.providers.find((provider) => provider.provider === settings.activeProviderId) ?? {
    provider: preset.id,
    baseUrl: preset.baseUrl,
    apiKey: '',
  };
}

function isHvyMode(value: string | undefined): value is HvyMode {
  return value === 'viewer' || value === 'ai' || value === 'editor' || value === 'hvy' || value === 'advanced';
}

function isWorkspaceFilterMode(value: string | undefined): value is HvyDocumentSearchMode {
  return value === 'keyword' || value === 'semantic';
}

function isWorkspaceFilterBehavior(value: string | undefined): value is SearchFilterMode {
  return value === 'deprioritize' || value === 'hide';
}

function formatBackupTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
