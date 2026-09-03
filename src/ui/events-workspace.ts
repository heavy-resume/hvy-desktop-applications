import { type WorkspaceFileNode, type WorkspaceTreeNode } from '../backend';
import { workspacePathForFileInWorkspaces, type AppState, type WorkspaceClipboardState } from '../state';
import { parentDirectoryForRelativePath, workspaceDropTargetFromElement } from '../workspaceDropTarget';
import { workspaceFileConversionAction } from '../workspaceFileConversion';
import { workspaceNodeName, workspaceNodeRelativePath } from './render-workspace-dialogs';
import { normalizeTreeRelativePath } from './render-workspaces';
import { escapeAttr, escapeHtml } from './shared';
import { UiHandlers } from './types';

export let activeFileContextMenuCleanup: (() => void) | null = null;

export function bindWorkspaceEvents(root: HTMLElement, handlers: UiHandlers, state: AppState, signal: AbortSignal): void {
  root.addEventListener('contextmenu', (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const fileButton = target?.closest<HTMLButtonElement>('.tree-file');
    const path = fileButton?.dataset.path;
    const name = fileButton?.dataset.name;
    const relativePath = fileButton?.dataset.relativePath ?? name ?? '';
    const archived = fileButton?.dataset.archived === 'true';
    if (fileButton && path && name) {
      const workspacePath = workspacePathForTreeTarget(fileButton, state);
      if (!workspacePath) return;
      event.preventDefault();
      const encryptedFolderDocument = fileButton.dataset.encryptedFolderDocument === 'true';
      const locked = fileButton.dataset.locked === 'true';
      const hiddenFromAI = fileButton.getAttribute('data-hidden-from-ai') === 'true';
      showFileContextMenu(event, path, name, relativePath, workspacePath, archived, locked, hiddenFromAI, state.workspaceClipboard, handlers, state.workspaces.length > 0, encryptedFolderDocument);
      return;
    }
    const folderSummary = target?.closest<HTMLElement>('.tree [data-workspace-folder-action-target="true"]');
    if (folderSummary?.dataset.workspacePath) {
      event.preventDefault();
      showWorkspaceContextMenu(
        event,
        folderSummary.dataset.workspacePath,
        state.workspaceClipboard,
        handlers,
        folderSummary.dataset.targetDirectory ?? '',
        folderSummary.dataset.hiddenFromAi === 'true',
        workspaceFolderDeleteInfo(state, folderSummary.dataset.workspacePath, folderSummary.dataset.targetDirectory ?? '', folderSummary.dataset.folderName ?? ''),
        folderSummary.dataset.encryptedFolder === 'true',
        folderSummary.dataset.folderName ?? 'Encrypted folder',
      );
      return;
    }
    const workspaceSummary = target?.closest<HTMLElement>('.workspace-summary');
    const workspacePath = workspaceSummary?.closest<HTMLElement>('.workspace-root')?.dataset.workspacePath;
    if (workspaceSummary && workspacePath) {
      event.preventDefault();
      const workspace = state.workspaces.find((candidate) => candidate.path === workspacePath);
      showWorkspaceContextMenu(event, workspacePath, state.workspaceClipboard, handlers, '', workspace?.manifest.hiddenFromAI === true);
      return;
    }
    const workspaceRoot = target?.closest<HTMLElement>('.workspace-root');
    if (!workspaceRoot?.dataset.workspacePath || target?.closest('.tree .tree')) return;
    event.preventDefault();
    const workspace = state.workspaces.find((candidate) => candidate.path === workspaceRoot.dataset.workspacePath);
    showWorkspaceContextMenu(event, workspaceRoot.dataset.workspacePath, state.workspaceClipboard, handlers, '', workspace?.manifest.hiddenFromAI === true);
  }, { signal });
  root.addEventListener('mousedown', (event) => {
    if (event.button !== 2) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target?.closest('.tree-file, .tree summary, .tree-folder-row')) return;
    event.preventDefault();
  }, { signal });
  root.addEventListener('click', (event) => {
    const summary = event.target instanceof HTMLElement
      ? event.target.closest<HTMLElement>('.tree summary[data-workspace-folder-action-target="true"]')
      : null;
    const details = summary?.parentElement instanceof HTMLDetailsElement ? summary.parentElement : null;
    const workspacePath = summary?.dataset.workspacePath;
    const relativePath = summary?.dataset.targetDirectory ?? '';
    if (!summary || !details || !workspacePath) return;
    const wasOpen = details.open;
    window.setTimeout(() => {
      if (details.open === wasOpen) return;
      handlers.setWorkspaceFolderExpanded(workspacePath, relativePath, details.open);
    }, 0);
  }, { signal, capture: true });
}

