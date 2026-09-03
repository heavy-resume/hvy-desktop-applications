import { getFileActionAvailability, isWorkspaceTemplatePath } from '../fileActions';
import type { HvyMode } from '../hvy';
import { type AppState } from '../state';
import { getDocumentColorsEnabled } from './render-theme';
import { escapeAttr, escapeHtml } from './shared';

export function renderDocumentTabs(state: AppState): string {
  return `
    <nav class="document-tabs${state.documentTabs.length === 0 ? ' is-empty' : ''}" aria-label="Open documents">
      ${state.documentTabs.map((tab) => `
        <div class="document-tab${tab.active ? ' is-active' : ''}${tab.dirty ? ' is-dirty' : ''}${tab.readOnly ? ' is-read-only' : ''}${tab.hiddenFromAI ? ' is-hidden-from-ai' : ''}">
          <button type="button" class="hvy-galaxy-button document-tab-main" data-action="select-document-tab" data-path="${escapeAttr(tab.versionId)}" title="${escapeAttr(tab.sourcePath)}" aria-current="${tab.active ? 'page' : 'false'}">
            <span class="document-tab-dirty" aria-hidden="true"></span>
            <span class="document-tab-name">${escapeHtml(tab.name)}</span>
          </button>
          <button type="button" class="hvy-galaxy-button document-tab-close" data-action="close-document-tab" data-path="${escapeAttr(tab.versionId)}" title="Close ${escapeAttr(tab.name)}" aria-label="Close ${escapeAttr(tab.name)}">&times;</button>
        </div>
      `).join('')}
    </nav>`;
}

export function renderTabStackPopover(state: AppState): string {
  if (!state.tabStackOpen || state.documentTabs.length === 0) {
    return '';
  }
  const activeIndex = ((state.tabStackIndex % state.documentTabs.length) + state.documentTabs.length) % state.documentTabs.length;
  return `
    <div class="tab-stack-popover" role="listbox" aria-label="Open documents">
      ${state.documentTabs.map((tab, index) => `
        <button type="button" class="hvy-galaxy-button tab-stack-item${index === activeIndex ? ' is-selected' : ''}${tab.dirty ? ' is-dirty' : ''}" role="option" aria-selected="${index === activeIndex ? 'true' : 'false'}" data-action="select-tab-stack-item" data-path="${escapeAttr(tab.versionId)}">
          <span class="tab-stack-dirty" aria-hidden="true"></span>
          <span>${escapeHtml(tab.name)}</span>
        </button>
      `).join('')}
    </div>`;
}

