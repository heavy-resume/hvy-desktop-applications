import { aiProviderPreset, aiProviderPresets } from './aiProviders';
import { type AiActionKey, type AiActionSettings, type AiProviderConfig, type AiSettings, type Workspace, type WorkspaceTreeNode } from './backend';
import { colorValueToPickerHex, getMatchedPaletteId, getThemeColorLabel, HVY_PALETTES, THEME_COLOR_NAMES } from './colorTheme';
import type { HvyMode } from './hvy';
import type { AppState } from './state';
import { hvyTemplates } from './templates';

export interface UiHandlers {
  newWorkspace(): void;
  toggleWorkspaceActions(path: string): void;
  closeWorkspaceActions(): void;
  createWorkspace(name: string, location: 'managed' | 'choose'): void;
  setNewWorkspaceLocation(location: 'managed' | 'choose'): void;
  cancelNewWorkspace(): void;
  newDocumentInWorkspace(workspacePath: string): void;
  createDocumentInWorkspace(name: string, templateId: string): void;
  cancelNewDocument(): void;
  addFilesToWorkspace(workspacePath: string): void;
  openAiSettings(): void;
  selectAiProvider(providerId: string, settings: AiSettings): void;
  openProviderDocs(url: string): void;
  saveAiSettings(settings: AiSettings): void;
  cancelAiSettings(settings?: AiSettings): void;
  openColorTheme(): void;
  closeColorTheme(): void;
  updateColorTheme(name: string, value: string): void;
  resetColorTheme(name: string): void;
  addColorThemeColor(): void;
  removeColorThemeColor(name: string): void;
  renameColorThemeColor(oldName: string, newName: string): void;
  applyColorThemePalette(id: string | null): void;
  restoreBackup(id: string): void;
  cancelRecovery(): void;
  openWorkspace(): void;
  openFile(): void;
  openRecentWorkspace(path: string): void;
  openRecentFile(path: string): void;
  selectFile(path: string): void;
  refreshWorkspace(path: string): void;
  showFileInFolder(path: string): void;
  renameFile(path: string, currentName: string): void;
  setMode(mode: HvyMode): void;
  save(): void;
  saveAs(): void;
  createFile(): void;
}

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('Missing #app root.');
}

const appRoot = app;
let bindController: AbortController | null = null;
let activeFileContextMenuCleanup: (() => void) | null = null;

export function render(state: AppState, handlers: UiHandlers, options: { preserveMount?: HTMLElement | null } = {}): HTMLElement {
  appRoot.innerHTML = `
    <main class="app-shell">
      <aside class="workspace-sidebar">
        <div class="sidebar-header">
          <div>
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
          </div>
          <button type="button" class="secondary-action" data-action="new-workspace">New Workspace</button>
          ${renderWorkspaces(state)}
        </section>
      </aside>
      <section class="document-shell">
        <header class="document-toolbar">
          ${renderToolbar(state)}
        </header>
        <div class="error-slot${state.error ? ' has-error' : ''}">${state.error ? escapeHtml(state.error) : ''}</div>
        <div class="document-stage">
          ${state.document ? renderModeControls(state.document.mode, state.document.readOnly) : ''}
          <div id="hvyMount" class="document-host${state.document ? ' hvy-vscode-has-mode-controls' : ''}">
            ${renderEmptyState(state)}
          </div>
        </div>
      </section>
      ${renderNewWorkspaceDialog(state)}
      ${renderNewDocumentDialog(state)}
      ${renderAiSettingsDialog(state)}
      ${renderColorThemeDialog(state)}
      ${renderRecoveryDialog(state)}
    </main>`;

  const nextMount = appRoot.querySelector<HTMLElement>('#hvyMount')!;
  if (options.preserveMount && state.document) {
    nextMount.replaceWith(options.preserveMount);
  }
  bind(appRoot, handlers);
  return options.preserveMount && state.document ? options.preserveMount : nextMount;
}

