import { type ArchivedWorkspace, type DocumentCreationType, type SavedTemplate, type TemplateExtension, type TemplateScope, type Workspace, type WorkspaceTemplateVisibility, type WorkspaceTreeNode } from '../backend';
import { type AppState, type WorkspaceClipboardState } from '../state';
import { workspaceTemplateVisibility } from '../templates';
import { revealMenuLabel } from './events-workspace';
import { funnelIcon } from './render-shell';
import { workspaceNodeName, workspaceNodeRelativePath } from './render-workspace-dialogs';
import { escapeAttr, escapeHtml } from './shared';
import { UiHandlers } from './types';

export function renderWorkspaces(state: AppState): string {
  if (state.workspaceEntries.length === 0) {
    return '<div class="empty-panel">Open or create a workspace to browse HVY files.</div>';
  }
  return `<div class="tree-list">${state.workspaceEntries.map((entry) => {
    const workspace = state.workspaces.find((candidate) => candidate.path === entry.path);
    if (entry.status === 'ready' && workspace) {
      return renderWorkspace(workspace, state.selectedFilePath, state.openWorkspaceActionsPath, state.workspaceFilters, state.workspaceClipboard, state.workspaceFileViews[workspace.path] ?? 'documents', state.workspaceExpanded[workspace.path] ?? true, state.workspaceFolderExpanded[workspace.path] ?? {}, state.savedTemplates, state.workspaceEmbeddingPreviews[workspace.path] ?? null);
    }
    return renderPendingWorkspace(entry);
  }).join('')}</div>`;
}

export function renderPendingWorkspace(entry: AppState['workspaceEntries'][number]): string {
  const loading = entry.status === 'loading';
  const detail = loading ? 'Loading…' : entry.error ?? 'Workspace could not be loaded.';
  return `
    <section class="workspace-root workspace-root-${entry.status}" data-workspace-path="${escapeAttr(entry.path)}" aria-busy="${loading ? 'true' : 'false'}">
      <button type="button" class="hvy-galaxy-button workspace-state-heading" data-action="${loading ? '' : 'retry-workspace'}" data-workspace-path="${escapeAttr(entry.path)}" title="${escapeAttr(entry.path)}" ${loading ? 'disabled' : ''}>
        <span>${escapeHtml(entry.displayName)}</span>
        ${loading ? '<span class="workspace-loading-indicator" aria-hidden="true"></span>' : ''}
      </button>
      <div class="workspace-state-detail" title="${escapeAttr(detail)}">${escapeHtml(detail)}</div>
      ${loading ? '' : `<button type="button" class="hvy-galaxy-button workspace-retry-button" data-action="retry-workspace" data-workspace-path="${escapeAttr(entry.path)}">Retry</button>`}
    </section>`;
}

