import ufoLogoUrl from '../assets/ufo-no-bg.svg';
import { type AppState } from '../state';
import { bindClickEvents } from './events-click';
import { bindControlEvents } from './events-controls';
import { bindFormEvents } from './events-forms';
import { applyWorkspaceSidebarWidth, bindEscapeEvents, bindWorkspaceSidebarResize, handleApplicationShortcut } from './events-keyboard';
import { bindWorkspaceEvents } from './events-workspace';
import { renderAiSettingsDialog, renderAiSettingsDiscardDialog, renderMcpSettingsDialog, renderMcpSettingsDiscardDialog, syncAiRangeFields } from './render-ai-mcp';
import { renderAppSettingsDialog, renderAppSettingsDiscardDialog, renderDebugLogDialog, renderHomepageErrorDialog, renderHomepagePickerDialog, renderScriptingReviewDialog } from './render-app-settings';
import { renderAppCloseDialog, renderCloseDocumentDialog, renderCloseDocumentDraftDialog, renderRecoveryDialog, renderSaveConflictDialog, renderVersionHistoryDialog, renderWorkspaceFileOperationPrompt } from './render-document-dialogs';
import { renderAboutDialog, renderExportedPdfDialog, renderExportPdfSavePrompt, renderImportDialog, renderImportProgressDialog, renderNewDocumentDialog, updateImportSubmit } from './render-import';
import { renderAddIntegrationPageDialog, renderAddIntegrationProfileDialog, renderIntegrationActionBuilderDialog, renderIntegrationActionDiscardDialog, renderIntegrationActionResultDialog, renderIntegrationCommandBuilderDialog, renderIntegrationCommandDeleteDialog, renderIntegrationCommandRunDialog, renderIntegrationReadyChecksDialog, renderIntegrationRecordDeleteDialog, renderIntegrationsDialog, renderIntegrationStructuredResultDialog, renderIntegrationVaultResetDialog } from './render-integrations';
import { funnelIcon, gearIcon, renderDocumentTabs, renderModeControls, renderTabStackPopover, renderToolbar } from './render-shell';
import { renderColorThemeDialog } from './render-theme';
import { renderDeleteFileDialog, renderDeleteFolderDialog, renderNewFolderDialog, renderRenameFileDialog, renderSaveAsDialog, renderWorkspaceChatClosePrompt, renderWorkspaceChatDocument, renderWorkspaceFilterDialog, renderWorkspaceTransferDialog } from './render-workspace-dialogs';
import { bindWorkspaceManagerReordering, renderEmptyState, renderNewWorkspaceDialog, renderWorkspaceInitializationDialog, renderWorkspaceManagerDialog, renderWorkspaces, updateNewWorkspaceSubmit, updateWorkspaceFilterSubmit } from './render-workspaces';
import { escapeAttr, escapeHtml } from './shared';
import { UiHandlers } from './types';

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('Missing #app root.');
}

export const appRoot = app;

export type WorkspaceChatScrollState = {
  scrollTop: number;
  stickToLatest: boolean;
} | null;

export let bindController: AbortController | null = null;

export let uiBound = false;

export let renderedRenameFilePath: string | null = null;

export let integrationActionBuilderScrollTop = 0;

export let integrationActionBuilderDialogScrollTop = 0;

export const MIN_PASTED_IMPORT_CHARS = 50;

export const MIN_WORKSPACE_SIDEBAR_WIDTH = 240;

export const MAX_WORKSPACE_SIDEBAR_WIDTH = 560;

export function render(state: AppState, handlers: UiHandlers): HTMLElement {
  ensureAppFrame();
  bindOnce(appRoot, handlers, state);
  renderAllAroundDocument(state);
  return hvyMountRoot();
}