export function workspacePathForTreeTarget(target: HTMLElement, state: AppState): string | null {
  return target.closest<HTMLElement>('.workspace-root')?.dataset.workspacePath
    ?? workspacePathForFileNode(state.workspaces, target.dataset.path ?? '');
}

export function workspacePathForFileNode(workspaces: AppState['workspaces'], filePath: string): string | null {
  return workspacePathForFileInWorkspaces(workspaces, filePath);
}

export function findWorkspaceFileByPath(workspaces: AppState['workspaces'], filePath: string): { path: string; name: string } | null {
  for (const workspace of workspaces) {
    const node = findWorkspaceFileNode(workspace.files, filePath);
    if (node) return node;
  }
  return null;
}

export function findWorkspaceFileNode(nodes: WorkspaceTreeNode[], filePath: string): WorkspaceFileNode | null {
  for (const node of nodes) {
    if (node.kind === 'file' && node.path === filePath) return node;
    if (node.kind === 'folder') {
      const match = findWorkspaceFileNode(node.children, filePath);
      if (match) return match;
    }
  }
  return null;
}

export interface WorkspaceFolderDeleteInfo {
  folderName: string;
  activeFileCount: number;
  archivedFiles: string[];
}

export function workspaceFolderDeleteInfo(state: AppState, workspacePath: string, targetDirectory: string, fallbackFolderName = ''): WorkspaceFolderDeleteInfo | null {
  if (!targetDirectory) return null;
  const workspace = state.workspaces.find((candidate) => candidate.path === workspacePath);
  if (!workspace) {
    return {
      folderName: fallbackFolderName || targetDirectory.split('/').filter(Boolean).at(-1) || 'folder',
      activeFileCount: 0,
      archivedFiles: [],
    };
  }
  const folder = findWorkspaceFolderNode(workspace.files, targetDirectory);
  if (!folder) {
    return {
      folderName: fallbackFolderName || targetDirectory.split('/').filter(Boolean).at(-1) || 'folder',
      activeFileCount: 0,
      archivedFiles: [],
    };
  }
  let activeFileCount = 0;
  const archivedFiles: string[] = [];
  const visit = (nodes: WorkspaceTreeNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'folder') {
        visit(node.children);
        continue;
      }
      if (node.archived === true) archivedFiles.push(workspaceNodeRelativePath(node));
      else activeFileCount += 1;
    }
  };
  visit(folder.children);
  return {
    folderName: workspaceNodeName(folder),
    activeFileCount,
    archivedFiles: archivedFiles.sort((left, right) => left.localeCompare(right)),
  };
}

export function findWorkspaceFolderNode(nodes: WorkspaceTreeNode[], targetDirectory: string): Extract<WorkspaceTreeNode, { kind: 'folder' }> | null {
  const normalizedTarget = normalizeTreeRelativePath(targetDirectory);
  for (const node of nodes) {
    if (node.kind !== 'folder') continue;
    if (normalizeTreeRelativePath(workspaceNodeRelativePath(node)) === normalizedTarget) return node;
    const match = findWorkspaceFolderNode(node.children, targetDirectory);
    if (match) return match;
  }
  return null;
}

