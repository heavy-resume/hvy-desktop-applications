import { aiProviderPreset, aiProviderPresets } from './aiProviders';
import { defaultAiConnectionPreset, type AiConnectionPreset, type AiSettings, type AiTaskModels, type Galaxy, type GalaxyTreeNode } from './backend';
import type { HvyMode } from './hvy';
import type { AppState } from './state';
import { hvyTemplates } from './templates';

export interface UiHandlers {
  newGalaxy(): void;
  createGalaxy(name: string): void;
  cancelNewGalaxy(): void;
  newDocumentInGalaxy(galaxyPath: string): void;
  createDocumentInGalaxy(name: string, templateId: string): void;
  cancelNewDocument(): void;
  openAiSettings(): void;
  selectAiPreset(presetId: string): void;
  addAiPreset(): void;
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
          <button type="button" data-action="new-galaxy">New Galaxy</button>
          <button type="button" data-action="open-file">Open File</button>
        </div>
        ${renderGalaxies(state)}
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
  root.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target) return;
    if (target.closest('#hvyMount')) return;
    if (target instanceof HTMLButtonElement && target.disabled) return;
    const action = target.dataset.action;
    if (action === 'new-galaxy') handlers.newGalaxy();
    if (action === 'cancel-new-galaxy') handlers.cancelNewGalaxy();
    if (action === 'new-document-in-galaxy' && target.dataset.galaxyPath) handlers.newDocumentInGalaxy(target.dataset.galaxyPath);
    if (action === 'cancel-new-document') handlers.cancelNewDocument();
    if (action === 'ai-settings') handlers.openAiSettings();
    if (action === 'add-ai-preset') handlers.addAiPreset();
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
  }, { signal: bindController.signal });
  root.addEventListener('submit', (event) => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>('form[data-form]');
    if (!form) return;
    if (form.closest('#hvyMount')) return;
    event.preventDefault();
    if (form.dataset.form === 'new-galaxy') {
      const data = new FormData(form);
      handlers.createGalaxy(String(data.get('galaxyName') ?? ''));
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
  }, { signal: bindController.signal });
  root.addEventListener('change', (event) => {
    const target = event.target as HTMLElement;
    const presetSelect = target.closest<HTMLSelectElement>('select[data-ai-preset-select]');
    if (presetSelect && !presetSelect.closest('#hvyMount')) {
      handlers.selectAiPreset(presetSelect.value);
      return;
    }
    const providerSelect = target.closest<HTMLSelectElement>('select[data-provider-select]');
    if (!providerSelect) return;
    if (providerSelect.closest('#hvyMount')) return;
    syncProviderFields(providerSelect);
  }, { signal: bindController.signal });
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
      ${galaxy.files.length === 0
        ? `<button type="button" class="empty-action" data-action="new-document-in-galaxy" data-galaxy-path="${escapeAttr(galaxy.path)}"><span aria-hidden="true">+</span> New HVY</button>`
        : `<ul class="tree">${galaxy.files.map((node) => renderNode(node, selectedFilePath)).join('')}</ul>`}
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
        <small>${escapeHtml(node.extension)}</small>
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
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="dialog" data-form="new-galaxy">
        <h2>New Galaxy</h2>
        <label>
          <span>Name</span>
          <input name="galaxyName" type="text" autocomplete="off" autofocus required>
        </label>
        <div class="dialog-actions">
          <button type="button" data-action="cancel-new-galaxy">Cancel</button>
          <button type="submit" ${state.busy ? 'disabled' : ''}>Create</button>
        </div>
      </form>
    </div>`;
}

function renderNewDocumentDialog(state: AppState): string {
  if (!state.newDocumentGalaxyPath) {
    return '';
  }
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="dialog" data-form="new-document">
        <h2>New HVY</h2>
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
  const connection = activeConnectionPreset(state.aiSettings);
  const provider = aiProviderPreset(connection.provider);
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="dialog wide-dialog" data-form="ai-settings">
        <h2>AI Settings</h2>
        <p class="dialog-note">Create connection presets for OpenAI-compatible local servers, routers, and hosted providers. HVY can use different models for different jobs.</p>
        <textarea name="settingsJson" hidden>${escapeHtml(JSON.stringify(state.aiSettings))}</textarea>
        <label>
          <span>Provider</span>
          <select name="provider" data-provider-select>
            ${aiProviderPresets.map((option) => `<option value="${escapeAttr(option.id)}" ${option.id === connection.provider ? 'selected' : ''}>${escapeHtml(option.name)}</option>`).join('')}
          </select>
        </label>
        <button type="button" class="provider-docs-link" data-action="provider-docs" data-provider-docs data-url="${escapeAttr(provider.docsUrl)}">Setup instructions</button>
        <label>
          <span>Preset</span>
          <select name="activePresetId" data-ai-preset-select>
            ${state.aiSettings.presets.map((option) => `<option value="${escapeAttr(option.id)}" ${option.id === state.aiSettings.activePresetId ? 'selected' : ''}>${escapeHtml(option.name)}</option>`).join('')}
          </select>
        </label>
        <button type="button" class="secondary-action" data-action="add-ai-preset">+ New Preset</button>
        <input name="presetId" type="hidden" value="${escapeAttr(connection.id)}">
        <div class="ai-provider-fields">
          <label>
            <span>Preset name</span>
            <input name="presetName" type="text" value="${escapeAttr(connection.name)}" autocomplete="off" required>
          </label>
          <label>
            <span>Base URL</span>
            <input name="baseUrl" type="url" value="${escapeAttr(connection.baseUrl)}" placeholder="${escapeAttr(provider.baseUrl || 'http://127.0.0.1:8000/v1')}" required>
          </label>
        </div>
        <label>
          <span>API Key</span>
          <input name="apiKey" type="password" value="${escapeAttr(connection.apiKey)}" placeholder="${escapeAttr(provider.apiKeyPlaceholder)}">
        </label>
        <div class="ai-task-grid">
          ${renderTaskModelField('chat', 'Chat / Q&A', connection.models.chat, provider.modelPlaceholder)}
          ${renderTaskModelField('edit', 'Document and component edit', connection.models.edit, provider.modelPlaceholder)}
          ${renderTaskModelField('importPlanning', 'Import planning', connection.models.importPlanning, provider.modelPlaceholder)}
          ${renderTaskModelField('importWriting', 'Import writing', connection.models.importWriting, provider.modelPlaceholder)}
          ${renderTaskModelField('importCleanup', 'Import cleanup', connection.models.importCleanup, provider.modelPlaceholder)}
          ${renderTaskModelField('compaction', 'Compaction', connection.models.compaction, provider.modelPlaceholder)}
        </div>
        <div class="dialog-actions">
          <button type="button" data-action="cancel-ai-settings">Cancel</button>
          <button type="submit" ${state.busy ? 'disabled' : ''}>Save</button>
        </div>
      </form>
    </div>`;
}