export function renderLeftPanel(state: AppState): void {
  const leftPanel = leftPanelRoot();
  const workspaceScrollTop = leftPanel.querySelector<HTMLElement>('.workspaces-scroll-body')?.scrollTop ?? 0;
  const integrationScrollTop = leftPanel.querySelector<HTMLElement>('.integrations-section')?.scrollTop ?? 0;
  const expandedIntegrationPages = new Set(Array.from(leftPanel.querySelectorAll<HTMLDetailsElement>('.integration-quick-view-launcher[open]')).map((details) => details.dataset.quickViewId ?? ''));
  const expandedIntegrationFilters = new Set(Array.from(leftPanel.querySelectorAll<HTMLDetailsElement>('.integration-profile-filter[open]')).map((details) => details.dataset.quickViewId ?? ''));
  leftPanel.innerHTML = `
    <div class="sidebar-header">
      <div class="brand-lockup">
        <img class="brand-logo" src="${ufoLogoUrl}" alt="" aria-hidden="true" />
        <h1>HVY Galaxy</h1>
      </div>
      <button type="button" class="hvy-galaxy-button icon-button" data-action="create-file" title="New HVY document">+</button>
    </div>
    <div class="sidebar-actions">
      <button class="hvy-galaxy-button" type="button" data-action="open-file">Open File</button>
    </div>
    <section class="integrations-section${state.integrationsSectionExpanded ? '' : ' is-collapsed'}">
      <div class="sidebar-section-heading">
        <h2>
          <button type="button" class="sidebar-section-toggle" data-action="toggle-integrations-section" aria-expanded="${state.integrationsSectionExpanded ? 'true' : 'false'}">
            <span class="sidebar-disclosure sidebar-section-disclosure${state.integrationsSectionExpanded ? ' is-expanded' : ''}" aria-hidden="true"></span>
            <span class="sidebar-section-label">Integrations</span>
          </button>
        </h2>
        <button type="button" class="hvy-galaxy-button icon-button integration-manage-trigger" data-action="integrations" title="Manage integrations" aria-label="Manage integrations">${gearIcon()}</button>
        <button type="button" class="hvy-galaxy-button icon-button integration-new-trigger" data-action="request-add-integration-page" title="Add quick view" aria-label="Add quick view">+</button>
      </div>
      <div class="integrations-section-body" ${state.integrationsSectionExpanded ? '' : 'hidden'}>
        ${renderIntegrationQuickViews(state, expandedIntegrationPages, expandedIntegrationFilters)}
      </div>
    </section>
    <section class="workspaces-section${state.workspacesSectionExpanded ? '' : ' is-collapsed'}">
      <div class="sidebar-section-heading">
        <h2>
          <button type="button" class="sidebar-section-toggle" data-action="toggle-workspaces-section" aria-expanded="${state.workspacesSectionExpanded ? 'true' : 'false'}">
            <span class="sidebar-disclosure sidebar-section-disclosure${state.workspacesSectionExpanded ? ' is-expanded' : ''}" aria-hidden="true"></span>
            <span class="sidebar-section-label">Workspaces</span>
          </button>
        </h2>
        <button type="button" class="hvy-galaxy-button icon-button workspace-manage-trigger" data-action="manage-workspaces" title="Manage workspaces" aria-label="Manage workspaces">${gearIcon()}</button>
        <button type="button" class="hvy-galaxy-button icon-button workspace-new-trigger" data-action="new-workspace" title="New workspace" aria-label="New workspace">+</button>
      </div>
      <div class="workspaces-scroll-body" ${state.workspacesSectionExpanded ? '' : 'hidden'}>
        ${renderWorkspaces(state)}
      </div>
    </section>
    <div class="workspace-sidebar-resizer" role="separator" aria-orientation="vertical" aria-label="Resize workspaces pane"></div>`;
  applyWorkspaceSidebarWidth(appRoot);
  const nextWorkspacesScrollBody = leftPanel.querySelector<HTMLElement>('.workspaces-scroll-body');
  if (nextWorkspacesScrollBody) {
    nextWorkspacesScrollBody.scrollTop = workspaceScrollTop;
  }
  const nextIntegrationsSection = leftPanel.querySelector<HTMLElement>('.integrations-section');
  if (nextIntegrationsSection) {
    nextIntegrationsSection.scrollTop = integrationScrollTop;
  }
}