export function renderToolbar(state: AppState): string {
  const document = state.document;
  if (!document) {
    return `
      <div class="toolbar-title">No document selected</div>
      <div class="toolbar-actions"></div>`;
  }
  if (document.virtual === 'workspaceChat') {
    const dirtyState = state.workspaceChat.dirty ? 'dirty' : 'clean';
    const dirtyLabel = state.workspaceChat.dirty ? 'Unsaved' : 'Saved';
    return `
      <div class="toolbar-title">
        <strong title="${escapeAttr(document.source.path)}">${escapeHtml(document.source.name)}</strong>
        <span>${escapeHtml(state.workspaceChat.scopeLabel || 'Workspace chat')}</span>
      </div>
      <div class="toolbar-actions">
        <span class="dirty-indicator" data-state="${dirtyState}">${dirtyLabel}</span>
        <button class="hvy-galaxy-button" type="button" data-action="save-workspace-chat" ${state.workspaceChat.messages.length === 0 || state.busy ? 'disabled' : ''}>Save Chat</button>
        <button class="hvy-galaxy-button" type="button" data-action="close-workspace-chat">Close</button>
      </div>`;
  }
  const dirtyState = document.readOnly ? 'read-only' : document.dirty ? 'dirty' : 'clean';
  const dirtyLabel = document.readOnly ? 'Read only' : document.dirty ? 'Unsaved' : 'Saved';
  const fileActions = getFileActionAvailability(state);
  const showExportPdf = document.source.extension === '.phvy' && !isWorkspaceTemplatePath(state, document.source.path);
  const documentColorsEnabled = getDocumentColorsEnabled(state);
  const documentColorsEditable = !document.readOnly || document.virtual === 'defaultDocument';
  return `
    <div class="toolbar-title">
      <strong title="${escapeAttr(document.source.path)}">${escapeHtml(document.source.name)}</strong>
      <span>${document.readOnly ? 'Read-only document' : document.virtual === 'versionHistory' ? 'History snapshot — saves as new document' : document.virtual === 'recoveryDraft' ? 'Recovered unsaved copy' : document.hiddenFromAI ? 'Hidden from AI' : document.isNew ? 'Unsaved document' : 'Document'}</span>
    </div>
    <div class="toolbar-actions">
      <span class="dirty-indicator" data-state="${dirtyState}">${dirtyLabel}</span>
      <label class="document-color-toggle">
        <input class="hvy-galaxy-input" type="checkbox" data-field="use-document-colors" ${documentColorsEnabled ? 'checked' : ''} ${documentColorsEditable ? '' : 'disabled'}>
        <span>Use document colors</span>
      </label>
      <button class="hvy-galaxy-button" type="button" data-action="open-document-colors" ${!documentColorsEditable || !documentColorsEnabled ? 'disabled' : ''}>Document Colors...</button>
      <button class="hvy-galaxy-button" type="button" data-action="import-into-current" ${fileActions.importCurrent ? '' : 'disabled'}>Import</button>
      ${showExportPdf ? `<button class="hvy-galaxy-button" type="button" data-action="export-pdf" ${fileActions.exportPdf ? '' : 'disabled'}>Export PDF</button>` : ''}
    </div>`;
}

export function renderModeControls(activeMode: HvyMode, readOnly: boolean, metaOpen: boolean, hiddenFromAI = false): string {
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
    return `<button type="button" class="hvy-galaxy-button mode-button${active}" data-action="set-mode" data-mode="${mode}" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}" aria-pressed="${active ? 'true' : 'false'}"${disabled}>${contents}</button>`;
  };
  return `
    <nav class="mode-controls${showEditorSubmodes ? ' is-editor-enabled' : ''}" aria-label="HVY editor mode">
      ${showEditorSubmodes ? `<div class="mode-editor-submodes">${buttonHtml(modes[3])}${buttonHtml(modes[4])}<button type="button" class="hvy-galaxy-button mode-button mode-button-meta${metaOpen ? ' is-active' : ''}" data-action="open-document-meta" title="Document Meta" aria-label="Document Meta" aria-pressed="${metaOpen ? 'true' : 'false'}"${readOnly ? ' disabled' : ''}><span>Meta</span></button></div>` : ''}
      <div class="mode-primary-controls">
        ${buttonHtml(modes[2])}
        ${buttonHtml(modes[1])}
        ${buttonHtml(modes[0])}
      </div>
    </nav>`;
}

export function modeIcon(mode: HvyMode): string {
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

export function sparklesIcon(): string {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z"/><path d="M19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z"/></svg>';
}

export function funnelIcon(): string {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18l-7 8v5l-4 2v-7L3 5Z"/></svg>';
}

export function closeIcon(): string {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
}

export function eyeIcon(): string {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>';
}

export function eyeOffIcon(): string {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.4 5.4A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a18.5 18.5 0 0 1-3.1 4.1"/><path d="M6.6 6.6C3.6 8.5 2 12 2 12s3.5 7 10 7c1.4 0 2.7-.3 3.9-.9"/></svg>';
}

export function copyIcon(): string {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
}

export function gearIcon(): string {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 1 1 4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.3 7A2 2 0 1 1 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 .9-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6.9h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z"/></svg>';
}
