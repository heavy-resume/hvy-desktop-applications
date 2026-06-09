import { aiProviderDefaultModel, aiProviderPreset, aiProviderPresets } from './aiProviders';
import { generateMcpBearerToken, type AiActionConfig, type AiActionKey, type AiActionSettings, type AiProviderConfig, type AiSettings, type AppSettings, type ArchivedWorkspace, type DocumentCreationType, type DocumentExtension, type ImageAttachmentMaxDimensions, type McpClientInstallTarget, type McpSettings, type SavedTemplate, type TemplateExtension, type TemplateScope, type Workspace, type WorkspaceFileNode, type WorkspaceTemplateVisibility, type WorkspaceTreeNode } from './backend';
import { colorValueToAlpha, colorValueToPickerHex, getMatchedPaletteId, getMatchedSavedThemeId, getThemeColorLabel, HVY_PALETTES, isCssVariableName, mergeAlphaIntoCssColor, mergePickerHexIntoCssColor, THEME_COLOR_NAMES } from './colorTheme';
import { currentDocumentWorkspacePath, getFileActionAvailability, isWorkspaceTemplatePath } from './fileActions';
import type { HvyMode, VisualDocument } from './hvy';
import { workspacePathForFileInWorkspaces, type AppState, type WorkspaceClipboardState, type WorkspaceFilterState } from './state';
import { richTextActionForShortcutKey, type RichTextAction } from './uiShortcuts';
import { mergeSavedTemplates, templatesForDocumentType, workspaceTemplateVisibility } from './templates';
import appIconUrl from '../src-tauri/icons/Square310x310Logo.png';
import ufoLogoUrl from './assets/ufo-no-bg.svg';
import {
  commitTagEditorDraft,
  handleRemoveTag,
  handleTagEditorInput,
  handleTagEditorKeydown,
  parseTags,
  renderTagEditor,
  serializeTags,
} from '../../heavy-file-format/src/editor/tag-editor';
import { deserializeDocumentBytes } from '../../heavy-file-format/src/serialization';
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
  confirmWorkspaceInitialization(): void;
  cancelWorkspaceInitialization(): void;
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
  setImportOutputMode(mode: 'current' | 'workspace'): void;
  updateImportExcludeTags(tags: string): void;
  updateImportSourceText(text: string): void;
  setImportNewSectionsOnly(newSectionsOnly: boolean): void;
  selectImportWorkspaceSource(path: string): void;
  chooseImportSource(): void;
  createImportedDocument(name: string, templateId: string, instructions: string, pastedSourceText: string, excludeTags: string, newSectionsOnly: boolean): void;
  importIntoCurrent(instructions: string, pastedSourceText: string, excludeTags: string, newSectionsOnly: boolean, outputMode: 'current' | 'workspace', outputName: string): void;
  cancelImport(): void;
  addFilesToWorkspace(workspacePath: string): void;
  addDroppedFilesToWorkspace(workspacePath: string, files: File[]): void;
  openWorkspaceFilter(workspacePath: string): void;
  setWorkspaceFileView(workspacePath: string, view: AppState['workspaceFileViews'][string]): void;
  setWorkspaceExpanded(workspacePath: string, expanded: boolean): void;
  closeWorkspaceFilter(): void;
  setWorkspaceFilterMode(mode: HvyDocumentSearchMode): void;
  setWorkspaceFilterBehavior(mode: SearchFilterMode): void;
  updateWorkspaceFilterQuery(query: string): void;
  submitWorkspaceFilter(): void;
  clearWorkspaceFilter(): void;
  openAbout(): void;
  closeAbout(): void;
  openDebugLog(): void;
  closeDebugLog(): void;
  refreshDebugLog(): void;
  clearDebugLog(): void;
  openAppSettings(): void;
  saveAppSettings(settings: AppSettings): void;
  cancelAppSettings(settings?: AppSettings): void;
  discardAppSettingsChanges(): void;
  keepEditingAppSettings(): void;
  openAiSettings(): void;
  selectAiProvider(providerId: string, settings: AiSettings): void;
  setDefaultAiProvider(settings: AiSettings): void;
  openProviderDocs(url: string): void;
  saveAiSettings(settings: AiSettings): void;
  cancelAiSettings(settings?: AiSettings): void;
  discardAiSettingsChanges(): void;
  keepEditingAiSettings(): void;
  openMcpSettings(): void;
  saveMcpSettings(settings: McpSettings): void;
  cancelMcpSettings(settings?: McpSettings): void;
  discardMcpSettingsChanges(): void;
  keepEditingMcpSettings(): void;
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
  openDocumentColorTheme(): void;
  closeColorTheme(): void;
  updateColorThemeName(name: string): void;
  setDocumentColorsEnabled(enabled: boolean): void;
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
  archiveFile(path: string, currentName: string): void;
  restoreFile(path: string, currentName: string): void;
  setFileLocked(path: string, currentName: string, locked: boolean): void;
  setFileHiddenFromAI(path: string, currentName: string, hiddenFromAI: boolean): void;
  confirmDeleteFile(path: string, currentName: string): void;
  deleteFile(): void;
  cancelDeleteFile(): void;
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
  setSaveAsKind(kind: AppState['saveAsKind']): void;
  setSaveAsScope(scope: 'workspace' | 'anywhere'): void;
  saveAsToWorkspace(workspacePath: string, name: string): void;
  saveAsAnywhere(): void;
  cancelSaveAs(): void;
  closeDocument(): void;
  saveAndCloseDocument(): void;
  openSaveTemplate(): void;
  exportPdf(): void;
  openExportedPdf(): void;
  revealExportedPdf(): void;
  closeExportedPdfDialog(): void;
  saveBeforeExportPdf(): void;
  cancelExportPdfSavePrompt(): void;
  setSaveTemplateScope(scope: TemplateScope): void;
  saveAsTemplate(name: string, scope: TemplateScope, extension: TemplateExtension): void;
  cancelSaveTemplate(): void;
  saveWorkspaceTemplateVisibility(workspacePath: string, visibility: WorkspaceTemplateVisibility): void;
  createFile(): void;
  zoomAppIn(): void;
  zoomAppOut(): void;
  resetAppZoom(): void;
  zoomDocumentIn(): void;
  zoomDocumentOut(): void;
  resetDocumentZoom(): void;
}

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('Missing #app root.');
}

const appRoot = app;
let bindController: AbortController | null = null;
let uiBound = false;
let renderedRenameFilePath: string | null = null;
let activeFileContextMenuCleanup: (() => void) | null = null;
let dismissBackdropPointerStart: HTMLElement | null = null;
let workspaceSidebarWidth = 320;
const MIN_PASTED_IMPORT_CHARS = 50;
const MIN_WORKSPACE_SIDEBAR_WIDTH = 240;
const MAX_WORKSPACE_SIDEBAR_WIDTH = 560;
const DEFAULT_AI_MAX_CONTEXT_CHARS = 40_000;
const AI_MIN_CONTEXT_CHARS = 1_000;
const AI_MAX_CONTEXT_CHARS = 750_000;
const AI_CONTEXT_STEP_CHARS = 1_000;
const DEFAULT_IMAGE_ATTACHMENT_MAX_DIMENSION = 1080;
const MIN_IMAGE_ATTACHMENT_DIMENSION = 1;
const MAX_IMAGE_ATTACHMENT_DIMENSION = 16_384;
const importExcludeTagHelpers = {
  getTagState(target: HTMLElement): string[] {
    return parseTags(importExcludeTagsInput(target)?.value ?? '');
  },
  setTagState(target: HTMLElement, tags: string[]): void {
    const input = importExcludeTagsInput(target);
    if (input) input.value = serializeTags(tags);
  },
  getRenderOptions() {
    return {};
  },
};

function importExcludeTagsInput(target: HTMLElement): HTMLInputElement | null {
  const form = target.closest<HTMLFormElement>('form[data-form="import-document"], form[data-form="import-current"]');
  return form?.querySelector<HTMLInputElement>('input[name="excludeTags"]') ?? null;
}

function commitImportTagEditorDrafts(form: HTMLFormElement, handlers?: UiHandlers): void {
  form.querySelectorAll<HTMLInputElement>('[data-field="search-exclude-tags-input"]').forEach((input) => {
    commitTagEditorDraft(input, importExcludeTagHelpers);
    if (handlers) syncImportExcludeTagsState(input, handlers);
  });
}

function syncImportExcludeTagsState(target: HTMLElement, handlers: UiHandlers): void {
  const input = importExcludeTagsInput(target);
  if (input) handlers.updateImportExcludeTags(input.value);
}

function addImportExcludeTagSuggestion(target: HTMLElement, handlers: UiHandlers): void {
  const tag = target.dataset.tag ?? '';
  const field = target.closest<HTMLElement>('.import-exclude-tags-field');
  const input = field?.querySelector<HTMLInputElement>('[data-field="search-exclude-tags-input"]');
  if (!tag || !input) return;
  input.value = `${tag},`;
  handleTagEditorInput(input, importExcludeTagHelpers);
  syncImportExcludeTagsState(input, handlers);
  updateImportExcludeTagAutocomplete(input);
  input.focus();
}

function updateImportExcludeTagAutocomplete(target: HTMLElement): void {
  const field = target.closest<HTMLElement>('.import-exclude-tags-field');
  const input = field?.querySelector<HTMLInputElement>('[data-field="search-exclude-tags-input"]');
  const menu = field?.querySelector<HTMLElement>('[data-role="import-exclude-tag-suggestions"]');
  if (!field || !input || !menu) return;

  const draft = input.value.trim().toLowerCase();
  const selected = new Set(parseTags(importExcludeTagsInput(input)?.value ?? '').map((tag) => tag.toLowerCase()));
  let visibleCount = 0;
  menu.querySelectorAll<HTMLButtonElement>('[data-tag]').forEach((button) => {
    const tag = button.dataset.tag ?? '';
    const visible = draft.length > 0 && tag.toLowerCase().includes(draft) && !selected.has(tag.toLowerCase());
    button.hidden = !visible;
    if (visible) visibleCount += 1;
  });
  menu.hidden = visibleCount === 0;
}

export function render(state: AppState, handlers: UiHandlers): HTMLElement {
  ensureAppFrame();
  bindOnce(appRoot, handlers, state);
  renderAllAroundDocument(state);
  return hvyMountRoot();
}

export function renderLeftPanel(state: AppState): void {
  const leftPanel = leftPanelRoot();
  const workspaceScrollTop = leftPanel.querySelector<HTMLElement>('.workspaces-section')?.scrollTop ?? 0;
  leftPanel.innerHTML = `
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
    <div class="workspace-sidebar-resizer" role="separator" aria-orientation="vertical" aria-label="Resize workspaces pane"></div>`;
  applyWorkspaceSidebarWidth(appRoot);
  const nextWorkspacesSection = leftPanel.querySelector<HTMLElement>('.workspaces-section');
  if (nextWorkspacesSection) {
    nextWorkspacesSection.scrollTop = workspaceScrollTop;
  }
}

export function renderDocumentControls(state: AppState): void {
  documentControlsRoot().innerHTML = `
    ${renderDocumentTabs(state)}
    <header class="document-toolbar">
      ${renderToolbar(state)}
    </header>
    <div class="error-slot${state.error ? ' has-error' : ''}">${state.error ? escapeHtml(state.error) : ''}</div>`;
  documentModeControlsRoot().innerHTML = state.document ? renderModeControls(state.document.mode, state.document.readOnly, state.document.metaOpen, state.document.hiddenFromAI) : '';
  const mount = hvyMountRoot();
  mount.classList.toggle('hvy-vscode-has-mode-controls', Boolean(state.document));
  if (!state.document || !state.document.mounted) {
    mount.innerHTML = renderEmptyState(state);
  }
}