export function renderIntegrationQuickViews(state: AppState, expandedPages: ReadonlySet<string>, expandedFilters: ReadonlySet<string>): string {
  const profiles = state.integrationRegistry.profiles;
  const pages = state.integrationRegistry.integrations.flatMap((integration) => integration.pages.map((page) => ({ integration, page })));
  if (pages.length === 0) return '<div class="empty-panel">Fetch data and trigger actions on web pages. Configure to begin.</div>';
  return `<div class="integration-quick-views">${pages.map(({ integration, page }) => {
    const quickViewId = `${integration.id}:${page.id}`;
    const visibleIds = new Set(page.visibleProfileIds ?? profiles.map((profile) => profile.id));
    const visibleProfiles = profiles.filter((profile) => visibleIds.has(profile.id));
    const launcher = `<details class="integration-quick-view-launcher" data-quick-view-id="${escapeAttr(quickViewId)}"${expandedPages.has(quickViewId) ? ' open' : ''}>
      <summary><span class="sidebar-disclosure" aria-hidden="true"></span><span class="integration-quick-view-label">${escapeHtml(page.name)}</span></summary>
      <div class="integration-profile-list">
        ${visibleProfiles.length
        ? visibleProfiles.map((profile) => `<button type="button" class="hvy-galaxy-button integration-profile-quick-view" data-action="open-integration-page" data-integration-id="${escapeAttr(integration.id)}" data-page-id="${escapeAttr(page.id)}" data-profile-id="${escapeAttr(profile.id)}">${escapeHtml(profile.name)}</button>`).join('')
        : '<span class="integration-profile-list-empty">No profiles shown</span>'}
      </div>
    </details>`;
    return `
      <div class="integration-quick-view">
        ${launcher}
        <details class="integration-profile-filter" data-quick-view-id="${escapeAttr(quickViewId)}"${expandedFilters.has(quickViewId) ? ' open' : ''}>
          <summary class="hvy-galaxy-button icon-button" title="Choose visible profiles" aria-label="Choose profiles shown for ${escapeAttr(page.name)}">${funnelIcon()}</summary>
          <div class="integration-profile-filter-menu" role="group" aria-label="Profiles shown for ${escapeAttr(page.name)}">
            <strong>Show profiles</strong>
            ${profiles.map((profile) => `<label><input type="checkbox" data-action="set-integration-quick-view-profile" data-integration-id="${escapeAttr(integration.id)}" data-page-id="${escapeAttr(page.id)}" data-profile-id="${escapeAttr(profile.id)}" ${visibleIds.has(profile.id) ? 'checked' : ''}> <span>${escapeHtml(profile.name)}</span></label>`).join('')}
          </div>
        </details>
      </div>`;
  }).join('')}</div>`;
}

export function renderDocumentControls(state: AppState): void {
  const workspaceChatActive = state.document?.virtual === 'workspaceChat';
  const workspaceChatScroll = captureWorkspaceChatScroll();
  documentControlsRoot().innerHTML = `
    ${renderDocumentTabs(state)}
    <header class="document-toolbar">
      ${renderToolbar(state)}
    </header>
    <div class="error-slot${state.error ? ' has-error' : ''}">${state.error ? escapeHtml(state.error) : ''}</div>`;
  documentModeControlsRoot().innerHTML = state.document && !workspaceChatActive ? renderModeControls(state.document.mode, state.document.readOnly, state.document.metaOpen, state.document.hiddenFromAI) : '';
  const mount = hvyMountRoot();
  mount.classList.toggle('hvy-vscode-has-mode-controls', Boolean(state.document && !workspaceChatActive));
  mount.classList.toggle('is-workspace-chat-document', workspaceChatActive);
  if (workspaceChatActive) {
    mount.innerHTML = renderWorkspaceChatDocument(state);
    bindWorkspaceChatScrollControls(mount);
    restoreWorkspaceChatScroll(workspaceChatScroll);
  } else if (!state.document || !state.document.mounted) {
    mount.innerHTML = renderEmptyState(state);
  }
}