export function renderWorkspaceManagerDialog(state: AppState): string {
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
            ${state.workspaces.length === 0 ? '<div class="empty-panel compact">No open workspaces.</div>' : state.workspaceEntries.flatMap((entry) => {
    const workspace = state.workspaces.find((candidate) => candidate.path === entry.path);
    return workspace ? [renderWorkspaceManagerRow(workspace)] : [];
  }).join('')}
          </div>
        </div>
        <div class="workspace-manager-section">
          <h3>Archived</h3>
          <div class="workspace-manager-list">
            ${state.archivedWorkspaces.length === 0 ? '<div class="empty-panel compact">No archived workspaces.</div>' : state.archivedWorkspaces.map(renderArchivedWorkspaceRow).join('')}
          </div>
        </div>
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="close-workspace-manager">Done</button>
        </div>
      </section>
    </div>`;
}

export function renderWorkspaceManagerRow(workspace: Workspace): string {
  return `
    <form class="workspace-manager-row workspace-manager-row-reorderable" data-form="workspace-manager-rename" data-workspace-path="${escapeAttr(workspace.path)}">
      <span class="workspace-reorder-handle" draggable="true" title="Drag to reorder" aria-label="Drag to reorder">⠿</span>
      <input class="hvy-galaxy-input" name="workspacePath" type="hidden" value="${escapeAttr(workspace.path)}">
      <label>
        <span>Name</span>
        <input class="hvy-galaxy-input" name="workspaceName" type="text" autocomplete="off" value="${escapeAttr(workspace.manifest.name)}" required>
      </label>
      <div class="workspace-manager-location">
        <span>Location</span>
        <code title="${escapeAttr(workspace.path)}">${escapeHtml(workspace.path)}</code>
      </div>
      <div class="workspace-manager-actions">
        <button class="hvy-galaxy-button" type="submit">Save</button>
        <button class="hvy-galaxy-button" type="button" data-action="show-workspace-in-folder" data-workspace-path="${escapeAttr(workspace.path)}">${escapeHtml(revealMenuLabel())}</button>
        <button type="button" class="hvy-galaxy-button danger-button" data-action="archive-workspace" data-workspace-path="${escapeAttr(workspace.path)}">Archive</button>
      </div>
    </form>`;
}

export function bindWorkspaceManagerReordering(root: HTMLElement, handlers: UiHandlers, signal: AbortSignal): void {
  let draggedPath: string | null = null;
  root.addEventListener('dragstart', (event) => {
    const handle = event.target instanceof Element ? event.target.closest<HTMLElement>('.workspace-reorder-handle') : null;
    const row = handle?.closest<HTMLElement>('.workspace-manager-row-reorderable') ?? null;
    if (!row?.dataset.workspacePath || !event.dataTransfer) return;
    draggedPath = row.dataset.workspacePath;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-hvy-workspace-order', draggedPath);
    row.classList.add('is-dragging');
  }, { signal });
  root.addEventListener('dragover', (event) => {
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>('.workspace-manager-row-reorderable') : null;
    if (!row?.dataset.workspacePath || row.dataset.workspacePath === draggedPath) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const before = event.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
    root.querySelectorAll('.workspace-manager-row-reorderable').forEach((item) => item.classList.remove('drop-before', 'drop-after'));
    row.classList.add(before ? 'drop-before' : 'drop-after');
  }, { signal });
  root.addEventListener('drop', (event) => {
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>('.workspace-manager-row-reorderable') : null;
    const source = draggedPath ?? event.dataTransfer?.getData('application/x-hvy-workspace-order') ?? '';
    const target = row?.dataset.workspacePath ?? '';
    if (!source || !target || source === target || !row) return;
    event.preventDefault();
    const before = event.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
    handlers.reorderWorkspace(source, target, before);
  }, { signal });
  root.addEventListener('dragend', () => {
    draggedPath = null;
    root.querySelectorAll('.workspace-manager-row-reorderable').forEach((item) => item.classList.remove('is-dragging', 'drop-before', 'drop-after'));
  }, { signal });
}

export function renderArchivedWorkspaceRow(workspace: ArchivedWorkspace): string {
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
        <button class="hvy-galaxy-button" type="button" data-action="unarchive-workspace" data-workspace-path="${escapeAttr(workspace.path)}">Unarchive</button>
        <button class="hvy-galaxy-button" type="button" data-action="show-workspace-in-folder" data-workspace-path="${escapeAttr(workspace.path)}">${escapeHtml(revealMenuLabel())}</button>
      </div>
    </div>`;
}

