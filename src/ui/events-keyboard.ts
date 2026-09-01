import { type AppState } from '../state';
import { findRichTextActionButton, richTextActionForShortcutKey, type RichTextAction } from '../uiShortcuts';
import { MAX_WORKSPACE_SIDEBAR_WIDTH, MIN_WORKSPACE_SIDEBAR_WIDTH } from './core';
import { findWorkspaceFileByPath, workspacePathForFileNode } from './events-workspace';
import { readAiSettingsForm, readAppSettingsForm, readMcpSettingsForm } from './render-ai-mcp';
import { UiHandlers } from './types';

export let workspaceSidebarWidth = 320;

export function bindEscapeEvents(root: HTMLElement, handlers: UiHandlers, state: AppState, signal: AbortSignal): void {
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && handleWorkspaceClipboardShortcut(event, state, handlers)) {
      return;
    }
    if (event.key !== 'Escape') return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (root.querySelector('.homepage-picker-dialog')) {
      event.preventDefault();
      handlers.cancelHomepagePicker();
      return;
    }
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
    if (root.querySelector('.scripting-review-dialog')) {
      event.preventDefault();
      handlers.closeScriptingReview();
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
      handlers.cancelAppSettings(readAppSettingsForm(new FormData(appSettingsForm), state.document?.path ?? ''));
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
    if (root.querySelector('form[data-form="new-folder"]')) {
      event.preventDefault();
      handlers.cancelNewFolder();
      return;
    }
    if (root.querySelector('.delete-file-dialog')) {
      event.preventDefault();
      handlers.cancelDeleteFile();
      return;
    }
    if (root.querySelector('.delete-folder-dialog')) {
      event.preventDefault();
      handlers.cancelDeleteWorkspaceFolder();
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
    if (root.querySelector('.workspace-file-operation-dialog')) {
      event.preventDefault();
      handlers.cancelWorkspaceFileOperation();
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

export function handleApplicationShortcut(event: KeyboardEvent, root: HTMLElement, handlers: UiHandlers): boolean {
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

export function clickActiveRichTextAction(root: HTMLElement, action: RichTextAction): boolean {
  const editable = getActiveRichEditable(root);
  if (!editable) return false;
  const button = findRichTextActionButton(editable, action);
  if (!button) return false;
  button.click();
  return true;
}

export function getActiveRichEditable(root: HTMLElement): HTMLElement | null {
  const target = document.activeElement;
  if (!(target instanceof HTMLElement) || !target.closest('#hvyMount')) return null;
  if (!root.contains(target)) return null;
  if (target.isContentEditable && target.dataset.field) return target;
  return target.closest<HTMLElement>('[contenteditable="true"][data-field]');
}

export function cssEscape(value: string): string {
  if ('CSS' in window && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replaceAll('"', '\\"');
}

export function bindWorkspaceSidebarResize(root: HTMLElement, signal: AbortSignal): void {
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

export function applyWorkspaceSidebarWidth(root: HTMLElement): void {
  root.style.setProperty('--workspace-sidebar-width', `${workspaceSidebarWidth}px`);
}

export function handleWorkspaceClipboardShortcut(event: KeyboardEvent, state: AppState, handlers: UiHandlers): boolean {
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

export function hasActiveTextSelection(): boolean {
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().length > 0);
}

export function isTextEditingTarget(target: HTMLElement): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target.isContentEditable;
}
