import type { Galaxy, GalaxyTreeNode, RecentState } from './backend';
import type { AppState } from './state';

export interface UiHandlers {
  newGalaxy(): void;
  createGalaxy(name: string): void;
  cancelNewGalaxy(): void;
  newDocumentInGalaxy(galaxyPath: string): void;
  createDocumentInGalaxy(name: string): void;
  cancelNewDocument(): void;
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
          <button type="button" data-action="new-galaxy">New Galaxy</button>
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
      ${renderNewGalaxyDialog(state)}
      ${renderNewDocumentDialog(state)}
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
    if (action === 'cancel-new-galaxy') handlers.cancelNewGalaxy();
    if (action === 'new-document-in-galaxy' && target.dataset.galaxyPath) handlers.newDocumentInGalaxy(target.dataset.galaxyPath);
    if (action === 'cancel-new-document') handlers.cancelNewDocument();
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
  root.addEventListener('submit', (event) => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>('form[data-form]');
    if (!form) return;
    event.preventDefault();
    if (form.dataset.form === 'new-galaxy') {
      const data = new FormData(form);
      handlers.createGalaxy(String(data.get('galaxyName') ?? ''));
    }
    if (form.dataset.form === 'new-document') {
      const data = new FormData(form);
      handlers.createDocumentInGalaxy(String(data.get('documentName') ?? ''));
    }
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

function renderRecents(recent: RecentState): string {
  if (recent.files.length === 0) {
    return '';
  }
  return `
    <section class="recents">
      <h2>Recent</h2>
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
        <div class="dialog-actions">
          <button type="button" data-action="cancel-new-document">Cancel</button>
          <button type="submit" ${state.busy ? 'disabled' : ''}>Create</button>
        </div>
      </form>
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