function bind(root: HTMLElement, handlers: UiHandlers): void {
  bindController?.abort();
  bindController = new AbortController();
  const { signal } = bindController;
  root.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target) {
      const backdrop = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('.modal-backdrop') : null;
      if (backdrop && backdrop === event.target) {
        if (backdrop.querySelector('.color-theme-dialog')) {
          handlers.closeColorTheme();
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
    if (action === 'new-workspace') handlers.newWorkspace();
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
    if (action === 'add-files-to-workspace' && target.dataset.workspacePath) handlers.addFilesToWorkspace(target.dataset.workspacePath);
    if (action === 'cancel-new-document') handlers.cancelNewDocument();
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
    if (action === 'cancel-color-theme') handlers.closeColorTheme();
    if (action === 'theme-add-color') handlers.addColorThemeColor();
    if (action === 'theme-apply-palette') handlers.applyColorThemePalette(target.dataset.paletteId ?? null);
    if (action === 'theme-clear-palette') handlers.applyColorThemePalette(null);
    if (action === 'theme-reset-color' && target.dataset.colorName) handlers.resetColorTheme(target.dataset.colorName);
    if (action === 'theme-remove-color' && target.dataset.colorName) handlers.removeColorThemeColor(target.dataset.colorName);
    if (action === 'restore-backup' && target.dataset.backupId) handlers.restoreBackup(target.dataset.backupId);
    if (action === 'cancel-recovery') handlers.cancelRecovery();
    if (action === 'open-workspace') handlers.openWorkspace();
    if (action === 'open-file') handlers.openFile();
    if (action === 'set-mode' && isHvyMode(target.dataset.mode)) handlers.setMode(target.dataset.mode);
    if (action === 'save') handlers.save();
    if (action === 'save-as') handlers.saveAs();
    if (action === 'create-file') handlers.createFile();
    if (action === 'select-file' && target.dataset.path) handlers.selectFile(target.dataset.path);
  }, { signal });
  root.addEventListener('input', (event) => {
    const target = event.target instanceof HTMLInputElement ? event.target : null;
    const field = target?.dataset.field;
    if (!target || !field || target.closest('#hvyMount')) return;
    if (field === 'theme-color-filter') {
      const dialog = target.closest<HTMLElement>('.color-theme-dialog');
      const filter = target.value.trim().toLowerCase();
      dialog?.querySelectorAll<HTMLElement>('.theme-color-row').forEach((row) => {
        row.hidden = filter.length > 0 && !(row.dataset.themeSearch ?? '').includes(filter);
      });
      return;
    }
    if (field !== 'theme-color-picker' && field !== 'theme-color-value') return;
    const name = target.dataset.colorName ?? '';
    if (!name) return;
    const row = target.closest<HTMLElement>('.theme-color-row');
    const valueInput = row?.querySelector<HTMLInputElement>('[data-field="theme-color-value"]');
    const pickerInput = row?.querySelector<HTMLInputElement>('[data-field="theme-color-picker"]');
    if (field === 'theme-color-picker' && valueInput) valueInput.value = target.value;
    if (field === 'theme-color-value' && pickerInput) pickerInput.value = colorValueToPickerHex(target.value);
    row?.classList.toggle('theme-color-row--override', target.value.trim().length > 0);
    handlers.updateColorTheme(name, target.value);
  }, { signal });
  root.addEventListener('change', (event) => {
    const target = event.target instanceof HTMLInputElement ? event.target : null;
    if (target?.dataset.field !== 'theme-color-name') return;
    const oldName = target.dataset.colorName ?? '';
    const newName = target.value.trim();
    if (oldName && newName && oldName !== newName) handlers.renameColorThemeColor(oldName, newName);
  }, { signal });
  root.addEventListener('contextmenu', (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const fileButton = target?.closest<HTMLButtonElement>('.tree-file');
    const path = fileButton?.dataset.path;
    const name = fileButton?.dataset.name;
    if (!fileButton || !path || !name) return;
    event.preventDefault();
    showFileContextMenu(event, path, name, handlers);
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
    if (form.dataset.form === 'new-document') {
      const data = new FormData(form);
      handlers.createDocumentInWorkspace(
        String(data.get('documentName') ?? ''),
        String(data.get('templateId') ?? '')
      );
    }
    if (form.dataset.form === 'ai-settings') {
      const data = new FormData(form);
      handlers.saveAiSettings(readAiSettingsForm(data));
    }
  }, { signal });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (root.querySelector('.color-theme-dialog')) {
      event.preventDefault();
      handlers.closeColorTheme();
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
}

function showFileContextMenu(event: MouseEvent, path: string, name: string, handlers: UiHandlers): void {
  closeFileContextMenu();
  const menu = document.createElement('div');
  menu.className = 'file-context-menu';
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
  menu.innerHTML = `
    <button type="button" data-menu-action="reveal">${escapeHtml(revealMenuLabel())}</button>
    <button type="button" data-menu-action="rename">Rename</button>
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

function renderToolbar(state: AppState): string {
  const document = state.document;
  if (!document) {
    return `
      <div class="toolbar-title">No document selected</div>
      <div class="toolbar-actions">
        <button type="button" data-action="create-file">New HVY</button>
      </div>`;
  }
  const dirtyState = document.readOnly ? 'read-only' : document.dirty ? 'dirty' : 'clean';
  const dirtyLabel = document.readOnly ? 'Read only' : document.dirty ? 'Unsaved' : 'Saved';
  return `
    <div class="toolbar-title">
      <strong>${escapeHtml(document.name)}</strong>
      <span>${document.readOnly ? 'Read-only guide' : document.isNew ? 'Unsaved document' : escapeHtml(document.path)}</span>
    </div>
    <div class="toolbar-actions">
      <span class="dirty-indicator" data-state="${dirtyState}">${dirtyLabel}</span>
      <button type="button" data-action="create-file">New HVY</button>
    </div>`;
}

function renderModeControls(activeMode: HvyMode, readOnly: boolean): string {
  const modes: Array<{ mode: HvyMode; label: string }> = [
    { mode: 'viewer', label: 'Viewer' },
    { mode: 'ai', label: 'AI' },
    { mode: 'editor', label: 'Editor' },
    { mode: 'hvy', label: 'HVY' },
    { mode: 'advanced', label: 'Advanced' },
  ];
  const showEditorSubmodes = activeMode === 'editor' || activeMode === 'hvy' || activeMode === 'advanced';
  const buttonHtml = ({ mode, label }: { mode: HvyMode; label: string }) => {
    const active = mode === activeMode ? ' is-active' : '';
    const disabled = readOnly && mode !== 'viewer' ? ' disabled' : '';
    const contents = mode === 'advanced' || mode === 'hvy'
      ? `<span>${escapeHtml(mode === 'advanced' ? 'ADV' : 'HVY')}</span>`
      : `${modeIcon(mode)}<span>${escapeHtml(label)}</span>`;
    return `<button type="button" class="mode-button${active}" data-action="set-mode" data-mode="${mode}" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}" aria-pressed="${mode === activeMode ? 'true' : 'false'}"${disabled}>${contents}</button>`;
  };
  return `
    <nav class="mode-controls${showEditorSubmodes ? ' is-editor-enabled' : ''}" aria-label="HVY editor mode">
      ${showEditorSubmodes ? `<div class="mode-editor-submodes">${buttonHtml(modes[3])}${buttonHtml(modes[4])}</div>` : ''}
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

function renderWorkspaces(state: AppState): string {
  if (state.workspaces.length === 0) {
    return '<div class="empty-panel">Open or create a workspace to browse HVY files.</div>';
  }
  return `<div class="tree-list">${state.workspaces.map((workspace) => renderWorkspace(workspace, state.selectedFilePath, state.openWorkspaceActionsPath)).join('')}</div>`;
}

function renderWorkspace(workspace: Workspace, selectedFilePath: string | null, openWorkspaceActionsPath: string | null): string {
  const actionsOpen = workspace.path === openWorkspaceActionsPath;
  return `
    <details class="workspace-root" data-workspace-path="${escapeAttr(workspace.path)}" open>
      <summary title="${escapeAttr(workspace.path)}">
        <span>${escapeHtml(workspace.manifest.name)}</span>
      </summary>
      <div class="workspace-actions-menu${actionsOpen ? ' is-open' : ''}">
        <button type="button" class="workspace-action-trigger" data-action="toggle-workspace-actions" data-workspace-path="${escapeAttr(workspace.path)}" title="Workspace actions" aria-label="Workspace actions" aria-expanded="${actionsOpen ? 'true' : 'false'}">+</button>
        <div class="workspace-action-popover" role="menu" ${actionsOpen ? '' : 'hidden'}>
          <button type="button" role="menuitem" data-action="new-document-in-workspace" data-workspace-path="${escapeAttr(workspace.path)}">New</button>
          <button type="button" role="menuitem" data-action="add-files-to-workspace" data-workspace-path="${escapeAttr(workspace.path)}">Add</button>
        </div>
      </div>
      ${workspace.files.length === 0 ? '' : `<ul class="tree">${workspace.files.map((node) => renderNode(node, selectedFilePath)).join('')}</ul>`}
    </details>`;
}

function renderNode(node: WorkspaceTreeNode, selectedFilePath: string | null): string {
  if (node.kind === 'folder') {
    return `
      <li>
        <details open>
          <summary>${escapeHtml(node.name)}</summary>
          <ul class="tree">${node.children.map((child) => renderNode(child, selectedFilePath)).join('')}</ul>
        </details>
      </li>`;
  }
  const selected = node.path === selectedFilePath ? ' is-selected' : '';
  return `
    <li>
      <button type="button" class="tree-file${selected}" data-action="select-file" data-path="${escapeAttr(node.path)}" data-name="${escapeAttr(node.name)}">
        <span>${escapeHtml(displayDocumentName(node.name))}</span>
      </button>
    </li>`;
}

function displayDocumentName(name: string): string {
  return name.replace(/\.(t?hvy|md)$/i, '');
}

function renderEmptyState(state: AppState): string {
  if (state.document) {
    return '';
  }
  return `
    <div class="empty-state">
      <h2>Choose a file from a workspace</h2>
      <p>Open a workspace folder or a standalone HVY file to start viewing and editing.</p>
      <div>
        <button type="button" data-action="open-workspace">Open Workspace</button>
        <button type="button" data-action="new-workspace">New Workspace</button>
      </div>
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

