import type { Galaxy, GalaxyTreeNode, RecentState } from './backend';
import type { AppState } from './state';

export interface UiHandlers {
  newGalaxy(): void;
  openGalaxy(): void;
  openFile(): void;
  openRecentGalaxy(path: string): void;
  openRecentFile(path: string): void;
  selectFile(path: string): void;
  toggleMode(): void;
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
          <button type="button" data-action="open-galaxy">Open Galaxy</button>
          <button type="button" data-action="open-file">Open File</button>
        </div>
        ${renderGalaxies(state)}
        ${renderRecents(state.recent)}
      </aside>
      <section class="document-shell">
        <header class="document-toolbar">
          ${renderToolbar(state)}
        </header>
        <div class="error-slot${state.error ? ' has-error' : ''}">${state.error ? escapeHtml(state.error) : ''}</div>
        <div id="hvyMount" class="document-host">
          ${renderEmptyState(state)}
        </div>
      </section>
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
    if (target instanceof HTMLButtonElement && target.disabled) return;
    const action = target.dataset.action;
    if (action === 'new-galaxy') handlers.newGalaxy();
    if (action === 'open-galaxy') handlers.openGalaxy();
    if (action === 'open-file') handlers.openFile();
    if (action === 'toggle-mode') handlers.toggleMode();
    if (action === 'save') handlers.save();
    if (action === 'save-as') handlers.saveAs();
    if (action === 'create-file') handlers.createFile();
    if (action === 'select-file' && target.dataset.path) handlers.selectFile(target.dataset.path);
    if (action === 'recent-galaxy' && target.dataset.path) handlers.openRecentGalaxy(target.dataset.path);
    if (action === 'recent-file' && target.dataset.path) handlers.openRecentFile(target.dataset.path);
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
  const canEdit = !document.readOnly;
  const dirtyState = document.readOnly ? 'read-only' : document.dirty ? 'dirty' : 'clean';
  const dirtyLabel = document.readOnly ? 'Read only' : document.dirty ? 'Unsaved' : 'Saved';
  return `
    <div class="toolbar-title">
      <strong>${escapeHtml(document.name)}</strong>
      <span>${document.readOnly ? 'Read-only guide' : document.isNew ? 'Unsaved document' : escapeHtml(document.path)}</span>
    </div>
    <div class="toolbar-actions">
      <span class="dirty-indicator" data-state="${dirtyState}">${dirtyLabel}</span>
      <button type="button" data-action="toggle-mode" ${canEdit ? '' : 'disabled'}>${document.mode === 'viewer' ? 'Edit' : 'View'}</button>
      <button type="button" data-action="save" ${document.dirty && canEdit ? '' : 'disabled'}>Save</button>
      <button type="button" data-action="save-as" ${canEdit ? '' : 'disabled'}>Save As</button>
      <button type="button" data-action="create-file">New HVY</button>
    </div>`;
}

function renderGalaxies(state: AppState): string {
  if (state.galaxies.length === 0) {
    return '<div class="empty-panel">Open or create a galaxy to browse HVY files.</div>';
  }
  return `<div class="tree-list">${state.galaxies.map((galaxy) => renderGalaxy(galaxy, state.selectedFilePath)).join('')}</div>`;
}

function renderGalaxy(galaxy: Galaxy, selectedFilePath: string | null): string {
  return `
    <section class="galaxy-group">
      <h2 title="${escapeAttr(galaxy.path)}">${escapeHtml(galaxy.manifest.name)}</h2>
      ${galaxy.files.length === 0
        ? '<div class="empty-panel compact">No HVY files yet.</div>'
        : `<ul class="tree">${galaxy.files.map((node) => renderNode(node, selectedFilePath)).join('')}</ul>`}
    </section>`;
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

function renderRecents(recent: RecentState): string {
  const hasRecents = recent.galaxies.length > 0 || recent.files.length > 0;
  if (!hasRecents) {
    return '';
  }
  return `
    <section class="recents">
      <h2>Recent</h2>
      ${recent.galaxies.map((path) => `<button type="button" data-action="recent-galaxy" data-path="${escapeAttr(path)}">${escapeHtml(lastPathPart(path))}</button>`).join('')}
      ${recent.files.map((path) => `<button type="button" data-action="recent-file" data-path="${escapeAttr(path)}">${escapeHtml(lastPathPart(path))}</button>`).join('')}
    </section>`;
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

function sidebarSummary(state: AppState): string {
  if (state.busy) return 'Working...';
  if (state.galaxies.length === 1) return '1 galaxy open';
  return `${state.galaxies.length} galaxies open`;
}

function lastPathPart(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