export function renderWorkspace(
  workspace: Workspace,
  selectedFilePath: string | null,
  openWorkspaceActionsPath: string | null,
  activeFilters: AppState['workspaceFilters'],
  workspaceClipboard: WorkspaceClipboardState | null,
  fileView: AppState['workspaceFileViews'][string],
  expanded: boolean,
  folderExpanded: Record<string, boolean>,
  savedTemplates: SavedTemplate[],
  embeddingPreview: AppState['workspaceEmbeddingPreviews'][string] | null,
): string {
  const actionsOpen = workspace.path === openWorkspaceActionsPath;
  const filter = activeFilters[workspace.path];
  const rootFilterActive = filter !== undefined && normalizeTreeRelativePath(filter.targetDirectory) === '';
  const matchedDocumentIds = filter
    ? new Set(Object.entries(filter.snapshots).flatMap(([documentId, snapshot]) => snapshot.results.length > 0 ? [documentId] : []))
    : null;
  const filterTitle = filter
    ? `Filter ${workspace.manifest.name}: ${filter.query}`
    : `Filter ${workspace.manifest.name}`;
  const documentsActive = fileView === 'documents';
  const workspaceDropDirectory = documentsActive ? '' : 'templates';
  const workspaceHiddenFromAI = workspace.manifest.hiddenFromAI === true;
  const fileViewNodes = filterNodesByWorkspaceFileView(workspace.files, fileView, workspace, savedTemplates);
  const visibleFiles = documentsActive
    ? filterNodesByTemplateVisibility(fileViewNodes, workspaceTemplateVisibility(workspace))
    : filterNodesByArchivedVisibility(fileViewNodes, workspaceTemplateVisibility(workspace).archivedFiles);
  return `
    <section class="workspace-root${workspaceHiddenFromAI ? ' is-hidden-from-ai' : ''}" data-workspace-path="${escapeAttr(workspace.path)}" data-target-directory="${workspaceDropDirectory}" data-expanded="${expanded ? 'true' : 'false'}">
      <div class="workspace-sticky-header${actionsOpen ? ' is-actions-open' : ''}">
        <button type="button" class="workspace-summary" data-action="toggle-workspace-expanded" data-workspace-path="${escapeAttr(workspace.path)}" aria-expanded="${expanded ? 'true' : 'false'}" title="${escapeAttr(workspace.path)}">
          <span class="sidebar-disclosure workspace-disclosure-icon${expanded ? ' is-expanded' : ''}" aria-hidden="true"></span>
          <span class="workspace-summary-label">${escapeHtml(workspace.manifest.name)}</span>
          ${workspaceHiddenFromAI ? '<span class="tree-file-ai-hidden" title="Hidden from AI">AI</span>' : ''}
        </button>
        ${expanded ? `
          <button type="button" class="hvy-galaxy-button workspace-filter-trigger${rootFilterActive ? ' is-active' : ''}" data-action="open-workspace-filter" data-workspace-path="${escapeAttr(workspace.path)}" title="${escapeAttr(filterTitle)}" aria-label="${escapeAttr(filterTitle)}">${funnelIcon()}</button>
          <div class="workspace-actions-menu${actionsOpen ? ' is-open' : ''}">
            <button type="button" class="hvy-galaxy-button workspace-action-trigger" data-action="toggle-workspace-actions" data-workspace-path="${escapeAttr(workspace.path)}" title="Workspace actions" aria-label="Workspace actions" aria-expanded="${actionsOpen ? 'true' : 'false'}">+</button>
            <div class="workspace-action-popover" role="menu" ${actionsOpen ? '' : 'hidden'}>
              <button class="hvy-galaxy-button" type="button" role="menuitem" data-action="new-document-in-workspace" data-workspace-path="${escapeAttr(workspace.path)}">New Document</button>
              <button class="hvy-galaxy-button" type="button" role="menuitem" data-action="new-folder-in-workspace" data-workspace-path="${escapeAttr(workspace.path)}">New Folder</button>
              <button class="hvy-galaxy-button" type="button" role="menuitem" data-action="add-files-to-workspace" data-workspace-path="${escapeAttr(workspace.path)}" data-target-directory="${workspaceDropDirectory}">Add</button>
              <button class="hvy-galaxy-button" type="button" role="menuitem" data-action="import-in-workspace" data-workspace-path="${escapeAttr(workspace.path)}">Import</button>
              <button class="hvy-galaxy-button" type="button" role="menuitem" data-action="open-workspace-chat" data-workspace-path="${escapeAttr(workspace.path)}">Chat Workspace</button>
            </div>
          </div>
        ` : ''}
      </div>
      ${expanded ? `
        <div class="workspace-view-toggle segmented-control" aria-label="${escapeAttr(`${workspace.manifest.name} view`)}">
          <button type="button" class="hvy-galaxy-button ${documentsActive ? 'is-active' : ''}" data-action="set-workspace-file-view" data-workspace-path="${escapeAttr(workspace.path)}" data-view="documents" aria-pressed="${documentsActive ? 'true' : 'false'}">Docs</button>
          <button type="button" class="hvy-galaxy-button ${documentsActive ? '' : 'is-active'}" data-action="set-workspace-file-view" data-workspace-path="${escapeAttr(workspace.path)}" data-view="templates" aria-pressed="${documentsActive ? 'false' : 'true'}">Templates</button>
        </div>
        ${embeddingPreview?.enabled && !embeddingPreview.loading ? `<div class="workspace-embedding-preview-note">${escapeHtml(embeddingPreview.error ?? 'Showing embeddings')}</div>` : ''}
        <ul class="tree">${sortNodesForFilter(visibleFiles, matchedDocumentIds, filter ?? null).map((node) => renderNode(node, selectedFilePath, matchedDocumentIds, workspaceClipboard, workspace.path, folderExpanded, filter ?? null, embeddingPreview)).join('')}</ul>
      ` : ''}
    </section>`;
}