function renderNewDocumentDialog(state: AppState): string {
  if (!state.newDocumentWorkspacePath) {
    return '';
  }
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="dialog" data-form="new-document">
        <h2>New Document</h2>
        <label>
          <span>Name</span>
          <input name="documentName" type="text" autocomplete="off" autofocus required>
        </label>
        <label>
          <span>Template</span>
          <select name="templateId">
            ${hvyTemplates.map((template) => `<option value="${escapeAttr(template.id)}">${escapeHtml(template.name)}</option>`).join('')}
          </select>
        </label>
        <div class="dialog-actions">
          <button type="button" data-action="cancel-new-document">Cancel</button>
          <button type="submit" ${state.busy ? 'disabled' : ''}>Create</button>
        </div>
      </form>
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
        <h2>AI Settings</h2>
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
        <div class="ai-task-grid">
          ${renderActionConfigField('chat', 'Chat / Q&A', settings)}
          ${renderActionConfigField('edit', 'Document and component edit', settings)}
          ${renderActionConfigField('importPlanning', 'Import planning', settings)}
          ${renderActionConfigField('importWriting', 'Import writing', settings)}
          ${renderActionConfigField('importCleanup', 'Import cleanup', settings)}
          ${renderActionConfigField('compaction', 'Compaction', settings)}
        </div>
        <div class="dialog-actions">
          <button type="button" data-action="cancel-ai-settings">Cancel</button>
          <button type="submit" ${state.busy ? 'disabled' : ''}>Save</button>
        </div>
      </form>
    </div>`;
}

function renderColorThemeDialog(state: AppState): string {
  if (!state.colorThemeDialogOpen) {
    return '';
  }
  const colors = state.colorTheme.colors;
  const selectedPaletteId = getMatchedPaletteId(colors);
  const customNames = Object.keys(colors)
    .filter((name) => !THEME_COLOR_NAMES.includes(name))
    .sort((left, right) => left.localeCompare(right));
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog wide-dialog color-theme-dialog" role="dialog" aria-modal="true" aria-labelledby="colorThemeTitle">
        <h2 id="colorThemeTitle">Colors</h2>
        <p class="dialog-note">Global HVY colors apply across documents on this device.</p>
        <div class="theme-palette-grid" aria-label="Theme palettes">
          <article class="theme-palette-card${selectedPaletteId === null && Object.keys(colors).length === 0 ? ' is-selected' : ''}">
            <div class="theme-palette-preview theme-palette-preview-document" aria-hidden="true">
              <span></span><span></span><span></span>
            </div>
            <div class="theme-palette-copy">
              <strong>Default</strong>
              <span>Use the built-in HVY colors.</span>
            </div>
            <button type="button" data-action="theme-clear-palette">Use</button>
          </article>
          ${HVY_PALETTES.map((palette) => renderPaletteCard(palette, selectedPaletteId === palette.id)).join('')}
        </div>
        <div class="theme-filter-shell">
          <span>Filter</span>
          <input type="search" placeholder="Color name or variable" data-field="theme-color-filter">
        </div>
        <div class="theme-color-list">
          ${THEME_COLOR_NAMES.map((name) => renderThemeColorRow(name, colors[name] ?? '', getResolvedThemeColor(name, colors[name]), false)).join('')}
        </div>
        <div class="theme-custom-head">
          <h3>Custom</h3>
          <button type="button" class="secondary-action" data-action="theme-add-color">Add Color</button>
        </div>
        <div class="theme-color-list theme-color-list--custom">
          ${customNames.length
            ? customNames.map((name) => renderThemeColorRow(name, colors[name] ?? '', colors[name] ?? '', true)).join('')
            : '<div class="empty-panel compact">No custom colors yet.</div>'}
        </div>
        <div class="dialog-actions">
          <button type="button" data-action="cancel-color-theme">Done</button>
        </div>
      </section>
    </div>`;
}