export function captureWorkspaceChatScroll(): WorkspaceChatScrollState {
  const scroller = appRoot.querySelector<HTMLDivElement>('[data-workspace-chat-scroll-container="true"]');
  if (!scroller) return null;
  const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  return {
    scrollTop: scroller.scrollTop,
    stickToLatest: distanceFromBottom <= 48,
  };
}

export function restoreWorkspaceChatScroll(captured: WorkspaceChatScrollState): void {
  if (!captured) {
    scrollWorkspaceChatToLatest();
    return;
  }
  const restore = (): void => {
    const scroller = appRoot.querySelector<HTMLDivElement>('[data-workspace-chat-scroll-container="true"]');
    if (!scroller) return;
    if (captured.stickToLatest) {
      scroller.scrollTop = scroller.scrollHeight;
    } else {
      scroller.scrollTop = Math.min(captured.scrollTop, scroller.scrollHeight);
    }
    updateWorkspaceChatScrollButton(scroller);
  };
  restore();
  requestAnimationFrame(() => {
    restore();
    requestAnimationFrame(restore);
  });
}

export function bindWorkspaceChatScrollControls(root: ParentNode): void {
  const scroller = root.querySelector<HTMLDivElement>('[data-workspace-chat-scroll-container="true"]');
  const button = root.querySelector<HTMLButtonElement>('[data-action="workspace-chat-scroll-bottom"]');
  if (!scroller || !button) return;
  scroller.addEventListener('scroll', () => updateWorkspaceChatScrollButton(scroller));
  button.addEventListener('click', () => {
    scroller.scrollTo({
      top: scroller.scrollHeight,
      behavior: 'smooth',
    });
  });
  updateWorkspaceChatScrollButton(scroller);
}

export function scrollWorkspaceChatToLatest(): void {
  const scroller = appRoot.querySelector<HTMLDivElement>('[data-workspace-chat-scroll-container="true"]');
  if (!scroller) return;
  scroller.scrollTop = scroller.scrollHeight;
  updateWorkspaceChatScrollButton(scroller);
  requestAnimationFrame(() => {
    scroller.scrollTop = scroller.scrollHeight;
    updateWorkspaceChatScrollButton(scroller);
  });
}

export function updateWorkspaceChatScrollButton(scroller: HTMLDivElement): void {
  const button = appRoot.querySelector<HTMLButtonElement>('[data-action="workspace-chat-scroll-bottom"]');
  if (!button) return;
  const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  button.hidden = distanceFromBottom <= 32;
}