export function renderModals(state: AppState): void {
  modalRoot().innerHTML = `
    ${renderNewWorkspaceDialog(state)}
    ${renderWorkspaceInitializationDialog(state)}
    ${renderWorkspaceManagerDialog(state)}
    ${renderNewDocumentDialog(state)}
    ${renderImportDialog(state)}
    ${renderImportProgressDialog(state)}
    ${renderSaveAsDialog(state)}
    ${renderExportPdfSavePrompt(state)}
    ${renderExportedPdfDialog(state)}
    ${renderAboutDialog(state)}
    ${renderDebugLogDialog(state)}
    ${renderAppSettingsDialog(state)}
    ${renderAppSettingsDiscardDialog(state)}
    ${renderAiSettingsDialog(state)}
    ${renderAiSettingsDiscardDialog(state)}
    ${renderMcpSettingsDialog(state)}
    ${renderMcpSettingsDiscardDialog(state)}
    ${renderColorThemeDialog(state)}
    ${renderRecoveryDialog(state)}
    ${renderTabStackPopover(state)}
    ${renderCloseDocumentDialog(state)}
    ${renderCloseDocumentDraftDialog(state)}
    ${renderAppCloseDialog(state)}
    ${renderRenameFileDialog(state)}
    ${renderDeleteFileDialog(state)}
    ${renderWorkspaceTransferDialog(state)}
    ${renderWorkspaceFilterDialog(state.workspaceFilter, state.workspaces, state.workspaceFilters)}`;
  refreshRenderedFormState(appRoot, state);
  if (state.aiSettingsDialogOpen) {
    requestAnimationFrame(() => syncAiRangeFields(appRoot));
  }
}

export function renderAllAroundDocument(state: AppState): void {
  renderLeftPanel(state);
  renderDocumentControls(state);
  renderModals(state);
}

function ensureAppFrame(): void {
  if (
    appRoot.querySelector('#leftPanelRoot')
    && appRoot.querySelector('#documentControlsRoot')
    && appRoot.querySelector('#documentModeControlsRoot')
    && appRoot.querySelector('#hvyMount')
    && appRoot.querySelector('[data-app-modal-root="true"]')
  ) {
    return;
  }
  appRoot.innerHTML = `
    <main class="app-shell">
      <aside id="leftPanelRoot" class="workspace-sidebar"></aside>
      <section class="document-shell">
        <div id="documentControlsRoot" class="document-controls-root"></div>
        <div class="document-stage">
          <div id="documentModeControlsRoot"></div>
          <div id="hvyMount" class="document-host"></div>
        </div>
      </section>
      <div id="modalRoot" data-app-modal-root="true"></div>
    </main>`;
  applyWorkspaceSidebarWidth(appRoot);
}

function leftPanelRoot(): HTMLElement {
  return appRoot.querySelector<HTMLElement>('#leftPanelRoot')!;
}

function documentControlsRoot(): HTMLElement {
  return appRoot.querySelector<HTMLElement>('#documentControlsRoot')!;
}

function documentModeControlsRoot(): HTMLElement {
  return appRoot.querySelector<HTMLElement>('#documentModeControlsRoot')!;
}

function hvyMountRoot(): HTMLElement {
  return appRoot.querySelector<HTMLElement>('#hvyMount')!;
}

function modalRoot(): HTMLElement {
  return appRoot.querySelector<HTMLElement>('[data-app-modal-root="true"]')!;
}

