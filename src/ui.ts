import { aiProviderPreset, aiProviderPresets } from './aiProviders';
import { type AiActionKey, type AiActionSettings, type AiProviderConfig, type AiSettings, type Galaxy, type GalaxyTreeNode } from './backend';
import type { HvyMode } from './hvy';
import type { AppState } from './state';
import { hvyTemplates } from './templates';

export interface UiHandlers {
  newGalaxy(): void;
  createGalaxy(name: string, location: 'managed' | 'choose'): void;
  setNewGalaxyLocation(location: 'managed' | 'choose'): void;
  cancelNewGalaxy(): void;
  newDocumentInGalaxy(galaxyPath: string): void;
  createDocumentInGalaxy(name: string, templateId: string): void;
  cancelNewDocument(): void;
  addFilesToGalaxy(galaxyPath: string): void;
  openAiSettings(): void;
  selectAiProvider(providerId: string): void;
  openProviderDocs(url: string): void;
  saveAiSettings(settings: AiSettings): void;
  cancelAiSettings(): void;
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

export function render(state: AppState, handlers: UiHandlers): HTMLElement {
  appRoot.innerHTML = `
    <main class="app-shell">
      <aside class="galaxy-sidebar">
        <div class="sidebar-header">
          <div>
            <h1>HVY Galaxy</h1>
            <p>${escapeHtml(sidebarSummary(state))}</p>
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
    </main>`;

  bind(appRoot, handlers);
  return appRoot.querySelector<HTMLElement>('#hvyMount')!;
}

function bind(root: HTMLElement, handlers: UiHandlers): void {
  bindController?.abort();
  bindController = new AbortController();
  const { signal } = bindController;
  root.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target) return;
    if (target.closest('#hvyMount')) return;
    if (target instanceof HTMLButtonElement && target.disabled) return;
    const action = target.dataset.action;
    if (action === 'new-galaxy') handlers.newGalaxy();
    if (action === 'set-new-galaxy-location' && isNewGalaxyLocation(target.dataset.location)) {
      handlers.setNewGalaxyLocation(target.dataset.location);
    }
    if (action === 'cancel-new-galaxy') handlers.cancelNewGalaxy();
    if (action === 'new-document-in-galaxy' && target.dataset.galaxyPath) handlers.newDocumentInGalaxy(target.dataset.galaxyPath);
    if (action === 'add-files-to-galaxy' && target.dataset.galaxyPath) handlers.addFilesToGalaxy(target.dataset.galaxyPath);
    if (action === 'cancel-new-document') handlers.cancelNewDocument();
    if (action === 'ai-settings') handlers.openAiSettings();
    if (action === 'select-ai-provider' && target.dataset.providerId) handlers.selectAiProvider(target.dataset.providerId);
    if (action === 'provider-docs') {
      const url = target.dataset.url;
      if (url) handlers.openProviderDocs(url);
    }
    if (action === 'cancel-ai-settings') handlers.cancelAiSettings();
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
    { mode: 'advanced', label: 'Advanced' },
  ];
  const showAdvanced = activeMode === 'editor' || activeMode === 'advanced';
  const buttonHtml = ({ mode, label }: { mode: HvyMode; label: string }) => {
    const active = mode === activeMode ? ' is-active' : '';
    const disabled = readOnly && mode !== 'viewer' ? ' disabled' : '';
    const contents = mode === 'advanced'
      ? '<span>ADV</span>'
      : `${modeIcon(mode)}<span>${escapeHtml(label)}</span>`;
    return `<button type="button" class="mode-button${active}" data-action="set-mode" data-mode="${mode}" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}" aria-pressed="${mode === activeMode ? 'true' : 'false'}"${disabled}>${contents}</button>`;
  };
  return `
    <nav class="mode-controls${activeMode === 'editor' || activeMode === 'advanced' ? ' is-editor-enabled' : ''}" aria-label="HVY editor mode">
      <div class="mode-controls-top">
        <button type="button" class="mode-button mode-button-hvy" data-action="create-file" title="New HVY document" aria-label="New HVY document"><span>HVY</span></button>
        ${buttonHtml(modes[0])}
        ${buttonHtml(modes[1])}
        <span class="mode-editor-stack">
          ${buttonHtml(modes[2])}
          ${showAdvanced ? buttonHtml(modes[3]) : ''}
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
  return `<div class="tree-list">${state.galaxies.map((galaxy) => renderGalaxy(galaxy, state.selectedFilePath)).join('')}</div>`;
}

function renderGalaxy(galaxy: Galaxy, selectedFilePath: string | null): string {
  return `
    <details class="galaxy-root" open>
      <summary title="${escapeAttr(galaxy.path)}">
        <span>${escapeHtml(galaxy.manifest.name)}</span>
      </summary>
      <div class="galaxy-actions">
        <button type="button" class="empty-action galaxy-new-file" data-action="new-document-in-galaxy" data-galaxy-path="${escapeAttr(galaxy.path)}"><span aria-hidden="true">+</span> New HVY</button>
        <button type="button" class="empty-action" data-action="add-files-to-galaxy" data-galaxy-path="${escapeAttr(galaxy.path)}"><span aria-hidden="true">+</span> Add Files</button>
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
  const providerConfig = activeProviderConfig(state.aiSettings);
  const provider = aiProviderPreset(state.aiSettings.activeProviderId);
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="dialog wide-dialog" data-form="ai-settings">
        <h2>AI Settings</h2>
        <p class="dialog-note">Configure providers once, then choose the provider and model each action should use.</p>
        <textarea name="settingsJson" hidden>${escapeHtml(JSON.stringify(state.aiSettings))}</textarea>
        <div class="ai-provider-picker" aria-label="Configured AI providers">
          <span>Providers</span>
          <div>
            ${aiProviderPresets.map((option) => `
              <button
                type="button"
                class="${option.id === state.aiSettings.activeProviderId ? 'is-active' : ''}"
                data-action="select-ai-provider"
                data-provider-id="${escapeAttr(option.id)}"
                aria-pressed="${option.id === state.aiSettings.activeProviderId ? 'true' : 'false'}"
              >${escapeHtml(option.name)}</button>
            `).join('')}
          </div>
        </div>
        <button type="button" class="provider-docs-link" data-action="provider-docs" data-provider-docs data-url="${escapeAttr(provider.docsUrl)}">Setup instructions</button>
        <input name="activeProviderId" type="hidden" value="${escapeAttr(state.aiSettings.activeProviderId)}">
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
          ${renderActionConfigField('chat', 'Chat / Q&A', state.aiSettings)}
          ${renderActionConfigField('edit', 'Document and component edit', state.aiSettings)}
          ${renderActionConfigField('importPlanning', 'Import planning', state.aiSettings)}
          ${renderActionConfigField('importWriting', 'Import writing', state.aiSettings)}
          ${renderActionConfigField('importCleanup', 'Import cleanup', state.aiSettings)}
          ${renderActionConfigField('compaction', 'Compaction', state.aiSettings)}
        </div>
        <div class="dialog-actions">
          <button type="button" data-action="cancel-ai-settings">Cancel</button>
          <button type="submit" ${state.busy ? 'disabled' : ''}>Save</button>
        </div>
      </form>
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
  return value === 'viewer' || value === 'ai' || value === 'editor' || value === 'advanced';
}

function sidebarSummary(state: AppState): string {
  if (state.busy) return 'Working...';
  if (state.galaxies.length === 1) return '1 galaxy open';
  return `${state.galaxies.length} galaxies open`;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