export function renderModals(state: AppState): void {
  const root = modalRoot();
  const integrationDetailScrollTop = root.querySelector<HTMLElement>('.integration-detail')?.scrollTop ?? 0;
  const integrationListScrollTop = root.querySelector<HTMLElement>('.integration-list')?.scrollTop ?? 0;
  const currentIntegrationActionBuilderContent = root.querySelector<HTMLElement>('.integration-action-builder-content');
  const currentIntegrationActionBuilderDialog = root.querySelector<HTMLElement>('.integration-action-builder-dialog');
  if (currentIntegrationActionBuilderContent && state.integrationActionBuilderStep === 'define') {
    integrationActionBuilderScrollTop = currentIntegrationActionBuilderContent.scrollTop;
  } else if (!state.integrationActionBuilderOpen) {
    integrationActionBuilderScrollTop = 0;
  }
  if (currentIntegrationActionBuilderDialog && state.integrationActionBuilderStep === 'define') {
    integrationActionBuilderDialogScrollTop = currentIntegrationActionBuilderDialog.scrollTop;
  } else if (!state.integrationActionBuilderOpen) {
    integrationActionBuilderDialogScrollTop = 0;
  }
  root.innerHTML = `
    ${renderNewWorkspaceDialog(state)}
    ${renderWorkspaceInitializationDialog(state)}
    ${renderWorkspaceManagerDialog(state)}
    ${renderNewFolderDialog(state)}
    ${renderNewDocumentDialog(state)}
    ${renderImportDialog(state)}
    ${renderImportProgressDialog(state)}
    ${renderSaveAsDialog(state)}
    ${renderExportPdfSavePrompt(state)}
    ${renderExportedPdfDialog(state)}
    ${renderAboutDialog(state)}
    ${renderIntegrationsDialog(state)}
    ${renderAddIntegrationPageDialog(state)}
    ${renderIntegrationReadyChecksDialog(state)}
    ${renderAddIntegrationProfileDialog(state)}
    ${renderIntegrationActionBuilderDialog(state)}
    ${renderIntegrationCommandBuilderDialog(state)}
    ${renderIntegrationCommandRunDialog(state)}
    ${renderIntegrationCommandDeleteDialog(state)}
    ${renderIntegrationActionDiscardDialog(state)}
    ${renderIntegrationRecordDeleteDialog(state)}
    ${renderIntegrationActionResultDialog(state)}
    ${renderIntegrationStructuredResultDialog(state)}
    ${renderIntegrationVaultResetDialog(state)}
    ${renderDebugLogDialog(state)}
    ${renderWorkspaceChatClosePrompt(state)}
    ${renderAppSettingsDialog(state)}
    ${renderAppSettingsDiscardDialog(state)}
    ${renderHomepageErrorDialog(state)}
    ${renderHomepagePickerDialog(state)}
    ${renderScriptingReviewDialog(state)}
    ${renderAiSettingsDialog(state)}
    ${renderAiSettingsDiscardDialog(state)}
    ${renderMcpSettingsDialog(state)}
    ${renderMcpSettingsDiscardDialog(state)}
    ${renderColorThemeDialog(state)}
    ${renderRecoveryDialog(state)}
    ${renderVersionHistoryDialog(state)}
    ${renderTabStackPopover(state)}
    ${renderCloseDocumentDialog(state)}
    ${renderCloseDocumentDraftDialog(state)}
    ${renderWorkspaceFileOperationPrompt(state)}
    ${renderSaveConflictDialog(state)}
    ${renderAppCloseDialog(state)}
    ${renderRenameFileDialog(state)}
    ${renderDeleteFileDialog(state)}
    ${renderDeleteFolderDialog(state)}
    ${renderWorkspaceTransferDialog(state)}
    ${renderWorkspaceFilterDialog(state.workspaceFilter, state.workspaces, state.workspaceFilters, state.aiSettings, state.workspaceEmbeddingPreviews)}`;
  refreshRenderedFormState(appRoot, state);
  const integrationDetail = root.querySelector<HTMLElement>('.integration-detail');
  const integrationList = root.querySelector<HTMLElement>('.integration-list');
  const integrationActionBuilderContent = root.querySelector<HTMLElement>('.integration-action-builder-content');
  const integrationActionBuilderDialog = root.querySelector<HTMLElement>('.integration-action-builder-dialog');
  if (integrationDetail) integrationDetail.scrollTop = integrationDetailScrollTop;
  if (integrationList) integrationList.scrollTop = integrationListScrollTop;
  if (integrationActionBuilderContent) integrationActionBuilderContent.scrollTop = state.integrationActionBuilderStep === 'define' ? integrationActionBuilderScrollTop : 0;
  if (integrationActionBuilderDialog) integrationActionBuilderDialog.scrollTop = state.integrationActionBuilderStep === 'define' ? integrationActionBuilderDialogScrollTop : 0;
  if (state.aiSettingsDialogOpen) {
    requestAnimationFrame(() => syncAiRangeFields(appRoot));
  }
}

export function renderAllAroundDocument(state: AppState): void {
  renderLeftPanel(state);
  renderDocumentControls(state);
  renderModals(state);
}