export function isWorkspaceFileView(value: unknown): value is AppState['workspaceFileViews'][string] {
  return value === 'documents' || value === 'templates';
}

export function filterNodesByWorkspaceFileView(
  nodes: WorkspaceTreeNode[],
  view: AppState['workspaceFileViews'][string],
  workspace: Workspace,
  savedTemplates: SavedTemplate[],
  includeSavedTemplateFallback = true,
): WorkspaceTreeNode[] {
  const visibleNodes: WorkspaceTreeNode[] = [];
  for (const node of nodes) {
    const relativePath = workspaceNodeRelativePath(node);
    const inTemplateFolder = relativePath === 'templates' || relativePath.startsWith('templates/');
    if (node.kind === 'folder') {
      if (view === 'templates' && !inTemplateFolder) {
        const children = filterNodesByWorkspaceFileView(node.children, view, workspace, savedTemplates, false);
        if (children.length > 0) visibleNodes.push({ ...node, children });
        continue;
      }
      if (view === 'documents' && inTemplateFolder) continue;
      const children = filterNodesByWorkspaceFileView(node.children, view, workspace, savedTemplates, false);
      if (view === 'templates' && relativePath === 'templates') {
        visibleNodes.push(...children);
        continue;
      }
      visibleNodes.push({ ...node, children });
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
      visibleNodes.push(...templateFiles);
    }
  }
  return visibleNodes;
}

export function flatNodePaths(node: WorkspaceTreeNode): string[] {
  return node.kind === 'folder' ? node.children.flatMap(flatNodePaths) : [node.path];
}

export function filterNodesByArchivedVisibility(nodes: WorkspaceTreeNode[], showArchived: boolean): WorkspaceTreeNode[] {
  const visibleNodes: WorkspaceTreeNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'folder') {
      const children = filterNodesByArchivedVisibility(node.children, showArchived);
      visibleNodes.push({ ...node, children });
      continue;
    }
    if (node.archived && !showArchived) continue;
    visibleNodes.push(node);
  }
  return visibleNodes;
}