function renderPaletteCard(palette: typeof HVY_PALETTES[number], selected: boolean): string {
  const preview = [
    palette.colors['--hvy-bg'] ?? '#f5f9ff',
    palette.colors['--hvy-accent-1'] ?? '#4a8fab',
    palette.colors['--hvy-surface'] ?? '#ffffff',
  ];
  return `
    <article class="theme-palette-card${selected ? ' is-selected' : ''}">
      <div class="theme-palette-preview" aria-hidden="true">
        ${preview.map((color) => `<span style="background: ${escapeAttr(color)}"></span>`).join('')}
      </div>
      <div class="theme-palette-copy">
        <strong>${escapeHtml(palette.name)}</strong>
        <span>${escapeHtml(palette.description)}</span>
      </div>
      <button type="button" data-action="theme-apply-palette" data-palette-id="${escapeAttr(palette.id)}">Use</button>
    </article>`;
}

function renderThemeColorRow(name: string, value: string, displayValue: string, custom: boolean): string {
  const label = getThemeColorLabel(name);
  const search = `${name} ${label} ${value} ${custom ? 'custom' : ''}`;
  const overridden = value.trim().length > 0;
  return `
    <div class="theme-color-row${overridden ? ' theme-color-row--override' : ''}" data-theme-color-name="${escapeAttr(name)}" data-theme-search="${escapeAttr(search.toLowerCase())}">
      <div class="theme-color-meta">
        ${custom
          ? `<input class="theme-color-name" data-field="theme-color-name" data-color-name="${escapeAttr(name)}" value="${escapeAttr(name)}" spellcheck="false">`
          : `<strong>${escapeHtml(label)}</strong><span class="theme-color-var">${escapeHtml(name)}</span>`}
      </div>
      <input
        class="theme-color-picker"
        type="color"
        data-field="theme-color-picker"
        data-color-name="${escapeAttr(name)}"
        value="${escapeAttr(colorValueToPickerHex(displayValue))}"
        title="${escapeAttr(label)}"
      >
      <input
        class="theme-color-value"
        type="text"
        data-field="theme-color-value"
        data-color-name="${escapeAttr(name)}"
        value="${escapeAttr(value)}"
        placeholder="default"
        spellcheck="false"
      >
      <span class="theme-color-swatch" style="${value ? `background: ${escapeAttr(value)};` : ''}" aria-hidden="true"></span>
      ${custom
        ? `<button type="button" class="ghost theme-color-action" data-action="theme-remove-color" data-color-name="${escapeAttr(name)}">Remove</button>`
        : `<button type="button" class="ghost theme-color-action" data-action="theme-reset-color" data-color-name="${escapeAttr(name)}" ${overridden ? '' : 'disabled'}>Reset</button>`}
    </div>`;
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
        <h2 id="recoveryTitle">Recover Backup</h2>
        <p class="dialog-note">Backups are kept for two hours and refreshed every five minutes while a document has edits.</p>
        ${
          backups.length === 0
            ? '<div class="empty-panel compact">No backups are available yet.</div>'
            : `<div class="recovery-list">
                ${backups.map((backup) => `
                  <article class="recovery-item">
                    <div>
                      <strong>${escapeHtml(backup.name)}</strong>
                      <span>${escapeHtml(formatBackupTimestamp(backup.createdAt))}</span>
                      ${backup.documentPath ? `<small>${escapeHtml(backup.documentPath)}</small>` : '<small>Unsaved document</small>'}
                    </div>
                    <button type="button" data-action="restore-backup" data-backup-id="${escapeAttr(backup.id)}">Restore</button>
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
          <option value="default" ${config.providerId === 'default' ? 'selected' : ''}>Default</option>
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
  };
}

function parseAiSettings(value: string): AiSettings | null {
  try {
    const parsed = JSON.parse(value) as AiSettings;
    return Array.isArray(parsed.providers) && parsed.actions ? parsed : null;
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
    compaction: readActionConfig(data, 'compaction', fallbackProviderId),
  };
}

function readActionConfig(data: FormData, action: AiActionKey, fallbackProviderId: string) {
  return {
    providerId: String(data.get(`${action}ProviderId`) ?? fallbackProviderId).trim() || fallbackProviderId,
    model: String(data.get(`${action}Model`) ?? '').trim(),
  };
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