export function workspaceDropTargetFromEvent(event: Event): { element: HTMLElement; workspacePath: string; targetDirectory: string } | null {
  return workspaceDropTargetFromElement(event.target instanceof Element ? event.target : null);
}

export function setDragOverTarget(root: HTMLElement, target: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.is-drag-over').forEach((element) => {
    element.classList.toggle('is-drag-over', element === target);
  });
  target.classList.add('is-drag-over');
}

export function hasDraggedFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

export function hasDraggedWorkspaceFile(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('application/x-hvy-workspace-file');
}

export function showFileContextMenu(
  event: MouseEvent,
  path: string,
  name: string,
  relativePath: string,
  workspacePath: string,
  archived: boolean,
  locked: boolean,
  hiddenFromAI: boolean,
  clipboard: WorkspaceClipboardState | null,
  handlers: UiHandlers,
  showWorkspaceActions: boolean,
  encryptedFolderDocument = false,
): void {
  void clipboard;
  closeFileContextMenu();
  const menu = document.createElement('div');
  menu.className = 'file-context-menu';
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
  const parentDirectory = parentDirectoryForRelativePath(relativePath);
  const conversion = workspaceFileConversionAction(name, relativePath);
  menu.innerHTML = archived ? `
    <button class="hvy-galaxy-button" type="button" data-menu-action="restore">Restore</button>
    <button class="hvy-galaxy-button" type="button" data-menu-action="delete">Delete</button>
  ` : encryptedFolderDocument ? `
    <button class="hvy-galaxy-button" type="button" data-menu-action="new-document">New Document</button>
    <button class="hvy-galaxy-button" type="button" data-menu-action="${hiddenFromAI ? 'enable-encrypted-ai' : 'disable-encrypted-ai'}">${hiddenFromAI ? 'Enable AI Access' : 'Disable AI Access'}</button>
    <button class="hvy-galaxy-button" type="button" data-menu-action="rename">Rename</button>
    <button class="hvy-galaxy-button" type="button" data-menu-action="archive">Archive</button>
    ${showWorkspaceActions ? '<button class="hvy-galaxy-button" type="button" data-menu-action="move-to-workspace">Move to...</button>' : ''}
  ` : `
    <button class="hvy-galaxy-button" type="button" data-menu-action="new-document">New Document</button>
    <button class="hvy-galaxy-button" type="button" data-menu-action="reveal">${escapeHtml(revealMenuLabel())}</button>
    <button class="hvy-galaxy-button" type="button" data-menu-action="${locked ? 'unlock' : 'lock'}">${locked ? 'Unlock File' : 'Lock File'}</button>
    <button class="hvy-galaxy-button" type="button" data-menu-action="${hiddenFromAI ? 'unhide-from-ai' : 'hide-from-ai'}">${hiddenFromAI ? 'Unhide from AI' : 'Hide from AI'}</button>
    <button class="hvy-galaxy-button" type="button" data-menu-action="rename">Rename</button>
    ${conversion ? `<button class="hvy-galaxy-button" type="button" data-menu-action="convert-workspace-file">${conversion.label}</button>` : ''}
    <button class="hvy-galaxy-button" type="button" data-menu-action="archive">Archive</button>
    <button class="hvy-galaxy-button" type="button" data-menu-action="copy">Copy</button>
    <button class="hvy-galaxy-button" type="button" data-menu-action="cut">Cut</button>
    <button class="hvy-galaxy-button" type="button" data-menu-action="paste">Paste</button>
    ${showWorkspaceActions ? '<button class="hvy-galaxy-button" type="button" data-menu-action="copy-to-workspace">Copy to...</button><button class="hvy-galaxy-button" type="button" data-menu-action="move-to-workspace">Move to...</button>' : ''}
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
    if (button.dataset.menuAction === 'new-document') handlers.newDocumentInWorkspace(workspacePath, parentDirectory);
    if (button.dataset.menuAction === 'reveal') handlers.showFileInFolder(path);
    if (button.dataset.menuAction === 'rename') handlers.renameFile(path, name);
    if (button.dataset.menuAction === 'convert-workspace-file' && conversion) handlers.convertWorkspaceFileKind(path, workspacePath, conversion.toTemplate);
    if (button.dataset.menuAction === 'archive') handlers.archiveFile(path, name);
    if (button.dataset.menuAction === 'restore') handlers.restoreFile(path, name);
    if (button.dataset.menuAction === 'lock') handlers.setFileLocked(path, name, true);
    if (button.dataset.menuAction === 'unlock') handlers.setFileLocked(path, name, false);
    if (button.dataset.menuAction === 'hide-from-ai') handlers.setFileHiddenFromAI(path, name, true);
    if (button.dataset.menuAction === 'unhide-from-ai') handlers.setFileHiddenFromAI(path, name, false);
    if (button.dataset.menuAction === 'enable-encrypted-ai') handlers.setEncryptedFileAIAllowed(workspacePath, path, name, true);
    if (button.dataset.menuAction === 'disable-encrypted-ai') handlers.setEncryptedFileAIAllowed(workspacePath, path, name, false);
    if (button.dataset.menuAction === 'delete') handlers.confirmDeleteFile(path, name);
    if (button.dataset.menuAction === 'copy') handlers.copyWorkspaceFile(path, name);
    if (button.dataset.menuAction === 'cut') handlers.cutWorkspaceFile(path, name);
    if (button.dataset.menuAction === 'paste') handlers.pasteWorkspaceClipboard(workspacePath, parentDirectory);
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

export function showWorkspaceContextMenu(
  event: MouseEvent,
  workspacePath: string,
  clipboard: WorkspaceClipboardState | null,
  handlers: UiHandlers,
  targetDirectory = '',
  hiddenFromAI = false,
  deleteInfo: WorkspaceFolderDeleteInfo | null = null,
  encryptedFolder = false,
  encryptedFolderName = 'Encrypted folder',
): void {
  closeFileContextMenu();
  const menu = document.createElement('div');
  menu.className = 'file-context-menu';
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
  void clipboard;
  const deleteDisabled = deleteInfo === null || deleteInfo.activeFileCount > 0;
  const deleteTitle = deleteDisabled && deleteInfo?.activeFileCount
    ? `Folder contains ${deleteInfo.activeFileCount} active file${deleteInfo.activeFileCount === 1 ? '' : 's'}`
    : 'Delete folder';
  menu.innerHTML = encryptedFolder ? `
    <button class="hvy-galaxy-button" type="button" data-menu-action="new-folder">New Folder</button>
    <button class="hvy-galaxy-button" type="button" data-menu-action="new-document">New Document</button>
    <button class="hvy-galaxy-button" type="button" data-menu-action="${hiddenFromAI ? 'enable-encrypted-ai' : 'disable-encrypted-ai'}">${hiddenFromAI ? 'Enable AI Access' : 'Disable AI Access'}</button>
    <button class="hvy-galaxy-button" type="button" data-menu-action="add-files">Add Files</button>
    <button class="hvy-galaxy-button" type="button" data-menu-action="import">Import</button>
    <button class="hvy-galaxy-button" type="button" data-menu-action="rename-folder">Rename</button>
    ${targetDirectory ? `<button class="hvy-galaxy-button" type="button" data-menu-action="delete-folder" title="${escapeAttr(deleteTitle)}" ${deleteDisabled ? 'disabled' : ''}>Delete</button>` : ''}
  ` : `
    <button class="hvy-galaxy-button" type="button" data-menu-action="new-folder">New Folder</button>
    <button class="hvy-galaxy-button" type="button" data-menu-action="new-encrypted-folder">New Encrypted Folder</button>
    <button class="hvy-galaxy-button" type="button" data-menu-action="new-document">New Document</button>
    <button class="hvy-galaxy-button" type="button" data-menu-action="add-files">Add Files</button>
    <button class="hvy-galaxy-button" type="button" data-menu-action="import">Import</button>
    <button class="hvy-galaxy-button" type="button" data-menu-action="paste">Paste</button>
    ${targetDirectory ? '<button class="hvy-galaxy-button" type="button" data-menu-action="filter">Filter Folder</button>' : ''}
    ${targetDirectory ? '<button class="hvy-galaxy-button" type="button" data-menu-action="chat">Chat Folder</button>' : '<button class="hvy-galaxy-button" type="button" data-menu-action="chat">Chat Workspace</button>'}
    <button class="hvy-galaxy-button" type="button" data-menu-action="${hiddenFromAI ? 'unhide-from-ai' : 'hide-from-ai'}">${hiddenFromAI ? 'Unhide from AI' : 'Hide from AI'}</button>
    ${targetDirectory ? `<button class="hvy-galaxy-button" type="button" data-menu-action="delete-folder" title="${escapeAttr(deleteTitle)}" ${deleteDisabled ? 'disabled' : ''}>Delete</button>` : ''}
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
    if (button.dataset.menuAction === 'new-folder') handlers.openNewFolder(workspacePath, targetDirectory);
    if (button.dataset.menuAction === 'new-encrypted-folder') handlers.openNewFolder(workspacePath, targetDirectory, true);
    if (button.dataset.menuAction === 'new-document') handlers.newDocumentInWorkspace(workspacePath, targetDirectory);
    if (button.dataset.menuAction === 'rename-folder') handlers.renameEncryptedFolder(workspacePath, targetDirectory, deleteInfo?.folderName ?? targetDirectory.split('/').filter(Boolean).at(-1) ?? 'Encrypted folder');
    if (button.dataset.menuAction === 'add-files') handlers.addFilesToWorkspace(workspacePath, targetDirectory);
    if (button.dataset.menuAction === 'import') handlers.openImportInWorkspace(workspacePath, targetDirectory);
    if (button.dataset.menuAction === 'paste') handlers.pasteWorkspaceClipboard(workspacePath, targetDirectory);
    if (button.dataset.menuAction === 'filter') handlers.openWorkspaceFilter(workspacePath, targetDirectory);
    if (button.dataset.menuAction === 'chat') handlers.openWorkspaceChat(workspacePath, targetDirectory);
    if (button.dataset.menuAction === 'hide-from-ai') {
      if (targetDirectory) handlers.setWorkspaceFolderHiddenFromAI(workspacePath, targetDirectory, true);
      else handlers.setWorkspaceHiddenFromAI(workspacePath, true);
    }
    if (button.dataset.menuAction === 'unhide-from-ai') {
      if (targetDirectory) handlers.setWorkspaceFolderHiddenFromAI(workspacePath, targetDirectory, false);
      else handlers.setWorkspaceHiddenFromAI(workspacePath, false);
    }
    if (button.dataset.menuAction === 'enable-encrypted-ai') handlers.setEncryptedFolderAIAllowed(workspacePath, targetDirectory, encryptedFolderName, true);
    if (button.dataset.menuAction === 'disable-encrypted-ai') handlers.setEncryptedFolderAIAllowed(workspacePath, targetDirectory, encryptedFolderName, false);
    if (button.dataset.menuAction === 'delete-folder') {
      if (deleteInfo && deleteInfo.archivedFiles.length > 0) {
        handlers.confirmDeleteWorkspaceFolder(workspacePath, targetDirectory, deleteInfo.folderName, deleteInfo.archivedFiles);
      } else {
        handlers.deleteWorkspaceFolder(workspacePath, targetDirectory);
      }
    }
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

export function closeFileContextMenu(): void {
  activeFileContextMenuCleanup?.();
  document.querySelector('.file-context-menu')?.remove();
}

export function revealMenuLabel(): string {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes('mac')) return 'Show in Finder';
  if (platform.includes('win')) return 'Open in Explorer';
  return 'Open Containing Folder';
}
