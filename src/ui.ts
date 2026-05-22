import { aiProviderPreset, aiProviderPresets } from './aiProviders';
import { type AiActionKey, type AiActionSettings, type AiProviderConfig, type AiSettings, type Galaxy, type GalaxyTreeNode } from './backend';
import type { HvyMode } from './hvy';
import type { AppState } from './state';
import { hvyTemplates } from './templates';

export interface UiHandlers {
  newGalaxy(): void;
  toggleGalaxyActions(path: string): void;
  closeGalaxyActions(): void;
  createGalaxy(name: string, location: 'managed' | 'choose'): void;
  setNewGalaxyLocation(location: 'managed' | 'choose'): void;
  cancelNewGalaxy(): void;
  newDocumentInGalaxy(galaxyPath: string): void;
  createDocumentInGalaxy(name: string, templateId: string): void;
  cancelNewDocument(): void;
  addFilesToGalaxy(galaxyPath: string): void;
  openAiSettings(): void;
  selectAiProvider(providerId: string, settings: AiSettings): void;
  openProviderDocs(url: string): void;
  saveAiSettings(settings: AiSettings): void;
  cancelAiSettings(settings?: AiSettings): void;
  restoreBackup(id: string): void;
  cancelRecovery(): void;
  openGalaxy(): void;
  openFile(): void;
  openRecentGalaxy(path: string): void;
  openRecentFile(path: string): void;
  selectFile(path: string): void;
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

export function render(state: AppState, handlers: UiHandlers, options: { preserveMount?: HTMLElement | null } = {}): HTMLElement {
  appRoot.innerHTML = `
    <main class="app-shell">
      <aside class="galaxy-sidebar">
        <div class="sidebar-header">
          <div>
            <h1>HVY Galaxy</h1>
          </div>
          <button type="button" class="icon-button" data-action="create-file" title="New HVY document">+</button>
        </div>
        <div class="sidebar-actions">
          <button type="button" data-action="open-file">Open File</button>
        </div>
        <section class="galaxies-section">
          <div class="sidebar-section-heading">
            <h2>Galaxies</h2>
          </div>
          <button type="button" class="secondary-action" data-action="new-galaxy">New Galaxy</button>
          ${renderGalaxies(state)}
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
      ${renderNewGalaxyDialog(state)}
      ${renderNewDocumentDialog(state)}
      ${renderAiSettingsDialog(state)}
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
        const aiSettingsForm = backdrop.querySelector<HTMLFormElement>('form[data-form="ai-settings"]');
        if (aiSettingsForm) {
          handlers.cancelAiSettings(readAiSettingsForm(new FormData(aiSettingsForm)));
          return;
        }
      }
      if (!(event.target as HTMLElement).closest('.galaxy-actions-menu')) {
        handlers.closeGalaxyActions();
      }
      return;
    }
    if (target.closest('#hvyMount')) return;
    if (target instanceof HTMLButtonElement && target.disabled) return;
    const action = target.dataset.action;
    if (action === 'new-galaxy') handlers.newGalaxy();
    if (action === 'toggle-galaxy-actions' && target.dataset.galaxyPath) {
      event.preventDefault();
      event.stopPropagation();
      handlers.toggleGalaxyActions(target.dataset.galaxyPath);
    }
    if (action === 'set-new-galaxy-location' && isNewGalaxyLocation(target.dataset.location)) {
      handlers.setNewGalaxyLocation(target.dataset.location);
    }
    if (action === 'cancel-new-galaxy') handlers.cancelNewGalaxy();
    if (action === 'new-document-in-galaxy' && target.dataset.galaxyPath) handlers.newDocumentInGalaxy(target.dataset.galaxyPath);
    if (action === 'add-files-to-galaxy' && target.dataset.galaxyPath) handlers.addFilesToGalaxy(target.dataset.galaxyPath);
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
    if (action === 'restore-backup' && target.dataset.backupId) handlers.restoreBackup(target.dataset.backupId);
    if (action === 'cancel-recovery') handlers.cancelRecovery();
    if (action === 'open-galaxy') handlers.openGalaxy();
    if (action === 'open-file') handlers.openFile();
    if (action === 'set-mode' && isHvyMode(target.dataset.mode)) handlers.setMode(target.dataset.mode);
    if (action === 'save') handlers.save();
    if (action === 'save-as') handlers.saveAs();
    if (action === 'create-file') handlers.createFile();
    if (action === 'select-file' && target.dataset.path) handlers.selectFile(target.dataset.path);
  }, { signal });
  root.addEventListener('submit', (event) => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>('form[data-form]');
    if (!form) return;
    if (form.closest('#hvyMount')) return;
    event.preventDefault();
    if (form.dataset.form === 'new-galaxy') {
      const data = new FormData(form);
      const location = String(data.get('galaxyLocation') ?? 'managed');
      handlers.createGalaxy(
        String(data.get('galaxyName') ?? ''),
        isNewGalaxyLocation(location) ? location : 'managed'
      );
    }
    if (form.dataset.form === 'new-document') {
      const data = new FormData(form);
      handlers.createDocumentInGalaxy(
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
    const form = target?.closest<HTMLFormElement>('form[data-form="ai-settings"]')
      ?? root.querySelector<HTMLFormElement>('form[data-form="ai-settings"]');
    if (!form) return;
    event.preventDefault();
    handlers.cancelAiSettings(readAiSettingsForm(new FormData(form)));
  }, { signal });
  root.querySelectorAll<HTMLFormElement>('form[data-form="new-galaxy"]').forEach((form) => {
    updateNewGalaxySubmit(form);
    form.addEventListener('input', () => updateNewGalaxySubmit(form), { signal });
  });
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
      <div class="mode-controls-top">
        ${buttonHtml(modes[0])}
        ${buttonHtml(modes[1])}
        <span class="mode-editor-stack">
          ${buttonHtml(modes[2])}
          ${showEditorSubmodes ? `<span class="mode-editor-submodes">${buttonHtml(modes[3])}${buttonHtml(modes[4])}</span>` : ''}
        </span>
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

function renderGalaxies(state: AppState): string {
  if (state.galaxies.length === 0) {
    return '<div class="empty-panel">Open or create a galaxy to browse HVY files.</div>';
  }
  return `<div class="tree-list">${state.galaxies.map((galaxy) => renderGalaxy(galaxy, state.selectedFilePath, state.openGalaxyActionsPath)).join('')}</div>`;
}

function renderGalaxy(galaxy: Galaxy, selectedFilePath: string | null, openGalaxyActionsPath: string | null): string {
  const actionsOpen = galaxy.path === openGalaxyActionsPath;
  return `
    <details class="galaxy-root" open>
      <summary title="${escapeAttr(galaxy.path)}">
        <span>${escapeHtml(galaxy.manifest.name)}</span>
      </summary>
      <div class="galaxy-actions-menu${actionsOpen ? ' is-open' : ''}">
        <button type="button" class="galaxy-action-trigger" data-action="toggle-galaxy-actions" data-galaxy-path="${escapeAttr(galaxy.path)}" title="Galaxy actions" aria-label="Galaxy actions" aria-expanded="${actionsOpen ? 'true' : 'false'}">+</button>
        <div class="galaxy-action-popover" role="menu" ${actionsOpen ? '' : 'hidden'}>
          <button type="button" role="menuitem" data-action="new-document-in-galaxy" data-galaxy-path="${escapeAttr(galaxy.path)}">New</button>
          <button type="button" role="menuitem" data-action="add-files-to-galaxy" data-galaxy-path="${escapeAttr(galaxy.path)}">Add</button>
        </div>
      </div>
      ${galaxy.files.length === 0 ? '' : `<ul class="tree">${galaxy.files.map((node) => renderNode(node, selectedFilePath)).join('')}</ul>`}
    </details>`;
}

function renderNode(node: GalaxyTreeNode, selectedFilePath: string | null): string {
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
      <button type="button" class="tree-file${selected}" data-action="select-file" data-path="${escapeAttr(node.path)}">
        <span>${escapeHtml(node.name)}</span>
      </button>
    </li>`;
}

function renderEmptyState(state: AppState): string {
  if (state.document) {
    return '';
  }
  return `
    <div class="empty-state">
      <h2>Choose a file from a galaxy</h2>
      <p>Open a galaxy folder or a standalone HVY file to start viewing and editing.</p>
      <div>
        <button type="button" data-action="open-galaxy">Open Galaxy</button>
        <button type="button" data-action="new-galaxy">New Galaxy</button>
      </div>
    </div>`;
}

function renderNewGalaxyDialog(state: AppState): string {
  if (!state.newGalaxyDialogOpen) {
    return '';
  }
  const managedActive = state.newGalaxyLocation === 'managed';
  const chooseActive = state.newGalaxyLocation === 'choose';
  const existingNames = state.galaxies.map((galaxy) => galaxy.manifest.name.toLowerCase());
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="dialog" data-form="new-galaxy" data-existing-galaxy-names="${escapeAttr(JSON.stringify(existingNames))}">
        <h2>New Galaxy</h2>
        <div class="field-group">
          <span>Location</span>
          <div class="segmented-control">
            <button type="button" class="${managedActive ? 'is-active' : ''}" data-action="set-new-galaxy-location" data-location="managed" aria-pressed="${managedActive ? 'true' : 'false'}">App managed</button>
            <button type="button" class="${chooseActive ? 'is-active' : ''}" data-action="set-new-galaxy-location" data-location="choose" aria-pressed="${chooseActive ? 'true' : 'false'}">Choose folder</button>
          </div>
        </div>
        <input name="galaxyLocation" type="hidden" value="${escapeAttr(state.newGalaxyLocation)}">
        ${managedActive ? `
          <label>
            <span>Name</span>
            <input name="galaxyName" type="text" autocomplete="off" autofocus required>
          </label>
          <p class="dialog-note" data-role="galaxy-name-note">Choose a unique name for a new app-managed galaxy.</p>
        ` : ''}
        <p class="dialog-note">${chooseActive ? 'Pick any folder, including a synced Google Drive or OneDrive folder.' : 'Stored in the app data folder on this device.'}</p>
        <div class="dialog-actions">
          <button type="button" data-action="cancel-new-galaxy">Cancel</button>
          <button type="submit" data-role="new-galaxy-submit" ${state.busy || managedActive ? 'disabled' : ''}>${chooseActive ? 'Select' : 'Create'}</button>
        </div>
      </form>
    </div>`;
}

function updateNewGalaxySubmit(form: HTMLFormElement): void {
  const location = new FormData(form).get('galaxyLocation');
  const submit = form.querySelector<HTMLButtonElement>('[data-role="new-galaxy-submit"]');
  if (!submit || location !== 'managed') return;
  const input = form.querySelector<HTMLInputElement>('input[name="galaxyName"]');
  const note = form.querySelector<HTMLElement>('[data-role="galaxy-name-note"]');
  const name = input?.value.trim().toLowerCase() ?? '';
  const existingNames = parseExistingGalaxyNames(form.dataset.existingGalaxyNames);
  const duplicate = name.length > 0 && existingNames.includes(name);
  submit.disabled = name.length === 0 || duplicate;
  if (note) {
    note.textContent = duplicate
      ? 'A galaxy with that name is already open.'
      : 'Choose a unique name for a new app-managed galaxy.';
    note.dataset.state = duplicate ? 'error' : 'neutral';
  }
}

function parseExistingGalaxyNames(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const names = JSON.parse(value);
    return Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string') : [];
  } catch {
    return [];
  }
}

function isNewGalaxyLocation(value: unknown): value is 'managed' | 'choose' {
  return value === 'managed' || value === 'choose';
}

function renderNewDocumentDialog(state: AppState): string {
  if (!state.newDocumentGalaxyPath) {
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