export function filterNodesByTemplateVisibility(nodes: WorkspaceTreeNode[], visibility: WorkspaceTemplateVisibility): WorkspaceTreeNode[] {
  const visibleNodes: WorkspaceTreeNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'folder') {
      const children = filterNodesByTemplateVisibility(node.children, visibility);
      visibleNodes.push({ ...node, children });
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

export function renderNode(
  node: WorkspaceTreeNode,
  selectedFilePath: string | null,
  matchedDocumentIds: Set<string> | null,
  workspaceClipboard: WorkspaceClipboardState | null,
  workspacePath: string,
  folderExpanded: Record<string, boolean>,
  activeFilter: AppState['workspaceFilters'][string] | null = null,
  embeddingPreview: AppState['workspaceEmbeddingPreviews'][string] | null = null,
): string {
  if (node.kind === 'folder') {
    const hasMatch = nodeHasFilterMatch(node, matchedDocumentIds, activeFilter);
    const name = workspaceNodeName(node);
    const relativePath = workspaceNodeRelativePath(node);
    const normalizedRelativePath = normalizeTreeRelativePath(relativePath);
    const children = Array.isArray(node.children) ? node.children : [];
    const hiddenFromAI = node.hiddenFromAI === true;
    const folderOwnsActiveFilter = activeFilter !== null && normalizeTreeRelativePath(activeFilter.targetDirectory) === normalizeTreeRelativePath(relativePath);
    const folderFilterTitle = `Filter ${name}: ${activeFilter?.query ?? ''}`;
    const folderFilterTrigger = folderOwnsActiveFilter
      ? `<button type="button" class="hvy-galaxy-button workspace-filter-trigger folder-filter-trigger is-active" data-action="open-workspace-filter" data-workspace-path="${escapeAttr(workspacePath)}" data-target-directory="${escapeAttr(relativePath)}" title="${escapeAttr(folderFilterTitle)}" aria-label="${escapeAttr(folderFilterTitle)}">${funnelIcon()}</button>`
      : '';
    const folderLabel = `<span class="tree-folder-name">${escapeHtml(name)}</span>${hiddenFromAI ? '<span class="tree-file-ai-hidden" title="Hidden from AI">AI</span>' : ''}${folderFilterTrigger}`;
    if (children.length === 0) {
      return `
        <li class="${matchedDocumentIds && !hasMatch ? 'tree-item-filter-empty' : ''}">
          <div class="tree-folder-row${hiddenFromAI ? ' is-hidden-from-ai' : ''}" data-workspace-folder-target="true" data-workspace-path="${escapeAttr(workspacePath)}" data-target-directory="${escapeAttr(relativePath)}" data-folder-name="${escapeAttr(name)}" data-hidden-from-ai="${hiddenFromAI ? 'true' : 'false'}">
            ${folderLabel}
          </div>
        </li>`;
    }
    const open = folderExpanded[normalizedRelativePath] ?? true;
    return `
      <li class="${matchedDocumentIds && !hasMatch ? 'tree-item-filter-empty' : ''}">
        <details${open ? ' open' : ''}>
          <summary class="${hiddenFromAI ? 'is-hidden-from-ai' : ''}" data-workspace-folder-target="true" data-workspace-path="${escapeAttr(workspacePath)}" data-target-directory="${escapeAttr(relativePath)}" data-folder-name="${escapeAttr(name)}" data-hidden-from-ai="${hiddenFromAI ? 'true' : 'false'}">
            ${folderLabel}
          </summary>
          <ul class="tree">${sortNodesForFilter(children, matchedDocumentIds, activeFilter).map((child) => renderNode(child, selectedFilePath, matchedDocumentIds, workspaceClipboard, workspacePath, folderExpanded, activeFilter, embeddingPreview)).join('')}</ul>
        </details>
      </li>`;
  }
  const selected = node.path === selectedFilePath ? ' is-selected' : '';
  const noFilterMatch = matchedDocumentIds !== null && nodeMatchesFilterScope(node, activeFilter) && !matchedDocumentIds.has(node.path);
  const cutPending = workspaceClipboard?.mode === 'cut' && workspaceClipboard.path === node.path;
  const archived = node.archived === true;
  const locked = node.locked === true;
  const hiddenFromAI = node.hiddenFromAI === true;
  const hasEmbeddingFile = embeddingPreview?.enabled === true && embeddingPreview.sidecars[node.path] === true;
  const extensionBadge = node.extension === '.thvy' || node.extension === '.phvy'
    ? `<span class="tree-file-extension" data-extension="${escapeAttr(node.extension)}">${escapeHtml(node.extension)}</span>`
    : '';
  const embeddingFile = hasEmbeddingFile
    ? `<ul class="tree tree-embedding-files" aria-label="${escapeAttr(`${node.name} embedding files`)}">
        <li>
          <div class="tree-embedding-file" title="${escapeAttr(`${node.path}.emb`)}" aria-disabled="true">
            <span class="tree-file-name">${escapeHtml(`${node.name}.emb`)}</span>
          </div>
        </li>
      </ul>`
    : '';
  return `
    <li>
      <button type="button" class="hvy-galaxy-button tree-file${selected}${noFilterMatch ? ' is-filter-empty' : ''}${cutPending ? ' is-cut-pending' : ''}${archived ? ' is-archived' : ''}${locked ? ' is-locked' : ''}${hiddenFromAI ? ' is-hidden-from-ai' : ''}" data-action="select-file" data-path="${escapeAttr(node.path)}" data-name="${escapeAttr(node.name)}" data-relative-path="${escapeAttr(workspaceNodeRelativePath(node))}" data-archived="${archived ? 'true' : 'false'}" data-locked="${locked ? 'true' : 'false'}" data-hidden-from-ai="${hiddenFromAI ? 'true' : 'false'}" draggable="true" ${cutPending ? 'aria-label="' + escapeAttr(`${displayDocumentName(node.name)} cut`) + '"' : ''}>
        <span class="tree-file-name">${escapeHtml(displayDocumentName(node.name))}</span>
        ${archived ? '<span class="tree-file-archived">Archived</span>' : ''}
        ${locked ? '<span class="tree-file-archived">Locked</span>' : ''}
        ${hiddenFromAI ? '<span class="tree-file-ai-hidden" title="Hidden from AI">AI</span>' : ''}
        ${extensionBadge}
      </button>
      ${embeddingFile}
    </li>`;
}

export function sortNodesForFilter(
  nodes: WorkspaceTreeNode[],
  matchedDocumentIds: Set<string> | null,
  activeFilter: AppState['workspaceFilters'][string] | null = null,
): WorkspaceTreeNode[] {
  if (!matchedDocumentIds) return nodes;
  return [...nodes].sort((left, right) => Number(nodeHasFilterMatch(right, matchedDocumentIds, activeFilter)) - Number(nodeHasFilterMatch(left, matchedDocumentIds, activeFilter)));
}

export function nodeHasFilterMatch(
  node: WorkspaceTreeNode,
  matchedDocumentIds: Set<string> | null,
  activeFilter: AppState['workspaceFilters'][string] | null = null,
): boolean {
  if (!matchedDocumentIds) return true;
  if (!nodeTouchesFilterScope(node, activeFilter)) return true;
  if (node.kind === 'file') return matchedDocumentIds.has(node.path);
  return node.children.some((child) => nodeHasFilterMatch(child, matchedDocumentIds, activeFilter));
}

export function nodeMatchesFilterScope(
  node: WorkspaceTreeNode,
  activeFilter: AppState['workspaceFilters'][string] | null,
): boolean {
  const scope = normalizeTreeRelativePath(activeFilter?.targetDirectory ?? '');
  if (!scope) return true;
  return normalizeTreeRelativePath(workspaceNodeRelativePath(node)).startsWith(`${scope}/`);
}

export function nodeTouchesFilterScope(
  node: WorkspaceTreeNode,
  activeFilter: AppState['workspaceFilters'][string] | null,
): boolean {
  const scope = normalizeTreeRelativePath(activeFilter?.targetDirectory ?? '');
  if (!scope) return true;
  const relativePath = normalizeTreeRelativePath(workspaceNodeRelativePath(node));
  if (node.kind === 'file') return relativePath.startsWith(`${scope}/`);
  return relativePath === scope || relativePath.startsWith(`${scope}/`) || scope.startsWith(`${relativePath}/`);
}

export function normalizeTreeRelativePath(path: string | null | undefined): string {
  return (path ?? '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
}

export function displayDocumentName(name: string): string {
  return name.replace(/\.([tp]?hvy|md)$/i, '');
}

export function renderEmptyState(state: AppState): string {
  if (state.document) {
    return '';
  }
  return `
    <div class="empty-state">
      <h2>Choose a file from a workspace</h2>
      <p>Open a workspace folder or a standalone HVY file to start viewing and editing.</p>
    </div>`;
}

export function renderNewWorkspaceDialog(state: AppState): string {
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
            <button type="button" class="hvy-galaxy-button ${managedActive ? 'is-active' : ''}" data-action="set-new-workspace-location" data-location="managed" aria-pressed="${managedActive ? 'true' : 'false'}">App managed</button>
            <button type="button" class="hvy-galaxy-button ${chooseActive ? 'is-active' : ''}" data-action="set-new-workspace-location" data-location="choose" aria-pressed="${chooseActive ? 'true' : 'false'}">Choose folder</button>
          </div>
        </div>
        <input class="hvy-galaxy-input" name="workspaceLocation" type="hidden" value="${escapeAttr(state.newWorkspaceLocation)}">
        ${managedActive ? `
          <label>
            <span>Name</span>
            <input class="hvy-galaxy-input" name="workspaceName" type="text" autocomplete="off" autofocus required data-field="workspace-name">
          </label>
          <p class="dialog-note" data-role="workspace-name-note">Choose a unique name for a new app-managed workspace.</p>
        ` : ''}
        <p class="dialog-note">${chooseActive ? 'Pick any folder, including a synced Google Drive or OneDrive folder.' : 'Stored in the app data folder on this device.'}</p>
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="cancel-new-workspace">Cancel</button>
          <button class="hvy-galaxy-button" type="submit" data-role="new-workspace-submit" ${state.busy || managedActive ? 'disabled' : ''}>${chooseActive ? 'Select' : 'Create'}</button>
        </div>
      </form>
    </div>`;
}

export function renderWorkspaceInitializationDialog(state: AppState): string {
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
          <button class="hvy-galaxy-button" type="button" data-action="cancel-workspace-initialization">Cancel</button>
          <button class="hvy-galaxy-button" type="button" data-action="confirm-workspace-initialization" ${state.busy ? 'disabled' : ''}>Create</button>
        </div>
      </section>
    </div>`;
}

export function updateNewWorkspaceSubmit(form: HTMLFormElement): void {
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

export function updateWorkspaceFilterSubmit(form: HTMLFormElement): void {
  const submit = form.querySelector<HTMLButtonElement>('[data-role="workspace-filter-submit"]');
  const query = form.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-field="workspace-filter-query"]')?.value.trim() ?? '';
  if (submit) {
    const isSemanticLoading = form.classList.contains('is-semantic-mode') && form.dataset.loading === 'true';
    submit.disabled = !isSemanticLoading && query.length === 0;
  }
}

export function parseExistingWorkspaceNames(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const names = JSON.parse(value);
    return Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string') : [];
  } catch {
    return [];
  }
}

export function isNewWorkspaceLocation(value: unknown): value is 'managed' | 'choose' {
  return value === 'managed' || value === 'choose';
}

export function isTemplateScope(value: unknown): value is TemplateScope {
  return value === 'app' || value === 'workspace';
}

export function isTemplateExtension(value: unknown): value is TemplateExtension {
  return value === '.thvy' || value === '.phvy';
}

export function isDocumentCreationType(value: unknown): value is DocumentCreationType {
  return value === 'hvy' || value === 'thvy' || value === 'phvy';
}

export function isImportSourceTab(value: unknown): value is AppState['importSourceTab'] {
  return value === 'workspace' || value === 'anywhere';
}

export function isImportOutputMode(value: unknown): value is AppState['importOutputMode'] {
  return value === 'current' || value === 'workspace';
}

export function isSaveAsScope(value: unknown): value is AppState['saveAsScope'] {
  return value === 'workspace' || value === 'anywhere';
}

export function isSaveAsKind(value: unknown): value is AppState['saveAsKind'] {
  return value === 'document' || value === 'template';
}