function renderTaskModelField(name: keyof AiTaskModels, label: string, value: string, placeholder: string): string {
  return `
    <label>
      <span>${escapeHtml(label)}</span>
      <input name="${name}" type="text" value="${escapeAttr(value)}" placeholder="${escapeAttr(placeholder)}" autocomplete="off" spellcheck="false">
    </label>`;
}

function readAiSettingsForm(data: FormData): AiSettings {
  const activePresetId = String(data.get('activePresetId') ?? '').trim();
  const presetId = String(data.get('presetId') ?? activePresetId).trim() || crypto.randomUUID();
  const current = {
    id: presetId,
    name: String(data.get('presetName') ?? '').trim() || 'AI Preset',
    provider: String(data.get('provider') ?? '').trim(),
    baseUrl: String(data.get('baseUrl') ?? '').trim(),
    apiKey: String(data.get('apiKey') ?? '').trim(),
    models: {
      chat: String(data.get('chat') ?? '').trim(),
      edit: String(data.get('edit') ?? '').trim(),
      importPlanning: String(data.get('importPlanning') ?? '').trim(),
      importWriting: String(data.get('importWriting') ?? '').trim(),
      importCleanup: String(data.get('importCleanup') ?? '').trim(),
      compaction: String(data.get('compaction') ?? '').trim(),
    },
  };
  const settings = parseAiSettings(String(data.get('settingsJson') ?? '')) ?? { activePresetId: presetId, presets: [] };
  const presets = settings.presets.filter((preset) => preset.id !== presetId);
  return { activePresetId: presetId, presets: [...presets, current] };
}

function parseAiSettings(value: string): AiSettings | null {
  try {
    const parsed = JSON.parse(value) as AiSettings;
    return Array.isArray(parsed.presets) ? parsed : null;
  } catch {
    return null;
  }
}

function syncProviderFields(select: HTMLSelectElement): void {
  const form = select.closest<HTMLFormElement>('form[data-form="ai-settings"]');
  const baseUrl = form?.querySelector<HTMLInputElement>('input[name="baseUrl"]');
  const apiKey = form?.querySelector<HTMLInputElement>('input[name="apiKey"]');
  const models = form?.querySelectorAll<HTMLInputElement>('.ai-task-grid input');
  const docsLink = form?.querySelector<HTMLElement>('[data-provider-docs]');
  const preset = aiProviderPreset(select.value);
  if (baseUrl && preset.baseUrl) baseUrl.value = preset.baseUrl;
  if (apiKey) apiKey.placeholder = preset.apiKeyPlaceholder;
  models?.forEach((model) => {
    model.placeholder = preset.modelPlaceholder;
    if (!model.value.trim()) model.value = preset.modelPlaceholder;
  });
  if (docsLink) docsLink.dataset.url = preset.docsUrl;
}

function activeConnectionPreset(settings: AiSettings): AiConnectionPreset {
  return settings.presets.find((preset) => preset.id === settings.activePresetId) ?? settings.presets[0] ?? defaultAiConnectionPreset();
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