function bindOnce(root: HTMLElement, handlers: UiHandlers, state: AppState): void {
  if (uiBound) return;
  uiBound = true;
  bind(root, handlers, state);
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
  window.addEventListener('resize', () => syncAiRangeFields(root), { signal });
  root.addEventListener('pointerdown', (event) => {
    dismissBackdropPointerStart = dismissBackdropFromTarget(event.target);
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-action="add-import-exclude-tag"]') : null;
    if (target) event.preventDefault();
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
        if (backdrop.querySelector('.debug-log-dialog')) {
          handlers.closeDebugLog();
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
          handlers.cancelAppSettings(readAppSettingsForm(new FormData(appSettingsForm)));
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
        if (backdrop.querySelector('[aria-label="PDF exported"]')) {
          handlers.closeExportedPdfDialog();
          return;
        }
        if (backdrop.querySelector('form[data-form="rename-file"]')) {
          handlers.cancelRenameFile();
          return;
        }
        if (backdrop.querySelector('.delete-file-dialog')) {
          handlers.cancelDeleteFile();
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
    if (action === 'confirm-workspace-initialization') handlers.confirmWorkspaceInitialization();
    if (action === 'cancel-workspace-initialization') handlers.cancelWorkspaceInitialization();
    if (action === 'new-document-in-workspace' && target.dataset.workspacePath) handlers.newDocumentInWorkspace(target.dataset.workspacePath);
    if (action === 'set-new-document-type' && isDocumentCreationType(target.dataset.documentType)) handlers.setNewDocumentType(target.dataset.documentType);
    if (action === 'import-in-workspace' && target.dataset.workspacePath) handlers.openImportInWorkspace(target.dataset.workspacePath);
    if (action === 'set-import-document-type' && isDocumentCreationType(target.dataset.documentType)) handlers.setImportDocumentType(target.dataset.documentType);
    if (action === 'add-files-to-workspace' && target.dataset.workspacePath) handlers.addFilesToWorkspace(target.dataset.workspacePath);
    if (action === 'open-workspace-filter' && target.dataset.workspacePath) handlers.openWorkspaceFilter(target.dataset.workspacePath);
    if (action === 'set-workspace-file-view' && target.dataset.workspacePath && isWorkspaceFileView(target.dataset.view)) {
      handlers.setWorkspaceFileView(target.dataset.workspacePath, target.dataset.view);
    }
    if (action === 'close-workspace-filter') handlers.closeWorkspaceFilter();
    if (action === 'set-workspace-filter-mode' && isWorkspaceFilterMode(target.dataset.filterMode)) handlers.setWorkspaceFilterMode(target.dataset.filterMode);
    if (action === 'set-workspace-filter-behavior' && isWorkspaceFilterBehavior(target.dataset.filterBehavior)) handlers.setWorkspaceFilterBehavior(target.dataset.filterBehavior);
    if (action === 'clear-workspace-filter') handlers.clearWorkspaceFilter();
    if (action === 'delete-file') handlers.deleteFile();
    if (action === 'cancel-delete-file') handlers.cancelDeleteFile();
    if (action === 'cancel-new-document') handlers.cancelNewDocument();
    if (action === 'about') handlers.openAbout();
    if (action === 'close-about') handlers.closeAbout();
    if (action === 'app-settings') handlers.openAppSettings();
    if (action === 'cancel-app-settings') {
      const form = target.closest<HTMLFormElement>('form[data-form="app-settings"]');
      handlers.cancelAppSettings(form ? readAppSettingsForm(new FormData(form)) : undefined);
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
    if (action === 'cancel-rename-file') handlers.cancelRenameFile();
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
  root.addEventListener('beforeinput', (event) => {
    const target = event.target instanceof HTMLInputElement ? event.target : null;
    if (!target || target.closest('#hvyMount') || !isFolderlessNameInput(target)) return;
    if (typeof event.data === 'string' && wouldChangeFolderlessNameInput(target, event.data)) {
      event.preventDefault();
    }
  }, { signal });
  root.addEventListener('input', (event) => {
    const target = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ? event.target : null;
    if (target instanceof HTMLInputElement && !target.closest('#hvyMount') && isFolderlessNameInput(target)) {
      stripInvalidCharactersFromNameInput(target);
    }
    const field = target?.dataset.field;
    if (!target || !field || target.closest('#hvyMount')) return;
    const newWorkspaceForm = target.closest<HTMLFormElement>('form[data-form="new-workspace"]');
    if (newWorkspaceForm) updateNewWorkspaceSubmit(newWorkspaceForm);
    const importForm = target.closest<HTMLFormElement>('form[data-form="import-document"], form[data-form="import-current"]');
    if (importForm) updateImportSubmit(importForm);
    if (field === 'workspace-filter-query') {
      handlers.updateWorkspaceFilterQuery(target.value);
      const form = target.closest<HTMLFormElement>('form[data-form="workspace-filter"]');
      if (form) updateWorkspaceFilterSubmit(form);
      return;
    }
    if (field === 'import-source-text') {
      handlers.updateImportSourceText(target.value);
      const form = target.closest<HTMLFormElement>('form[data-form="import-document"], form[data-form="import-current"]');
      if (form) updateImportSubmit(form);
      return;
    }
    if (field === 'search-exclude-tags-input') {
      handleTagEditorInput(target, importExcludeTagHelpers);
      syncImportExcludeTagsState(target, handlers);
      updateImportExcludeTagAutocomplete(target);
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
    if (field === 'max-context-chars' && target instanceof HTMLInputElement) {
      syncAiMaxContextCharsOutput(target);
      return;
    }
    if (field === 'theme-color-filter') {
      const dialog = target.closest<HTMLElement>('.color-theme-dialog');
      if (dialog) applyThemeFilter(dialog, target.value);
      return;
    }
    if (field === 'theme-name') {
      handlers.updateColorThemeName(target.value);
      return;
    }
    if (field === 'use-document-colors' && target instanceof HTMLInputElement) {
      handlers.setDocumentColorsEnabled(target.checked);
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
  root.addEventListener('keydown', (event) => {
    const target = event.target instanceof HTMLInputElement ? event.target : null;
    if (!target || target.closest('#hvyMount')) return;
    if (handleTagEditorKeydown(event, target, importExcludeTagHelpers)) {
      syncImportExcludeTagsState(target, handlers);
      updateImportExcludeTagAutocomplete(target);
    }
  }, { signal });
  root.addEventListener('focusin', (event) => {
    const target = event.target instanceof HTMLInputElement ? event.target : null;
    if (!target || target.closest('#hvyMount') || target.dataset.field !== 'search-exclude-tags-input') return;
    updateImportExcludeTagAutocomplete(target);
  }, { signal });
  root.addEventListener('focusout', (event) => {
    const target = event.target instanceof HTMLInputElement ? event.target : null;
    if (!target || target.closest('#hvyMount') || target.dataset.field !== 'search-exclude-tags-input') return;
    commitTagEditorDraft(target, importExcludeTagHelpers);
    syncImportExcludeTagsState(target, handlers);
    updateImportExcludeTagAutocomplete(target);
  }, { signal });
  root.addEventListener('change', (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target || target.closest('#hvyMount')) return;
    if (target instanceof HTMLInputElement && target.name === 'newSectionsOnly') {
      handlers.setImportNewSectionsOnly(target.checked);
      return;
    }
    if (target instanceof HTMLSelectElement && target.dataset.field === 'import-workspace-source') {
      handlers.selectImportWorkspaceSource(target.value);
      return;
    }
    if (target instanceof HTMLSelectElement && target.dataset.field === 'ai-action-provider') {
      syncAiActionModelForProvider(target);
    }
  }, { signal });
  root.addEventListener('contextmenu', (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const fileButton = target?.closest<HTMLButtonElement>('.tree-file');
    const path = fileButton?.dataset.path;
    const name = fileButton?.dataset.name;
    const archived = fileButton?.dataset.archived === 'true';
    if (fileButton && path && name) {
      const workspacePath = workspacePathForTreeTarget(fileButton, state);
      if (!workspacePath) return;
      event.preventDefault();
      const locked = fileButton.dataset.locked === 'true';
      const hiddenFromAI = fileButton.getAttribute('data-hidden-from-ai') === 'true';
      showFileContextMenu(event, path, name, workspacePath, archived, locked, hiddenFromAI, state.workspaceClipboard, handlers, state.workspaces.length > 1);
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
    if (!details || !workspacePath) return;
    const wasOpen = details.open;
    window.setTimeout(() => {
      if (details.open === wasOpen) return;
      handlers.setWorkspaceExpanded(workspacePath, details.open);
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
      commitImportTagEditorDrafts(form, handlers);
      const data = new FormData(form);
      handlers.createImportedDocument(
        String(data.get('documentName') ?? ''),
        String(data.get('templateId') ?? ''),
        String(data.get('instructions') ?? ''),
        String(data.get('importSourceText') ?? ''),
        String(data.get('excludeTags') ?? ''),
        data.get('newSectionsOnly') === 'on'
      );
    }
    if (form.dataset.form === 'import-current') {
      commitImportTagEditorDrafts(form, handlers);
      const data = new FormData(form);
      const outputMode = String(data.get('importOutputMode') ?? 'current');
      handlers.importIntoCurrent(
        String(data.get('instructions') ?? ''),
        String(data.get('importSourceText') ?? ''),
        String(data.get('excludeTags') ?? ''),
        data.get('newSectionsOnly') === 'on',
        isImportOutputMode(outputMode) ? outputMode : 'current',
        String(data.get('importOutputName') ?? '')
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
    if (form.dataset.form === 'save-as-template') {
      const data = new FormData(form);
      const scope = String(data.get('scope') ?? 'app');
      const extension = data.get('format');
      handlers.saveAsTemplate(
        String(data.get('templateName') ?? ''),
        isTemplateScope(scope) ? scope : 'app',
        isTemplateExtension(extension) ? extension : '.thvy'
      );
    }
    if (form.dataset.form === 'app-settings') {
      const data = new FormData(form);
      handlers.saveAppSettings(readAppSettingsForm(data));
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
    if (form.dataset.form === 'save-as-document') {
      const data = new FormData(form);
      if (String(data.get('scope') ?? 'workspace') === 'anywhere') {
        handlers.saveAsAnywhere();
      } else {
        handlers.saveAsToWorkspace(String(data.get('workspacePath') ?? ''), String(data.get('fileName') ?? ''));
      }
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
    if (root.querySelector('.debug-log-dialog')) {
      event.preventDefault();
      handlers.closeDebugLog();
      return;
    }
    if (root.querySelector('.workspace-manager-dialog')) {
      event.preventDefault();
      handlers.closeWorkspaceManager();
      return;
    }
    if (root.querySelector('.workspace-initialization-dialog')) {
      event.preventDefault();
      handlers.cancelWorkspaceInitialization();
      return;
    }
    if (root.querySelector('.color-theme-dialog')) {
      event.preventDefault();
      handlers.closeColorTheme();
      return;
    }
    if (root.querySelector('.app-settings-discard-dialog')) {
      event.preventDefault();
      handlers.keepEditingAppSettings();
      return;
    }
    if (root.querySelector('.ai-settings-discard-dialog')) {
      event.preventDefault();
      handlers.keepEditingAiSettings();
      return;
    }
    if (root.querySelector('.mcp-settings-discard-dialog')) {
      event.preventDefault();
      handlers.keepEditingMcpSettings();
      return;
    }
    const mcpSettingsForm = target?.closest<HTMLFormElement>('form[data-form="mcp-settings"]')
      ?? root.querySelector<HTMLFormElement>('form[data-form="mcp-settings"]');
    if (mcpSettingsForm) {
      event.preventDefault();
      handlers.cancelMcpSettings(readMcpSettingsForm(new FormData(mcpSettingsForm)));
      return;
    }
    const appSettingsForm = target?.closest<HTMLFormElement>('form[data-form="app-settings"]')
      ?? root.querySelector<HTMLFormElement>('form[data-form="app-settings"]');
    if (appSettingsForm) {
      event.preventDefault();
      handlers.cancelAppSettings(readAppSettingsForm(new FormData(appSettingsForm)));
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
    if (root.querySelector('.delete-file-dialog')) {
      event.preventDefault();
      handlers.cancelDeleteFile();
      return;
    }
    if (root.querySelector('form[data-form="workspace-transfer"]')) {
      event.preventDefault();
      handlers.cancelWorkspaceTransfer();
      return;
    }
    if (root.querySelector('form[data-form="save-as-document"], form[data-form="save-as-template"]')) {
      event.preventDefault();
      handlers.cancelSaveAs();
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
    if (root.querySelector('[aria-label="PDF exported"]')) {
      event.preventDefault();
      handlers.closeExportedPdfDialog();
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
}

function refreshRenderedFormState(root: HTMLElement, state: AppState): void {
  root.querySelectorAll<HTMLFormElement>('form[data-form="new-workspace"]').forEach((form) => {
    updateNewWorkspaceSubmit(form);
  });
  root.querySelectorAll<HTMLFormElement>('form[data-form="workspace-filter"]').forEach((form) => {
    updateWorkspaceFilterSubmit(form);
  });
  root.querySelectorAll<HTMLFormElement>('form[data-form="import-document"], form[data-form="import-current"]').forEach((form) => {
    updateImportSubmit(form);
  });
  if (state.renameFilePath && state.renameFilePath !== renderedRenameFilePath) {
    root.querySelector<HTMLInputElement>('form[data-form="rename-file"] input[name="fileName"]')?.focus();
  }
  renderedRenameFilePath = state.renameFilePath;
}

function dismissBackdropFromTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  return target.classList.contains('modal-backdrop') || target.classList.contains('workspace-filter-backdrop')
    ? target
    : null;
}

const folderlessNameInputNames = new Set(['documentName', 'fileName', 'importOutputName', 'templateName']);
const invalidNameInputCharactersPattern = /[<>:"/\\|?*\x00-\x1f]/g;
const leadingNameInputPeriodsPattern = /^\.+/;

function isFolderlessNameInput(input: HTMLInputElement): boolean {
  return input.type === 'text' && folderlessNameInputNames.has(input.name);
}

function wouldChangeFolderlessNameInput(input: HTMLInputElement, insertedText: string): boolean {
  const selectionStart = input.selectionStart ?? input.value.length;
  const selectionEnd = input.selectionEnd ?? selectionStart;
  const nextValue = `${input.value.slice(0, selectionStart)}${insertedText}${input.value.slice(selectionEnd)}`;
  return sanitizeFolderlessNameInputValue(nextValue) !== nextValue;
}

function stripInvalidCharactersFromNameInput(input: HTMLInputElement): void {
  const sanitized = sanitizeFolderlessNameInputValue(input.value);
  if (sanitized === input.value) return;
  const selectionStart = input.selectionStart ?? input.value.length;
  const sanitizedBeforeSelection = sanitizeFolderlessNameInputValue(input.value.slice(0, selectionStart));
  input.value = sanitized;
  const nextSelection = Math.min(sanitizedBeforeSelection.length, sanitized.length);
  input.setSelectionRange(nextSelection, nextSelection);
}

function sanitizeFolderlessNameInputValue(value: string): string {
  return value
    .replace(invalidNameInputCharactersPattern, '')
    .replace(leadingNameInputPeriodsPattern, '');
}

function handleApplicationShortcut(event: KeyboardEvent, root: HTMLElement, handlers: UiHandlers): boolean {
  if (event.isComposing || event.defaultPrevented) return false;
  if (event.key === 'Escape') {
    handlers.cancelTabStack();
  }
  if (root.querySelector('.modal-backdrop')) return false;

  const key = event.key.toLowerCase();
  const meta = event.metaKey || event.ctrlKey;
  if (!meta) return false;

  if (event.altKey) return false;
  if (event.shiftKey && (key === '=' || key === '+')) {
    event.preventDefault();
    handlers.zoomAppIn();
    return true;
  }
  if (event.shiftKey && (key === '-' || key === '_')) {
    event.preventDefault();
    handlers.zoomAppOut();
    return true;
  }
  if (event.shiftKey && (key === '0' || key === ')')) {
    event.preventDefault();
    handlers.resetAppZoom();
    return true;
  }
  if (!event.shiftKey && (key === '=' || key === '+')) {
    event.preventDefault();
    handlers.zoomDocumentIn();
    return true;
  }
  if (!event.shiftKey && (key === '-' || key === '_')) {
    event.preventDefault();
    handlers.zoomDocumentOut();
    return true;
  }
  if (!event.shiftKey && key === '0') {
    event.preventDefault();
    handlers.resetDocumentZoom();
    return true;
  }

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
  const rawHvyShell = root.querySelector<HTMLElement>('.raw-hvy-shell');
  if (!event.shiftKey && key === 'f' && rawHvyShell) {
    event.preventDefault();
    event.stopImmediatePropagation();
    rawHvyShell.dispatchEvent(new CustomEvent('hvy:open-raw-search'));
    const input = rawHvyShell.querySelector<HTMLInputElement>('[data-field="raw-hvy-search-query"]');
    input?.focus();
    input?.setSelectionRange(0, input.value.length);
    return true;
  }
  if (!event.shiftKey && key === 'b' && rawHvyShell) {
    rawHvyShell.dispatchEvent(new CustomEvent('hvy:toggle-raw-bold'));
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }
  if (!event.shiftKey && key === 'i' && rawHvyShell) {
    rawHvyShell.dispatchEvent(new CustomEvent('hvy:toggle-raw-italic'));
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }
  if (!event.shiftKey && key === 'u' && rawHvyShell) {
    rawHvyShell.dispatchEvent(new CustomEvent('hvy:toggle-raw-underline'));
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }
  if (event.shiftKey && key === 'x' && rawHvyShell) {
    rawHvyShell.dispatchEvent(new CustomEvent('hvy:toggle-raw-strikethrough'));
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }
  const richTextAction = richTextActionForShortcutKey(key, event.shiftKey);
  if (richTextAction && clickActiveRichTextAction(root, richTextAction)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }
  if (!event.shiftKey && key === ',') {
    event.preventDefault();
    handlers.openAppSettings();
    return true;
  }
  return false;
}

function clickActiveRichTextAction(root: HTMLElement, action: RichTextAction): boolean {
  const editable = getActiveRichEditable(root);
  if (!editable) return false;
  const sectionKey = editable.dataset.sectionKey ?? '';
  const blockId = editable.dataset.blockId ?? '';
  const field = editable.dataset.field ?? '';
  const selector = [
    `[data-rich-action="${action}"]`,
    sectionKey ? `[data-section-key="${cssEscape(sectionKey)}"]` : '',
    blockId ? `[data-block-id="${cssEscape(blockId)}"]` : '',
    field ? `[data-field="${cssEscape(field)}"]` : '',
  ].join('');
  const button =
    root.querySelector<HTMLButtonElement>(selector) ??
    editable.closest<HTMLElement>('.editor-block, .table-inline-edit-shell')?.querySelector<HTMLButtonElement>(`[data-rich-action="${action}"]`);
  if (!button) return false;
  button.click();
  return true;
}

function getActiveRichEditable(root: HTMLElement): HTMLElement | null {
  const target = document.activeElement;
  if (!(target instanceof HTMLElement) || !target.closest('#hvyMount')) return null;
  if (!root.contains(target)) return null;
  if (target.isContentEditable && target.dataset.field) return target;
  return target.closest<HTMLElement>('[contenteditable="true"][data-field]');
}

function cssEscape(value: string): string {
  if ('CSS' in window && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replaceAll('"', '\\"');
}

function bindWorkspaceSidebarResize(root: HTMLElement, signal: AbortSignal): void {
  root.addEventListener('pointerdown', (event) => {
    const resizer = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('.workspace-sidebar-resizer') : null;
    if (!resizer) return;
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
      resizer.releasePointerCapture(event.pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };

    resizer.setPointerCapture(event.pointerId);
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
  return workspacePathForFileInWorkspaces(workspaces, filePath);
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

function renderDeleteFileDialog(state: AppState): string {
  if (!state.deleteFilePath || !state.deleteFileName) {
    return '';
  }
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog delete-file-dialog" role="dialog" aria-modal="true" aria-labelledby="deleteFileTitle">
        <h2 id="deleteFileTitle">Delete forever?</h2>
        <p class="dialog-note">${escapeHtml(state.deleteFileName)} will be removed from disk.</p>
        <div class="dialog-actions">
          <button type="button" data-action="cancel-delete-file">Cancel</button>
          <button type="button" class="danger-button" data-action="delete-file" ${state.busy ? 'disabled' : ''}>Delete</button>
        </div>
      </section>
    </div>`;
}

function renderWorkspaceTransferDialog(state: AppState): string {
  const transfer = state.workspaceTransfer;
  if (!transfer) return '';
  const workspaces = state.workspaces.filter((workspace) => workspace.path !== transfer.excludedWorkspacePath);
  const selectedWorkspacePath = workspaces.some((workspace) => workspace.path === state.selectedWorkspacePath)
    ? state.selectedWorkspacePath
    : workspaces[0]?.path ?? null;
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
            ${workspaces.map((workspace) => `<option value="${escapeAttr(workspace.path)}" ${workspace.path === selectedWorkspacePath ? 'selected' : ''}>${escapeHtml(workspace.manifest.name)}</option>`).join('')}
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

function renderSaveAsDialog(state: AppState): string {
  if (!state.saveAsDialogOpen || !state.document) return '';
  const templateDisabled = state.document.extension === '.md';
  if (state.saveAsKind === 'template' && !templateDisabled) {
    return renderSaveAsTemplateDialog(state);
  }
  const workspaces = state.workspaces;
  const workspaceDisabled = workspaces.length === 0;
  const workspaceActive = state.saveAsScope === 'workspace' && !workspaceDisabled;
  const anywhereActive = state.saveAsScope === 'anywhere' || workspaceDisabled;
  const selectedWorkspacePath = workspaces.some((workspace) => workspace.path === state.selectedWorkspacePath)
    ? state.selectedWorkspacePath
    : currentDocumentWorkspacePath(state) ?? workspaces[0]?.path ?? null;
  const name = displayDocumentName(state.document.name);
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="dialog" data-form="save-as-document">
        <h2>Save As...</h2>
        ${renderSaveAsKindControl('document', templateDisabled)}
        <div class="segmented-control" role="tablist" aria-label="Save destination">
          <button type="button" class="${workspaceActive ? 'is-active' : ''}" data-action="set-save-as-scope" data-scope="workspace" aria-pressed="${workspaceActive ? 'true' : 'false'}" ${workspaceDisabled ? 'disabled' : ''}>Workspace</button>
          <button type="button" class="${anywhereActive ? 'is-active' : ''}" data-action="set-save-as-scope" data-scope="anywhere" aria-pressed="${anywhereActive ? 'true' : 'false'}">Anywhere</button>
        </div>
        <input name="scope" type="hidden" value="${escapeAttr(anywhereActive ? 'anywhere' : 'workspace')}">
        ${workspaceActive ? `
          <label>
            <span>Workspace</span>
            <select name="workspacePath" required>
              ${workspaces.map((workspace) => `<option value="${escapeAttr(workspace.path)}" ${workspace.path === selectedWorkspacePath ? 'selected' : ''}>${escapeHtml(workspace.manifest.name)}</option>`).join('')}
            </select>
          </label>
          <label>
            <span>Name</span>
            <input name="fileName" type="text" autocomplete="off" value="${escapeAttr(name)}" required>
          </label>
        ` : `
          <p class="dialog-note">Choose a location outside HVY Galaxy.</p>
        `}
        <div class="dialog-actions">
          <button type="button" data-action="cancel-save-as">Cancel</button>
          ${workspaceActive
            ? `<button type="submit" ${state.busy ? 'disabled' : ''}>Save</button>`
            : `<button type="button" data-action="save-as-anywhere" ${state.busy ? 'disabled' : ''}>Choose Location</button>`}
        </div>
      </form>
    </div>`;
}

function renderSaveAsTemplateDialog(state: AppState): string {
  const workspaceDisabled = !currentDocumentWorkspacePath(state);
  const appActive = state.saveTemplateScope === 'app';
  const workspaceActive = state.saveTemplateScope === 'workspace' && !workspaceDisabled;
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="dialog" data-form="save-as-template">
        <h2>Save As...</h2>
        ${renderSaveAsKindControl('template', false)}
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
        ${state.error ? `<p class="dialog-note" data-state="error" role="alert">${escapeHtml(state.error)}</p>` : ''}
        <div class="dialog-actions">
          <button type="button" data-action="cancel-save-as">Cancel</button>
          <button type="submit" ${state.busy ? 'disabled' : ''}>Save</button>
        </div>
      </form>
    </div>`;
}

function renderSaveAsKindControl(activeKind: AppState['saveAsKind'], templateDisabled: boolean): string {
  return `
    <div class="segmented-control" role="tablist" aria-label="Save as type">
      <button type="button" class="${activeKind === 'document' ? 'is-active' : ''}" data-action="set-save-as-kind" data-kind="document" aria-pressed="${activeKind === 'document' ? 'true' : 'false'}">Document</button>
      <button type="button" class="${activeKind === 'template' ? 'is-active' : ''}" data-action="set-save-as-kind" data-kind="template" aria-pressed="${activeKind === 'template' ? 'true' : 'false'}" ${templateDisabled ? 'disabled' : ''}>Template</button>
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
        <label class="checkbox-row">
          <input type="checkbox" name="archivedFiles" ${visibility.archivedFiles ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
          <span>Archived</span>
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
    archivedFiles: data.has('archivedFiles'),
  };
}

function showFileContextMenu(
  event: MouseEvent,
  path: string,
  name: string,
  workspacePath: string,
  archived: boolean,
  locked: boolean,
  hiddenFromAI: boolean,
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
  menu.innerHTML = archived ? `
    <button type="button" data-menu-action="restore">Restore</button>
    <button type="button" data-menu-action="delete">Delete</button>
  ` : `
    <button type="button" data-menu-action="reveal">${escapeHtml(revealMenuLabel())}</button>
    <button type="button" data-menu-action="${locked ? 'unlock' : 'lock'}">${locked ? 'Unlock File' : 'Lock File'}</button>
    <button type="button" data-menu-action="${hiddenFromAI ? 'unhide-from-ai' : 'hide-from-ai'}">${hiddenFromAI ? 'Unhide from AI' : 'Hide from AI'}</button>
    <button type="button" data-menu-action="rename">Rename</button>
    <button type="button" data-menu-action="archive">Archive</button>
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
    if (button.dataset.menuAction === 'archive') handlers.archiveFile(path, name);
    if (button.dataset.menuAction === 'restore') handlers.restoreFile(path, name);
    if (button.dataset.menuAction === 'lock') handlers.setFileLocked(path, name, true);
    if (button.dataset.menuAction === 'unlock') handlers.setFileLocked(path, name, false);
    if (button.dataset.menuAction === 'hide-from-ai') handlers.setFileHiddenFromAI(path, name, true);
    if (button.dataset.menuAction === 'unhide-from-ai') handlers.setFileHiddenFromAI(path, name, false);
    if (button.dataset.menuAction === 'delete') handlers.confirmDeleteFile(path, name);
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
        <div class="document-tab${tab.active ? ' is-active' : ''}${tab.dirty ? ' is-dirty' : ''}${tab.readOnly ? ' is-read-only' : ''}${tab.hiddenFromAI ? ' is-hidden-from-ai' : ''}">
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
  const showExportPdf = document.extension === '.phvy' && !isWorkspaceTemplatePath(state, document.path);
  const documentColorsEnabled = getDocumentColorsEnabled(state);
  return `
    <div class="toolbar-title">
      <strong title="${escapeAttr(document.path)}">${escapeHtml(document.name)}</strong>
      <span>${document.readOnly ? 'Read-only document' : document.hiddenFromAI ? 'Hidden from AI' : document.isNew ? 'Unsaved document' : 'Document'}</span>
    </div>
    <div class="toolbar-actions">
      <span class="dirty-indicator" data-state="${dirtyState}">${dirtyLabel}</span>
      <label class="document-color-toggle">
        <input type="checkbox" data-field="use-document-colors" ${documentColorsEnabled ? 'checked' : ''} ${document.readOnly ? 'disabled' : ''}>
        <span>Use document colors</span>
      </label>
      <button type="button" data-action="open-document-colors" ${document.readOnly || !documentColorsEnabled ? 'disabled' : ''}>Document Colors...</button>
      <button type="button" data-action="import-into-current" ${fileActions.importCurrent ? '' : 'disabled'}>Import</button>
      ${showExportPdf ? `<button type="button" data-action="export-pdf" ${fileActions.exportPdf ? '' : 'disabled'}>Export PDF</button>` : ''}
    </div>`;
}

function renderModeControls(activeMode: HvyMode, readOnly: boolean, metaOpen: boolean, hiddenFromAI = false): string {
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
    const disabled = (readOnly && mode !== 'viewer') || (hiddenFromAI && mode === 'ai') ? ' disabled' : '';
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
  return `<div class="tree-list">${state.workspaces.map((workspace) => renderWorkspace(workspace, state.selectedFilePath, state.openWorkspaceActionsPath, state.workspaceFilters, state.workspaceClipboard, state.workspaceFileViews[workspace.path] ?? 'documents', state.workspaceExpanded[workspace.path] ?? true, state.savedTemplates)).join('')}</div>`;
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
  fileView: AppState['workspaceFileViews'][string],
  expanded: boolean,
  savedTemplates: SavedTemplate[],
): string {
  const actionsOpen = workspace.path === openWorkspaceActionsPath;
  const filter = activeFilters[workspace.path];
  const matchedDocumentIds = filter
    ? new Set(Object.entries(filter.snapshots).flatMap(([documentId, snapshot]) => snapshot.results.length > 0 ? [documentId] : []))
    : null;
  const filterTitle = filter
    ? `Filter ${workspace.manifest.name}: ${filter.query}`
    : `Filter ${workspace.manifest.name}`;
  const documentsActive = fileView === 'documents';
  const fileViewNodes = filterNodesByWorkspaceFileView(workspace.files, fileView, workspace, savedTemplates);
  const visibleFiles = documentsActive
    ? filterNodesByTemplateVisibility(fileViewNodes, workspaceTemplateVisibility(workspace))
    : filterNodesByArchivedVisibility(fileViewNodes, workspaceTemplateVisibility(workspace).archivedFiles);
  return `
    <details class="workspace-root" data-workspace-path="${escapeAttr(workspace.path)}"${expanded ? ' open' : ''}>
      <summary title="${escapeAttr(workspace.path)}">
        <span>${escapeHtml(workspace.manifest.name)}</span>
      </summary>
      <button type="button" class="workspace-filter-trigger${filter ? ' is-active' : ''}" data-action="open-workspace-filter" data-workspace-path="${escapeAttr(workspace.path)}" title="${escapeAttr(filterTitle)}" aria-label="${escapeAttr(filterTitle)}">${funnelIcon()}</button>
      <div class="workspace-view-toggle segmented-control" aria-label="${escapeAttr(`${workspace.manifest.name} view`)}">
        <button type="button" class="${documentsActive ? 'is-active' : ''}" data-action="set-workspace-file-view" data-workspace-path="${escapeAttr(workspace.path)}" data-view="documents" aria-pressed="${documentsActive ? 'true' : 'false'}">Docs</button>
        <button type="button" class="${documentsActive ? '' : 'is-active'}" data-action="set-workspace-file-view" data-workspace-path="${escapeAttr(workspace.path)}" data-view="templates" aria-pressed="${documentsActive ? 'false' : 'true'}">Templates</button>
      </div>
      <div class="workspace-actions-menu${actionsOpen ? ' is-open' : ''}">
        <button type="button" class="workspace-action-trigger" data-action="toggle-workspace-actions" data-workspace-path="${escapeAttr(workspace.path)}" title="Workspace actions" aria-label="Workspace actions" aria-expanded="${actionsOpen ? 'true' : 'false'}">+</button>
        <div class="workspace-action-popover" role="menu" ${actionsOpen ? '' : 'hidden'}>
          <button type="button" role="menuitem" data-action="new-document-in-workspace" data-workspace-path="${escapeAttr(workspace.path)}">New</button>
          <button type="button" role="menuitem" data-action="add-files-to-workspace" data-workspace-path="${escapeAttr(workspace.path)}">Add</button>
          <button type="button" role="menuitem" data-action="import-in-workspace" data-workspace-path="${escapeAttr(workspace.path)}">Import</button>
        </div>
      </div>
      ${visibleFiles.length === 0 ? '' : `<ul class="tree">${sortNodesForFilter(visibleFiles, matchedDocumentIds).map((node) => renderNode(node, selectedFilePath, matchedDocumentIds, workspaceClipboard)).join('')}</ul>`}
    </details>`;
}

function isWorkspaceFileView(value: unknown): value is AppState['workspaceFileViews'][string] {
  return value === 'documents' || value === 'templates';
}

function filterNodesByWorkspaceFileView(
  nodes: WorkspaceTreeNode[],
  view: AppState['workspaceFileViews'][string],
  workspace: Workspace,
  savedTemplates: SavedTemplate[],
  includeSavedTemplateFallback = true,
): WorkspaceTreeNode[] {
  const visibleNodes: WorkspaceTreeNode[] = [];
  for (const node of nodes) {
    const relativePath = typeof node.relativePath === 'string' ? node.relativePath : '';
    const inTemplateFolder = relativePath === 'templates' || relativePath.startsWith('templates/');
    if (node.kind === 'folder') {
      const children = filterNodesByWorkspaceFileView(node.children, view, workspace, savedTemplates, false);
      if (children.length > 0) visibleNodes.push({ ...node, children });
      continue;
    }
    if (view === 'templates' && !inTemplateFolder) continue;
    if (view === 'documents' && inTemplateFolder) continue;
    visibleNodes.push(node);
  }
  if (view === 'templates' && includeSavedTemplateFallback) {
    const existingPaths = new Set(visibleNodes.flatMap(flatNodePaths));
    const archivedPaths = new Set(workspace.manifest.archivedFiles ?? []);
    const templateFiles = savedTemplates
      .filter((template) => template.scope === 'workspace' && template.path.startsWith(workspace.path) && !existingPaths.has(template.path))
      .map((template): WorkspaceTreeNode => {
        const relativePath = `templates/${template.name}`;
        return {
          kind: 'file',
          name: template.name,
          path: template.path,
          relativePath,
          extension: template.extension,
          archived: archivedPaths.has(relativePath),
        };
      });
    if (templateFiles.length > 0) {
      const templatesFolder = visibleNodes.find((node) => node.kind === 'folder' && (node.relativePath === 'templates' || node.name === 'templates'));
      if (templatesFolder?.kind === 'folder') {
        templatesFolder.children = [...templatesFolder.children, ...templateFiles];
      } else {
        visibleNodes.push({
          kind: 'folder',
          name: 'templates',
          path: `${workspace.path.replace(/\/+$/, '')}/templates`,
          relativePath: 'templates',
          children: templateFiles,
        });
      }
    }
  }
  return visibleNodes;
}

function flatNodePaths(node: WorkspaceTreeNode): string[] {
  return node.kind === 'folder' ? node.children.flatMap(flatNodePaths) : [node.path];
}

function filterNodesByArchivedVisibility(nodes: WorkspaceTreeNode[], showArchived: boolean): WorkspaceTreeNode[] {
  const visibleNodes: WorkspaceTreeNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'folder') {
      const children = filterNodesByArchivedVisibility(node.children, showArchived);
      if (children.length > 0) visibleNodes.push({ ...node, children });
      continue;
    }
    if (node.archived && !showArchived) continue;
    visibleNodes.push(node);
  }
  return visibleNodes;
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
    if (node.archived && !visibility.archivedFiles) continue;
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
  const archived = node.archived === true;
  const locked = node.locked === true;
  const hiddenFromAI = node.hiddenFromAI === true;
  const extensionBadge = node.extension === '.thvy' || node.extension === '.phvy'
    ? `<span class="tree-file-extension" data-extension="${escapeAttr(node.extension)}">${escapeHtml(node.extension)}</span>`
    : '';
  return `
    <li>
      <button type="button" class="tree-file${selected}${noFilterMatch ? ' is-filter-empty' : ''}${cutPending ? ' is-cut-pending' : ''}${archived ? ' is-archived' : ''}${locked ? ' is-locked' : ''}${hiddenFromAI ? ' is-hidden-from-ai' : ''}" data-action="select-file" data-path="${escapeAttr(node.path)}" data-name="${escapeAttr(node.name)}" data-archived="${archived ? 'true' : 'false'}" data-locked="${locked ? 'true' : 'false'}" data-hidden-from-ai="${hiddenFromAI ? 'true' : 'false'}" ${cutPending ? 'aria-label="' + escapeAttr(`${displayDocumentName(node.name)} cut`) + '"' : ''}>
        <span class="tree-file-name">${escapeHtml(displayDocumentName(node.name))}</span>
        ${archived ? '<span class="tree-file-archived">Archived</span>' : ''}
        ${locked ? '<span class="tree-file-archived">Locked</span>' : ''}
        ${hiddenFromAI ? '<span class="tree-file-ai-hidden" title="Hidden from AI">AI</span>' : ''}
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

function renderWorkspaceInitializationDialog(state: AppState): string {
  if (!state.workspaceInitializationDialogOpen || !state.workspaceInitializationPath) {
    return '';
  }
  const name = state.workspaceInitializationName ?? state.workspaceInitializationPath;
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog workspace-initialization-dialog" role="dialog" aria-modal="true" aria-labelledby="workspaceInitializationTitle">
        <h2 id="workspaceInitializationTitle">Create Workspace Manifest?</h2>
        <p class="dialog-note">${escapeHtml(name)} is not a workspace yet. Create .hvyworkspace.json in this folder?</p>
        <div class="dialog-actions">
          <button type="button" data-action="cancel-workspace-initialization">Cancel</button>
          <button type="button" data-action="confirm-workspace-initialization" ${state.busy ? 'disabled' : ''}>Create</button>
        </div>
      </section>
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

function isImportOutputMode(value: unknown): value is AppState['importOutputMode'] {
  return value === 'current' || value === 'workspace';
}

function isSaveAsScope(value: unknown): value is AppState['saveAsScope'] {
  return value === 'workspace' || value === 'anywhere';
}

function isSaveAsKind(value: unknown): value is AppState['saveAsKind'] {
  return value === 'document' || value === 'template';
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
  const hasValidSource = Boolean(source) || state.importSourceTextDraft.trim().length >= MIN_PASTED_IMPORT_CHARS;
  const sourceControls = importCurrent
    ? renderImportCurrentSourceControls(state, workspace)
    : renderAnywhereImportSourceControls(source, state.importSourceTextDraft);
  const outputControls = importCurrent ? renderImportCurrentOutputControls(state, workspace) : '';
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="dialog wide-dialog" data-form="${importCurrent ? 'import-current' : 'import-document'}">
        <h2>${escapeHtml(title)}</h2>
        ${importCurrent ? '<p class="dialog-note">Uses the current file as an import template, and saves the result to the output file.</p>' : ''}
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
        ${outputControls}
        <label>
          <span>Instructions</span>
          <textarea name="instructions" rows="4" placeholder="Optional import guidance"></textarea>
        </label>
        ${renderImportOptions(state)}
        <div class="dialog-actions">
          <button type="button" data-action="cancel-import">Cancel</button>
          <button type="submit" data-role="import-submit" data-has-file-source="${source ? 'true' : 'false'}" data-base-disabled="${baseDisabled ? 'true' : 'false'}" ${baseDisabled || !hasValidSource ? 'disabled' : ''}>Import</button>
        </div>
      </form>
    </div>`;
}

function renderImportCurrentOutputControls(state: AppState, workspace: AppState['workspaces'][number] | null): string {
  const workspaceDisabled = !workspace;
  const workspaceActive = state.importOutputMode === 'workspace' && !workspaceDisabled;
  const currentActive = state.importOutputMode === 'current' || workspaceDisabled;
  const outputName = suggestedImportOutputName(state, workspace);
  return `
    <div class="field-group">
      <span>Output</span>
      <div class="segmented-control" role="tablist" aria-label="Import output">
        <button type="button" class="${workspaceActive ? 'is-active' : ''}" data-action="set-import-output-mode" data-mode="workspace" aria-pressed="${workspaceActive ? 'true' : 'false'}" ${workspaceDisabled ? 'disabled' : ''}>Workspace File</button>
        <button type="button" class="${currentActive ? 'is-active' : ''}" data-action="set-import-output-mode" data-mode="current" aria-pressed="${currentActive ? 'true' : 'false'}">Current File</button>
      </div>
      <input name="importOutputMode" type="hidden" value="${escapeAttr(workspaceActive ? 'workspace' : 'current')}">
      ${workspaceActive ? `
        <label>
          <span>Name</span>
          <input name="importOutputName" type="text" autocomplete="off" value="${escapeAttr(outputName)}" required>
        </label>
      ` : ''}
    </div>`;
}

function renderImportOptions(state: AppState): string {
  const tagField = shouldShowImportExcludeTagsField(state)
    ? renderImportExcludeTagsField(state.importExcludeTags, collectImportSourceTagSuggestions(state.importSource))
    : '<input name="excludeTags" type="hidden" value="">';
  return `
    ${tagField}
    <label class="checkbox-row">
      <input name="newSectionsOnly" type="checkbox" ${state.importNewSectionsOnly ? 'checked' : ''}>
      <span>Only import new sections</span>
    </label>`;
}

function renderImportExcludeTagsField(value: string, suggestions: string[]): string {
  return `
    <label class="import-exclude-tags-field">
      <span>Filter out tags</span>
      ${renderTagEditor('search-exclude-tags', value, { placeholder: 'Add tag to filter out' }, { escapeAttr, escapeHtml })}
      <input name="excludeTags" type="hidden" value="${escapeAttr(serializeTags(parseTags(value)))}">
      ${suggestions.length > 0 ? `
        <div class="import-exclude-tag-suggestions" data-role="import-exclude-tag-suggestions" hidden>
          ${suggestions.map((tag) => `<button type="button" data-action="add-import-exclude-tag" data-tag="${escapeAttr(tag)}">${escapeHtml(tag)}</button>`).join('')}
        </div>
      ` : ''}
    </label>`;
}

function shouldShowImportExcludeTagsField(state: AppState): boolean {
  return Boolean(state.importSource?.bytes && isImportSourceDocumentExtension(state.importSource.extension));
}

function collectImportSourceTagSuggestions(source: AppState['importSource']): string[] {
  if (!source?.bytes || !isImportSourceDocumentExtension(source.extension)) {
    return [];
  }
  return collectDocumentTags(deserializeDocumentBytes(new Uint8Array(source.bytes), source.extension));
}

function isImportSourceDocumentExtension(extension: NonNullable<AppState['importSource']>['extension']): extension is DocumentExtension {
  return extension === '.hvy' || extension === '.thvy' || extension === '.phvy' || extension === '.md';
}

function collectDocumentTags(document: VisualDocument): string[] {
  const tags = new Map<string, string>();
  const visit = (item: unknown): void => {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    Object.entries(item as Record<string, unknown>).forEach(([key, child]) => {
      if (key === 'tags' && typeof child === 'string') {
        parseTagSuggestions(child).forEach((tag) => tags.set(tag.toLowerCase(), tag));
      } else {
        visit(child);
      }
    });
  };
  visit(document.meta);
  visit(document.sections);
  return [...tags.values()].sort((left, right) => left.localeCompare(right));
}

function parseTagSuggestions(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(/[,\s]+/)
    .map((tag) => tag.trim())
    .filter((tag) => {
      if (!tag || seen.has(tag.toLowerCase())) {
        return false;
      }
      seen.add(tag.toLowerCase());
      return true;
    });
}

function suggestedImportOutputName(state: AppState, workspace: AppState['workspaces'][number] | null): string {
  const base = `${displayDocumentName(state.document?.name ?? 'Imported')} import`;
  if (!workspace || !state.document) {
    return base;
  }
  const extension = importOutputExtension(state.document.extension);
  const existing = new Set(workspace.files
    .filter((node): node is Extract<WorkspaceTreeNode, { kind: 'file' }> => node.kind === 'file')
    .map((node) => node.name.toLowerCase()));
  if (!existing.has(`${base}${extension}`.toLowerCase())) {
    return base;
  }
  let index = 1;
  while (existing.has(`${base} (${index})${extension}`.toLowerCase())) {
    index += 1;
  }
  return `${base} (${index})`;
}

function importOutputExtension(extension: NonNullable<AppState['document']>['extension']): '.hvy' | '.phvy' {
  return extension === '.phvy' ? '.phvy' : '.hvy';
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
    ${workspaceActive ? renderImportCurrentWorkspaceSourcePicker(state, workspaceFiles) : renderAnywhereImportSourceControls(state.importSource, state.importSourceTextDraft)}
  `;
}

function renderAnywhereImportSourceControls(source: AppState['importSource'], sourceTextDraft = ''): string {
  const sourceText = sourceTextDraft || (source?.extension === '.pdf' || source?.extension === '.docx' ? source.text ?? '' : '');
  const sourceNote = source
    ? 'Using selected file unless pasted text is provided.'
    : sourceText.trim().length > 0
    ? `${Math.min(sourceText.trim().length, MIN_PASTED_IMPORT_CHARS)}/${MIN_PASTED_IMPORT_CHARS} characters.`
    : 'Choose a file or paste at least 50 characters.';
  return `
    <div class="source-picker-row">
      <button type="button" data-action="choose-import-source">Choose file</button>
      <span>${source ? escapeHtml(source.name) : 'No source selected'}</span>
    </div>
    <textarea name="importSourceText" class="import-source-textarea" data-field="import-source-text" rows="8" placeholder="Or paste at least 50 characters of source text here">${escapeHtml(sourceText)}</textarea>
    <p class="dialog-note" data-role="import-source-note">${escapeHtml(sourceNote)}</p>`;
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

function renderExportedPdfDialog(state: AppState): string {
  if (!state.exportedPdfPath) return '';
  const name = state.exportedPdfPath.split(/[\\/]/).filter(Boolean).pop() ?? 'PDF';
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog" role="dialog" aria-modal="true" aria-label="PDF exported">
        <h2>PDF Exported</h2>
        <p class="dialog-note">${escapeHtml(name)}</p>
        <div class="dialog-actions">
          <button type="button" data-action="open-exported-pdf">Open</button>
          <button type="button" data-action="reveal-exported-pdf">${escapeHtml(revealMenuLabel())}</button>
          <button type="button" data-action="close-exported-pdf-dialog">Done</button>
        </div>
      </section>
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
        <p class="about-version">Version ${escapeHtml(__APP_VERSION__)}</p>
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

function renderDebugLogDialog(state: AppState): string {
  if (!state.debugLogDialogOpen) {
    return '';
  }
  const entries = state.debugLogEntries;
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog wide-dialog debug-log-dialog" role="dialog" aria-modal="true" aria-labelledby="debugLogTitle">
        <div class="debug-log-header">
          <div>
            <h2 id="debugLogTitle">Debug Log</h2>
            <p class="dialog-note">Snapshot of recent load, close, LLM prompt, and performance events. Refresh to update.</p>
          </div>
          <div class="debug-log-actions">
            <button type="button" data-action="refresh-debug-log">Refresh</button>
            <button type="button" data-action="clear-debug-log">Clear</button>
          </div>
        </div>
        <div class="debug-log-list">
          ${entries.length
            ? entries.map(renderDebugLogEntry).join('')
            : '<p class="debug-log-empty">No debug entries yet.</p>'}
        </div>
        <div class="dialog-actions">
          <button type="button" data-action="close-debug-log">Done</button>
        </div>
      </section>
    </div>`;
}

function renderDebugLogEntry(entry: AppState['debugLogEntries'][number]): string {
  const details = entry.details ? JSON.stringify(entry.details, null, 2) : '';
  const duration = typeof entry.details?.durationMs === 'number'
    ? `${entry.details.durationMs.toFixed(1)} ms`
    : typeof entry.durationMs === 'number'
    ? `${entry.durationMs.toFixed(1)} ms`
    : '';
  return `
    <article class="debug-log-entry" data-kind="${escapeAttr(entry.kind)}">
      <div class="debug-log-entry-summary">
        <span class="debug-log-kind">${escapeHtml(entry.kind)}</span>
        <strong>${escapeHtml(entry.label)}</strong>
        ${duration ? `<span class="debug-log-duration">${escapeHtml(duration)}</span>` : ''}
        <time datetime="${escapeAttr(entry.startedAt)}">${escapeHtml(formatDebugLogTime(entry.startedAt))}</time>
      </div>
      ${details ? `<pre>${escapeHtml(details)}</pre>` : ''}
    </article>`;
}

function formatDebugLogTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function renderAppSettingsDialog(state: AppState): string {
  if (!state.appSettingsDialogOpen) {
    return '';
  }
  const settings = state.appSettingsDraft ?? state.appSettings;
  const imageAttachmentMaxDimensions = normalizeImageAttachmentMaxDimensions(settings.imageAttachmentMaxDimensions);
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="dialog" data-form="app-settings">
        <h2>Settings</h2>
        <p class="dialog-note">Configure application defaults used when a document does not set its own value.</p>
        <textarea name="settingsJson" hidden>${escapeHtml(JSON.stringify(settings))}</textarea>
        <fieldset class="ai-action-config">
          <legend>Attached image defaults</legend>
          <label>
            <span>Reduce width</span>
            <input
              name="imageAttachmentMaxWidth"
              type="number"
              min="${MIN_IMAGE_ATTACHMENT_DIMENSION}"
              max="${MAX_IMAGE_ATTACHMENT_DIMENSION}"
              step="1"
              value="${escapeAttr(String(imageAttachmentMaxDimensions.width))}"
            >
          </label>
          <label>
            <span>Reduce height</span>
            <input
              name="imageAttachmentMaxHeight"
              type="number"
              min="${MIN_IMAGE_ATTACHMENT_DIMENSION}"
              max="${MAX_IMAGE_ATTACHMENT_DIMENSION}"
              step="1"
              value="${escapeAttr(String(imageAttachmentMaxDimensions.height))}"
            >
          </label>
        </fieldset>
        <div class="dialog-actions">
          <button type="button" data-action="cancel-app-settings">Cancel</button>
          <button type="submit" ${state.busy ? 'disabled' : ''}>Save</button>
        </div>
      </form>
    </div>`;
}

function renderAppSettingsDiscardDialog(state: AppState): string {
  if (!state.appSettingsDiscardDialogOpen) {
    return '';
  }
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog app-settings-discard-dialog" role="dialog" aria-modal="true" aria-labelledby="appSettingsDiscardTitle">
        <h2 id="appSettingsDiscardTitle">Discard Settings Changes?</h2>
        <p class="dialog-note">You have unsaved settings changes.</p>
        <div class="dialog-actions">
          <button type="button" class="danger-button" data-action="discard-app-settings-changes">Discard Changes</button>
          <button type="button" data-action="keep-editing-app-settings">Keep Editing</button>
        </div>
      </section>
    </div>`;
}

function renderAiSettingsDialog(state: AppState): string {
  if (!state.aiSettingsDialogOpen) {
    return '';
  }
  const settings = state.aiSettingsDraft ?? state.aiSettings;
  const selectedProviderId = state.aiSettingsSelectedProviderId ?? settings.activeProviderId;
  const providerConfig = aiProviderConfig(settings, selectedProviderId);
  const provider = aiProviderPreset(selectedProviderId);
  const maxContextChars = normalizeAiMaxContextChars(settings.maxContextChars);
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="dialog wide-dialog" data-form="ai-settings">
        <h2>LLM Settings</h2>
        <p class="dialog-note">Configure providers once, then choose the provider and model each action should use.</p>
        <textarea name="settingsJson" hidden>${escapeHtml(JSON.stringify(settings))}</textarea>
        <input name="selectedProviderId" type="hidden" value="${escapeAttr(selectedProviderId)}">
        <div class="ai-provider-picker" aria-label="Configured AI providers">
          <span>Providers</span>
          <div>
            ${aiProviderPresets.map((option) => `
              <button
                type="button"
                class="${option.id === selectedProviderId ? 'is-active' : ''}"
                data-action="select-ai-provider"
                data-provider-id="${escapeAttr(option.id)}"
                aria-pressed="${option.id === selectedProviderId ? 'true' : 'false'}"
              >${escapeHtml(option.name)}</button>
            `).join('')}
          </div>
        </div>
        <button type="button" class="provider-docs-link" data-action="provider-docs" data-provider-docs data-url="${escapeAttr(provider.docsUrl)}">Setup instructions</button>
        <input name="activeProviderId" type="hidden" value="${escapeAttr(settings.activeProviderId)}">
        <label class="checkbox-row ai-default-provider-row">
          <input
            name="defaultProvider"
            type="checkbox"
            data-action="set-default-ai-provider"
            ${selectedProviderId === settings.activeProviderId ? 'checked' : ''}
          >
          <span>Use ${escapeHtml(provider.name)} as the default provider</span>
        </label>
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
        <label class="ai-range-field">
          <span>Maximum import chunk size</span>
          <input
            name="maxContextChars"
            data-field="max-context-chars"
            type="range"
            min="${AI_MIN_CONTEXT_CHARS}"
            max="${AI_MAX_CONTEXT_CHARS}"
            step="${AI_CONTEXT_STEP_CHARS}"
            value="${escapeAttr(String(maxContextChars))}"
          >
          <output data-role="max-context-chars-output">${escapeHtml(formatAiMaxContextChars(maxContextChars))}</output>
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

function renderAiSettingsDiscardDialog(state: AppState): string {
  if (!state.aiSettingsDiscardDialogOpen) {
    return '';
  }
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog ai-settings-discard-dialog" role="dialog" aria-modal="true" aria-labelledby="aiSettingsDiscardTitle">
        <h2 id="aiSettingsDiscardTitle">Discard LLM Settings Changes?</h2>
        <p class="dialog-note">Your unsaved provider and model changes will be lost.</p>
        <div class="dialog-actions">
          <button type="button" class="danger-button" data-action="discard-ai-settings-changes">Discard Changes</button>
          <button type="button" data-action="keep-editing-ai-settings">Keep Editing</button>
        </div>
      </section>
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
              <option value="hvyCliEdits" ${settings.writeAccess === 'hvyCliEdits' ? 'selected' : ''}>CLI based editor</option>
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

function renderMcpSettingsDiscardDialog(state: AppState): string {
  if (!state.mcpSettingsDiscardDialogOpen) {
    return '';
  }
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog mcp-settings-discard-dialog" role="dialog" aria-modal="true" aria-labelledby="mcpSettingsDiscardTitle">
        <h2 id="mcpSettingsDiscardTitle">Discard MCP Settings Changes?</h2>
        <p class="dialog-note">Your unsaved MCP server changes will be lost.</p>
        <div class="dialog-actions">
          <button type="button" class="danger-button" data-action="discard-mcp-settings-changes">Discard Changes</button>
          <button type="button" data-action="keep-editing-mcp-settings">Keep Editing</button>
        </div>
      </section>
    </div>`;
}

function renderColorThemeDialog(state: AppState): string {
  if (!state.colorThemeDialogOpen) {
    return '';
  }
  const documentMode = state.colorThemeDialogMode === 'document';
  const documentTheme = getDocumentTheme(state);
  const colors = documentMode ? documentTheme.colors : state.colorTheme.colors;
  const selectedPaletteId = getMatchedPaletteId(colors);
  const selectedCustomThemeId = getMatchedSavedThemeId(colors, state.colorTheme.savedThemes);
  const themeName = documentMode
    ? documentTheme.name || selectedThemeName(selectedPaletteId, selectedCustomThemeId, state, colors) || 'Untitled Theme'
    : state.colorTheme.themeName || selectedThemeName(selectedPaletteId, selectedCustomThemeId, state, colors) || 'Untitled Theme';
  const activeThemeName = selectedThemeName(selectedPaletteId, selectedCustomThemeId, state, colors) || themeName;
  const title = documentMode ? 'Document Colors' : 'Colors';
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog wide-dialog color-theme-dialog" role="dialog" aria-modal="true" aria-labelledby="colorThemeTitle" style="${escapeAttr(renderThemeVariableStyle(colors))}">
        <h2 id="colorThemeTitle">${escapeHtml(title)}</h2>
        ${renderThemeSwitcher(state, selectedPaletteId, selectedCustomThemeId, activeThemeName, colors, true)}
        ${renderThemePreviewPanel(true)}
        <div class="theme-filter-shell">
          <span>Filter Colors</span>
          <input type="search" placeholder="Type a role, component, or click a preview" data-field="theme-color-filter">
        </div>
        <div class="theme-color-list">
          ${THEME_COLOR_NAMES.map((name) => renderThemeColorRow(name, colors[name] ?? '', getResolvedThemeColor(name, colors[name]), true)).join('')}
        </div>
      </section>
    </div>`;
}

function renderThemeVariableStyle(colors: Record<string, string>): string {
  return Object.entries(colors)
    .filter(([name, value]) => isCssVariableName(name) && value.trim())
    .map(([name, value]) => `${name}: ${value.trim()};`)
    .join(' ');
}

function getDocumentColorsEnabled(state: AppState): boolean {
  return Boolean(state.document?.path && state.recent.documentColorUses?.[state.document.path] === true);
}

function getDocumentTheme(state: AppState): { name: string; colors: Record<string, string> } {
  const theme = state.document?.mounted?.document.meta.theme;
  if (!theme || typeof theme !== 'object' || Array.isArray(theme)) return { name: '', colors: {} };
  const record = theme as { name?: unknown; colors?: unknown };
  const colors = record.colors && typeof record.colors === 'object' && !Array.isArray(record.colors)
    ? Object.fromEntries(Object.entries(record.colors).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    : {};
  return {
    name: typeof record.name === 'string' ? record.name : '',
    colors,
  };
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

function renderThemeSwitcher(state: AppState, selectedPaletteId: string | null, selectedCustomThemeId: string | null, activeThemeName: string, colors: Record<string, string>, enabled: boolean): string {
  return `
    <details class="theme-switcher"${enabled ? '' : ' aria-disabled="true"'}>
      <summary>
        <span class="theme-switcher-copy">
          <span>Switch to theme ...</span>
          <strong>${escapeHtml(activeThemeName)}</strong>
        </span>
        <span class="theme-switcher-chevron" aria-hidden="true">v</span>
      </summary>
      <div class="theme-palette-grid" aria-label="Theme palettes">
        ${renderThemeCards(state, selectedPaletteId, selectedCustomThemeId, colors, enabled)}
      </div>
    </details>`;
}

function renderThemeCards(state: AppState, selectedPaletteId: string | null, selectedCustomThemeId: string | null, colors: Record<string, string>, enabled = true): string {
  const cards: ThemeCard[] = [
    {
      id: 'default',
      name: 'Default',
      description: 'Use the built-in HVY colors.',
      colors: {},
      builtIn: true,
      selected: selectedCustomThemeId === null && selectedPaletteId === null && Object.keys(colors).length === 0,
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
    .map((theme) => renderThemeCard(theme, enabled))
    .join('');
}

function renderThemeCard(theme: ThemeCard, enabled = true): string {
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
        <button type="button" data-action="theme-select" data-theme-id="${escapeAttr(theme.id)}" ${enabled ? '' : 'disabled'}>${theme.selected ? 'Using' : 'Use'}</button>
        ${theme.builtIn ? '' : `<button type="button" class="ghost" data-action="theme-delete" data-theme-id="${escapeAttr(theme.id)}" ${enabled ? '' : 'disabled'}>Delete</button>`}
      </div>
    </article>`;
}

function selectedThemeName(paletteId: string | null, customThemeId: string | null, state: AppState, colors = state.colorTheme.colors): string | null {
  if (customThemeId) return state.colorTheme.savedThemes.find((theme) => theme.id === customThemeId)?.name ?? null;
  if (paletteId) return HVY_PALETTES.find((palette) => palette.id === paletteId)?.name ?? null;
  return Object.keys(colors).length === 0 ? 'Default' : null;
}

interface ThemePreviewItem {
  id: string;
  label: string;
  detail: string;
  className: string;
  variables: string[];
  states: Array<{ id: string; label: string; variables: string[] }>;
  html: string;
}

function renderThemePreviewPanel(enabled: boolean): string {
  const items: ThemePreviewItem[] = [
    {
      id: 'surface',
      label: 'Surface',
      detail: 'Page, panel, container, and focused target colors',
      className: 'theme-preview-surface-card',
      variables: ['--hvy-bg', '--hvy-bg-alt', '--hvy-surface', '--hvy-surface-alt', '--hvy-surface-tint', '--hvy-border', '--hvy-text', '--hvy-text-alt', '--hvy-focus-ring', '--hvy-focus-glow'],
      states: [
        { id: 'rest', label: 'Rest', variables: ['--hvy-bg', '--hvy-bg-alt', '--hvy-surface', '--hvy-border', '--hvy-text'] },
        { id: 'target', label: 'Target', variables: ['--hvy-surface-tint', '--hvy-focus-ring', '--hvy-focus-glow'] },
      ],
      html: `<div class="theme-demo-surface">
        <div class="theme-demo-page">
          <div class="theme-demo-container">
            <strong>Container</strong>
            <span>Collapsed preview text</span>
          </div>
          <button type="button" class="theme-demo-target theme-demo-ai-target" data-theme-demo-state="target" data-action="theme-filter-to-colors" data-theme-filter="--hvy-surface-tint --hvy-focus-ring --hvy-focus-glow" ${enabled ? '' : 'disabled'}>AI target</button>
        </div>
      </div>`,
    },
    {
      id: 'text',
      label: 'Text',
      detail: 'Primary text, muted text, links, fill-ins, and highlights',
      className: 'theme-preview-text-card',
      variables: ['--hvy-text', '--hvy-text-alt', '--hvy-text-muted', '--hvy-link-color', '--hvy-link-hover-color', '--hvy-highlight-1', '--hvy-highlight-2', '--hvy-focus-ring'],
      states: [
        { id: 'rest', label: 'Rest', variables: ['--hvy-text', '--hvy-text-alt', '--hvy-text-muted', '--hvy-link-color'] },
        { id: 'search', label: 'Search', variables: ['--hvy-highlight-1', '--hvy-highlight-2'] },
        { id: 'fill-in', label: 'Fill-in', variables: ['--hvy-text-muted', '--hvy-focus-ring'] },
      ],
      html: `<div class="theme-demo-text">
        <p data-theme-demo-state="rest">Paragraph with <span>alternate text</span> and an <a href="#" tabindex="-1">inline link</a>.</p>
        <div class="theme-demo-highlight" data-theme-demo-state="search"><span>Filtered match</span><b>active result</b></div>
        <div class="theme-demo-fill-in" data-theme-demo-state="fill-in">The answer is <span>[____]</span>.</div>
      </div>`,
    },
    {
      id: 'controls',
      label: 'Controls',
      detail: 'Button, input, and ghost component controls',
      className: 'theme-preview-button-card',
      variables: ['--hvy-button-bg', '--hvy-button-text', '--hvy-button-hover-bg', '--hvy-button-hover-text', '--hvy-border-input', '--hvy-ghost-border', '--hvy-focus', '--hvy-shadow-md'],
      states: [
        { id: 'rest', label: 'Rest', variables: ['--hvy-button-bg', '--hvy-button-text', '--hvy-border-input'] },
        { id: 'hover', label: 'Hover', variables: ['--hvy-button-hover-bg', '--hvy-button-hover-text', '--hvy-focus', '--hvy-shadow-md'] },
        { id: 'ghost', label: 'Ghost', variables: ['--hvy-surface-alt', '--hvy-ghost-border', '--hvy-text-muted'] },
      ],
      html: `<div class="theme-demo-controls">
        <button type="button" class="theme-demo-button" data-theme-demo-state="rest" ${enabled ? '' : 'disabled'}>Generate</button>
        <button type="button" class="theme-demo-button theme-demo-button-hover" data-theme-demo-state="hover" ${enabled ? '' : 'disabled'}>Generate</button>
        <div class="theme-demo-ghost-input" data-theme-demo-state="ghost">Add component</div>
      </div>`,
    },
    {
      id: 'xref',
      label: 'Xref Card',
      detail: 'Reference cards in rest, hover, and invalid states',
      className: 'theme-preview-xref-card',
      variables: ['--hvy-xref-card-bg', '--hvy-xref-card-hover-bg', '--hvy-border', '--hvy-border-alt', '--hvy-focus', '--hvy-text', '--hvy-text-alt', '--hvy-text-muted', '--hvy-shadow', '--hvy-shadow-md'],
      states: [
        { id: 'rest', label: 'Rest', variables: ['--hvy-xref-card-bg', '--hvy-border', '--hvy-text', '--hvy-text-alt', '--hvy-shadow'] },
        { id: 'hover', label: 'Hover', variables: ['--hvy-xref-card-hover-bg', '--hvy-focus', '--hvy-shadow-md'] },
        { id: 'invalid', label: 'Invalid', variables: ['--hvy-border-alt', '--hvy-text-muted'] },
      ],
      html: `<div class="theme-demo-xref-stack">
        <div class="theme-demo-xref" data-theme-demo-state="rest"><strong>TypeScript</strong><span>Primary language</span></div>
        <div class="theme-demo-xref theme-demo-xref-hover" data-theme-demo-state="hover"><strong>TypeScript</strong><span>Primary language</span></div>
        <div class="theme-demo-xref theme-demo-xref-invalid" data-theme-demo-state="invalid"><strong>Missing target</strong><span>Invalid reference</span></div>
      </div>`,
    },
    {
      id: 'table',
      label: 'Table',
      detail: 'Header and alternating row colors',
      className: 'theme-preview-table-card',
      variables: ['--hvy-table-header', '--hvy-table-row-bg-1', '--hvy-table-row-bg-2', '--hvy-border-input', '--hvy-text'],
      states: [
        { id: 'header', label: 'Header', variables: ['--hvy-table-header', '--hvy-text', '--hvy-border-input'] },
        { id: 'row-1', label: 'Row 1', variables: ['--hvy-table-row-bg-1', '--hvy-text', '--hvy-border-input'] },
        { id: 'row-2', label: 'Row 2', variables: ['--hvy-table-row-bg-2', '--hvy-text', '--hvy-border-input'] },
      ],
      html: `<table class="theme-demo-table">
        <thead><tr><th>Name</th><th>Role</th></tr></thead>
        <tbody>
          <tr><td>Ada</td><td>Engineer</td></tr>
          <tr><td>Grace</td><td>Compiler</td></tr>
        </tbody>
      </table>`,
    },
    {
      id: 'status',
      label: 'Status',
      detail: 'Warnings, errors, and success feedback',
      className: 'theme-preview-status-card',
      variables: ['--hvy-warning-bg', '--hvy-warning-border', '--hvy-warning-text', '--hvy-danger', '--hvy-success', '--hvy-success-bg', '--hvy-success-border'],
      states: [
        { id: 'warning', label: 'Warning', variables: ['--hvy-warning-bg', '--hvy-warning-border', '--hvy-warning-text'] },
        { id: 'error', label: 'Error', variables: ['--hvy-danger', '--hvy-surface', '--hvy-border'] },
        { id: 'success', label: 'Success', variables: ['--hvy-success', '--hvy-success-bg', '--hvy-success-border'] },
      ],
      html: `<div class="theme-demo-diagnostics">
        <span class="theme-demo-warning" data-theme-demo-state="warning">Warning</span>
        <span class="theme-demo-error" data-theme-demo-state="error">Error</span>
        <span class="theme-demo-success" data-theme-demo-state="success">Saved</span>
      </div>`,
    },
    {
      id: 'code',
      label: 'Code',
      detail: 'Code block and syntax colors',
      className: 'theme-preview-code-card',
      variables: ['--hvy-code-bg', '--hvy-code-text', '--hvy-code-muted', '--hvy-code-string', '--hvy-code-builtin', '--hvy-code-keyword', '--hvy-code-function', '--hvy-code-number', '--hvy-border-input'],
      states: [
        { id: 'block', label: 'Block', variables: ['--hvy-code-bg', '--hvy-code-text', '--hvy-code-muted', '--hvy-border-input'] },
        { id: 'syntax', label: 'Syntax', variables: ['--hvy-code-string', '--hvy-code-builtin', '--hvy-code-keyword', '--hvy-code-function', '--hvy-code-number'] },
      ],
      html: `<pre class="theme-demo-code" data-theme-demo-state="block"><code><i>// theme</i>
<span>const</span> value = <b>"HVY"</b>;</code></pre>
      <pre class="theme-demo-code" data-theme-demo-state="syntax"><code><span>const</span> value = <b>"HVY"</b>;</code></pre>`,
    },
  ];
  return `
    <div class="theme-component-preview-picker" aria-label="Theme component preview picker">
      ${items.map((item, index) => `<button type="button" class="theme-component-picker-button${index === 0 ? ' is-active' : ''}" data-action="theme-preview-select-component" data-theme-component="${escapeAttr(item.id)}" ${enabled ? '' : 'disabled'}>${escapeHtml(item.label)}</button>`).join('')}
    </div>
    <div class="theme-preview-grid" aria-label="Theme component preview">
      ${items.map((item, index) => renderThemePreviewCard(item, index, enabled)).join('')}
    </div>`;
}

function renderThemePreviewCard(item: ThemePreviewItem, index: number, enabled: boolean): string {
  const stateButtons = item.states.map((previewState, stateIndex) => `<button
    type="button"
    class="theme-preview-state-button${stateIndex === 0 ? ' is-active' : ''}"
    data-action="theme-preview-set-state"
    data-theme-state="${escapeAttr(previewState.id)}"
    data-theme-filter="${escapeAttr(previewState.variables.join(' '))}"
    ${enabled ? '' : 'disabled'}
  >${escapeHtml(previewState.label)}</button>`).join('');
  return `<article
    class="theme-preview-card ${escapeAttr(item.className)}${index === 0 ? ' is-active' : ''}"
    data-theme-preview-component="${escapeAttr(item.id)}"
    data-theme-preview-state="${escapeAttr(item.states[0]?.id ?? 'rest')}"
  >
    <span class="theme-preview-card-copy">
      <strong>${escapeHtml(item.label)}</strong>
      <span>${escapeHtml(item.detail)}</span>
    </span>
    <span class="theme-preview-state-row">${stateButtons}</span>
    ${item.html}
    <button
      type="button"
      class="theme-preview-all"
      data-action="theme-filter-to-colors"
      data-theme-filter="${escapeAttr(item.variables.join(' '))}"
      ${enabled ? '' : 'disabled'}
    >All ${escapeHtml(item.label)} colors</button>
  </article>`;
}

function renderThemeColorRow(name: string, value: string, displayValue: string, enabled = true): string {
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
        ${enabled ? '' : 'disabled'}
      >
      <input
        class="theme-color-value"
        data-field="theme-color-value"
        data-color-name="${escapeAttr(name)}"
        value="${escapeAttr(displayValue)}"
        placeholder="CSS color"
        aria-label="${escapeAttr(valueLabel)}"
        spellcheck="false"
        ${enabled ? '' : 'disabled'}
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
          ${enabled ? '' : 'disabled'}
        >
        <output>${escapeHtml(String(Math.round(alphaValue * 100)))}</output>
      </label>
      <span class="theme-color-swatch" style="${displayValue ? `background: ${escapeAttr(displayValue)};` : ''}" aria-hidden="true"></span>
      ${overridden
        ? `<span class="theme-color-reset-group"><button type="button" class="ghost theme-color-action" data-action="theme-reset-color" data-color-name="${escapeAttr(name)}" title="Reset to default" ${enabled ? '' : 'disabled'}>Reset</button></span>`
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

function applyThemeColorFilter(target: HTMLElement): void {
  const dialog = target.closest<HTMLElement>('.color-theme-dialog');
  const input = dialog?.querySelector<HTMLInputElement>('[data-field="theme-color-filter"]');
  if (!dialog || !input) return;
  input.value = target.dataset.themeFilter ?? '';
  applyThemeFilter(dialog, input.value);
  input.focus();
}

function applyThemeFilter(dialog: HTMLElement, value: string): void {
  const tokens = themeFilterTokens(value);
  dialog.querySelectorAll<HTMLElement>('.theme-color-row').forEach((row) => {
    row.hidden = tokens.length > 0 && !tokens.some((token) => (row.dataset.themeSearch ?? '').includes(token));
  });
}

function themeFilterTokens(value: string): string[] {
  return value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
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
  const model = aiActionModelForProvider(config, effectiveProviderId, action);
  const modelsByProvider = aiActionModelsByProvider(config, effectiveProviderId, model);
  return `
    <fieldset class="ai-action-config">
      <legend>${escapeHtml(label)}</legend>
      <textarea name="${action}ModelsByProvider" hidden>${escapeHtml(JSON.stringify(modelsByProvider))}</textarea>
      <label>
        <span>Provider</span>
        <select name="${action}ProviderId" data-field="ai-action-provider" data-action-key="${escapeAttr(action)}" data-effective-provider-id="${escapeAttr(effectiveProviderId)}">
          <option value="default" ${config.providerId === 'default' ? 'selected' : ''}>Default (${escapeHtml(provider.name)})</option>
          ${aiProviderPresets.map((option) => `<option value="${escapeAttr(option.id)}" ${option.id === config.providerId ? 'selected' : ''}>${escapeHtml(option.name)}</option>`).join('')}
        </select>
      </label>
      <label>
        <span>Model</span>
        <input name="${action}Model" type="text" value="${escapeAttr(model)}" placeholder="${escapeAttr(provider.modelPlaceholder)}" autocomplete="off" spellcheck="false">
      </label>
    </fieldset>`;
}

function readAppSettingsForm(data: FormData): AppSettings {
  return {
    ...parseAppSettings(String(data.get('settingsJson') ?? '')),
    imageAttachmentMaxDimensions: normalizeImageAttachmentMaxDimensions({
      width: data.get('imageAttachmentMaxWidth'),
      height: data.get('imageAttachmentMaxHeight'),
    }),
  };
}

function parseAppSettings(value: string): AppSettings {
  try {
    const parsed = JSON.parse(value) as Partial<AppSettings>;
    return {
      imageAttachmentMaxDimensions: normalizeImageAttachmentMaxDimensions(parsed.imageAttachmentMaxDimensions),
    };
  } catch {
    return {
      imageAttachmentMaxDimensions: normalizeImageAttachmentMaxDimensions(null),
    };
  }
}

function readAiSettingsForm(data: FormData): AiSettings {
  const selectedProviderId = String(data.get('selectedProviderId') ?? data.get('activeProviderId') ?? '').trim() || 'openai';
  const parsed = parseAiSettings(String(data.get('settingsJson') ?? ''));
  const activeProviderId = data.get('defaultProvider') === 'on'
    ? selectedProviderId
    : String(data.get('activeProviderId') ?? parsed?.activeProviderId ?? selectedProviderId).trim() || selectedProviderId;
  const current: AiProviderConfig = {
    provider: selectedProviderId,
    baseUrl: String(data.get('baseUrl') ?? '').trim(),
    apiKey: String(data.get('apiKey') ?? '').trim(),
  };
  const settings = parsed ?? {
    activeProviderId,
    providers: [],
    actions: readActionSettings(data, activeProviderId),
  };
  const providers = [...settings.providers.filter((provider) => provider.provider !== selectedProviderId), current];
  return {
    activeProviderId,
    providers,
    actions: readActionSettings(data, activeProviderId),
    maxContextChars: normalizeAiMaxContextChars(data.get('maxContextChars')),
  };
}

function parseAiSettings(value: string): AiSettings | null {
  try {
    const parsed = JSON.parse(value) as AiSettings;
    return Array.isArray(parsed.providers) && parsed.actions
      ? normalizeAiSettingsForForm(parsed)
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
  const providerId = String(data.get(`${action}ProviderId`) ?? fallbackProviderId).trim() || fallbackProviderId;
  const effectiveProviderId = providerId === 'default' ? fallbackProviderId : providerId;
  const modelsByProvider = parseAiActionModelsByProvider(String(data.get(`${action}ModelsByProvider`) ?? ''));
  const previousDefaultProviderId = String(data.get('activeProviderId') ?? '').trim();
  const modelInput = String(data.get(`${action}Model`) ?? '').trim();
  if (providerId === 'default' && previousDefaultProviderId && previousDefaultProviderId !== fallbackProviderId && modelInput) {
    modelsByProvider[previousDefaultProviderId] = modelInput;
  }
  const model = providerId === 'default' && previousDefaultProviderId && previousDefaultProviderId !== fallbackProviderId
    ? modelsByProvider[effectiveProviderId] || aiProviderDefaultModel(effectiveProviderId, action)
    : modelInput || aiProviderDefaultModel(effectiveProviderId, action);
  modelsByProvider[effectiveProviderId] = model;
  return {
    providerId,
    model,
    modelsByProvider,
  };
}

function normalizeAiSettingsForForm(settings: AiSettings): AiSettings {
  const activeProviderId = settings.activeProviderId || 'openai';
  return {
    ...settings,
    activeProviderId,
    maxContextChars: normalizeAiMaxContextChars(settings.maxContextChars),
    actions: {
      chat: normalizeAiActionConfigForForm(settings.actions.chat, activeProviderId, 'chat'),
      edit: normalizeAiActionConfigForForm(settings.actions.edit, activeProviderId, 'edit'),
      importPlanning: normalizeAiActionConfigForForm(settings.actions.importPlanning, activeProviderId, 'importPlanning'),
      importWriting: normalizeAiActionConfigForForm(settings.actions.importWriting, activeProviderId, 'importWriting'),
      importCleanup: normalizeAiActionConfigForForm(settings.actions.importCleanup, activeProviderId, 'importCleanup'),
      semanticFilter: normalizeAiActionConfigForForm(settings.actions.semanticFilter, activeProviderId, 'semanticFilter'),
      compaction: normalizeAiActionConfigForForm(settings.actions.compaction, activeProviderId, 'compaction'),
    },
  };
}

function normalizeAiActionConfigForForm(config: AiActionConfig | undefined, activeProviderId: string, action: AiActionKey): AiActionConfig {
  const providerId = config?.providerId?.trim() || 'default';
  const effectiveProviderId = providerId === 'default' ? activeProviderId : providerId;
  const model = config?.model?.trim() || aiProviderDefaultModel(effectiveProviderId, action);
  return {
    providerId,
    model,
    modelsByProvider: aiActionModelsByProvider(config, effectiveProviderId, model),
  };
}

function aiActionModelsByProvider(config: AiActionConfig | undefined, effectiveProviderId: string, model: string): Record<string, string> {
  const modelsByProvider = { ...(config?.modelsByProvider ?? {}) };
  modelsByProvider[effectiveProviderId] = model;
  return modelsByProvider;
}

function aiActionModelForProvider(config: AiActionConfig, providerId: string, action: AiActionKey): string {
  return config.modelsByProvider?.[providerId]?.trim() || aiProviderDefaultModel(providerId, action);
}

function parseAiActionModelsByProvider(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([providerId, model]) => [providerId.trim(), String(model).trim()])
        .filter(([providerId, model]) => providerId && model)
    );
  } catch {
    return {};
  }
}

function syncAiActionModelForProvider(select: HTMLSelectElement): void {
  const form = select.closest<HTMLFormElement>('form[data-form="ai-settings"]');
  const fieldset = select.closest<HTMLFieldSetElement>('.ai-action-config');
  const action = select.dataset.actionKey as AiActionKey | undefined;
  const modelInput = fieldset?.querySelector<HTMLInputElement>('input[name$="Model"]');
  const modelsInput = fieldset?.querySelector<HTMLTextAreaElement>('textarea[name$="ModelsByProvider"]');
  if (!form || !fieldset || !action || !modelInput || !modelsInput) return;
  const activeProviderId = String(new FormData(form).get('activeProviderId') ?? '').trim() || 'openai';
  const providerId = select.value === 'default' ? activeProviderId : select.value;
  const modelsByProvider = parseAiActionModelsByProvider(modelsInput.value);
  const previousProviderId = select.dataset.effectiveProviderId || activeProviderId;
  const previousModel = modelInput.value.trim();
  if (previousProviderId && previousModel) {
    modelsByProvider[previousProviderId] = previousModel;
  }
  const provider = aiProviderPreset(providerId);
  modelInput.value = modelsByProvider[providerId] || aiProviderDefaultModel(providerId, action);
  modelInput.placeholder = provider.modelPlaceholder;
  select.dataset.effectiveProviderId = providerId;
  modelsInput.value = JSON.stringify(modelsByProvider);
}

function normalizeAiMaxContextChars(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_AI_MAX_CONTEXT_CHARS;
  const stepped = Math.round(parsed / AI_CONTEXT_STEP_CHARS) * AI_CONTEXT_STEP_CHARS;
  return Math.min(AI_MAX_CONTEXT_CHARS, Math.max(AI_MIN_CONTEXT_CHARS, stepped));
}

function normalizeImageAttachmentMaxDimensions(value: unknown): ImageAttachmentMaxDimensions {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as { width?: unknown; height?: unknown }
    : {};
  return {
    width: normalizeImageAttachmentDimension(record.width),
    height: normalizeImageAttachmentDimension(record.height),
  };
}

function normalizeImageAttachmentDimension(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_IMAGE_ATTACHMENT_MAX_DIMENSION;
  return Math.min(MAX_IMAGE_ATTACHMENT_DIMENSION, Math.max(MIN_IMAGE_ATTACHMENT_DIMENSION, Math.floor(parsed)));
}

function syncAiMaxContextCharsOutput(input: HTMLInputElement): void {
  const output = input
    .closest<HTMLElement>('.ai-range-field')
    ?.querySelector<HTMLOutputElement>('[data-role="max-context-chars-output"]');
  if (output) {
    output.value = formatAiMaxContextChars(input.value);
    output.textContent = output.value;
  }
  syncAiRangeFill(input);
}

function syncAiRangeFields(root: ParentNode): void {
  root.querySelectorAll<HTMLInputElement>('input[data-field="max-context-chars"]').forEach(syncAiMaxContextCharsOutput);
}

function syncAiRangeFill(input: HTMLInputElement): void {
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  const range = max - min;
  const progress = Number.isFinite(range) && range > 0
    ? Math.min(1, Math.max(0, (value - min) / range))
    : 0;
  const thumbSize = Number.parseFloat(getComputedStyle(input).getPropertyValue('--range-thumb-size')) || 18;
  const width = input.getBoundingClientRect().width;
  const fillEnd = (thumbSize / 2) + progress * Math.max(0, width - thumbSize);
  input.style.setProperty('--range-fill-end', `${fillEnd}px`);
}

function formatAiMaxContextChars(value: unknown): string {
  return `${new Intl.NumberFormat().format(normalizeAiMaxContextChars(value))} chars`;
}

function aiProviderConfig(settings: AiSettings, providerId: string): AiProviderConfig {
  const preset = aiProviderPreset(providerId);
  return settings.providers.find((provider) => provider.provider === providerId) ?? {
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