export function ensureAppFrame(): void {
  if (
    appRoot.querySelector('#leftPanelRoot')
    && appRoot.querySelector('#documentControlsRoot')
    && appRoot.querySelector('#documentModeControlsRoot')
    && appRoot.querySelector('#hvyMount')
    && appRoot.querySelector('[data-app-modal-root="true"]')
  ) {
    return;
  }
  appRoot.innerHTML = `
    <main class="app-shell">
      <aside id="leftPanelRoot" class="workspace-sidebar"></aside>
      <section class="document-shell">
        <div id="documentControlsRoot" class="document-controls-root"></div>
        <div class="document-stage">
          <div id="documentModeControlsRoot"></div>
          <div id="hvyMount" class="document-host"></div>
        </div>
      </section>
    <div id="modalRoot" data-app-modal-root="true"></div>
    </main>`;
  applyWorkspaceSidebarWidth(appRoot);
}

export function leftPanelRoot(): HTMLElement {
  return appRoot.querySelector<HTMLElement>('#leftPanelRoot')!;
}

export function documentControlsRoot(): HTMLElement {
  return appRoot.querySelector<HTMLElement>('#documentControlsRoot')!;
}

export function documentModeControlsRoot(): HTMLElement {
  return appRoot.querySelector<HTMLElement>('#documentModeControlsRoot')!;
}

export function hvyMountRoot(): HTMLElement {
  return appRoot.querySelector<HTMLElement>('#hvyMount')!;
}

export function modalRoot(): HTMLElement {
  return appRoot.querySelector<HTMLElement>('[data-app-modal-root="true"]')!;
}

export function bindOnce(root: HTMLElement, handlers: UiHandlers, state: AppState): void {
  if (uiBound) return;
  uiBound = true;
  bind(root, handlers, state);
}

export function bind(root: HTMLElement, handlers: UiHandlers, state: AppState): void {
  bindController?.abort();
  bindController = new AbortController();
  const { signal } = bindController;
  bindWorkspaceSidebarResize(root, signal);
  bindWorkspaceManagerReordering(root, handlers, signal);
  document.addEventListener('keydown', (event) => {
    handleApplicationShortcut(event, root, handlers);
  }, { signal, capture: true });
  document.addEventListener('keyup', (event) => {
    if (!state.tabStackOpen) return;
    if (event.key === 'Meta' || event.key === 'Control') {
      event.preventDefault();
      handlers.commitTabStack();
    }
  }, { signal, capture: true });
  window.addEventListener('resize', () => syncAiRangeFields(root), { signal });
  bindClickEvents(root, handlers, state, signal);
  bindControlEvents(root, handlers, state, signal);
  bindWorkspaceEvents(root, handlers, state, signal);
  bindFormEvents(root, handlers, state, signal);
  bindEscapeEvents(root, handlers, state, signal);
}

export function refreshRenderedFormState(root: HTMLElement, state: AppState): void {
  root.querySelectorAll<HTMLFormElement>('form[data-form="new-workspace"]').forEach((form) => {
    updateNewWorkspaceSubmit(form);
  });
  root.querySelectorAll<HTMLFormElement>('form[data-form="workspace-filter"]').forEach((form) => {
    updateWorkspaceFilterSubmit(form);
  });
  root.querySelectorAll<HTMLFormElement>('form[data-form="import-document"], form[data-form="import-current"]').forEach((form) => {
    updateImportSubmit(form);
  });
  if (state.renameFilePath && state.renameFilePath !== renderedRenameFilePath) {
    root.querySelector<HTMLInputElement>('form[data-form="rename-file"] input[name="fileName"]')?.focus();
  }
  renderedRenameFilePath = state.renameFilePath;
}

export function dismissBackdropFromTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  return target.classList.contains('modal-backdrop') || target.classList.contains('workspace-filter-backdrop')
    ? target
    : null;
}

export function formatBackupTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}
