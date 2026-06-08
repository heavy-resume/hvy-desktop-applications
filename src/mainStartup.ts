import { installAiChatClient } from './aiClient';
import { loadAiSettings, loadArchivedWorkspaces, loadDefaultGuide, loadHvyGuide, loadLaunchDocumentPaths, loadMcpClientInstallStatus, loadMcpServerStatus, loadMcpSettings, loadMcpStdioLaunchConfig, loadRecentState, onAppCloseRequest, onMenuEvent, onOpenDocumentPath, readDocumentFile, startMcpServer, type DocumentFile } from './backend';
import { applyColorTheme, clearColorTheme, isCssVariableName, loadColorThemeSettings } from './colorTheme';
import { measureDebug } from './debugLog';
import { deserializeHvy, redoMountedDocument, undoMountedDocument } from './hvy';
import { state } from './state';
import { handlers, cssEscape, defaultDocumentMode, documentSessions, fileNameFromPath, hasOpenedDocumentTabs, handleAppCloseRequest, loadWorkspace, loadZoomSettings, applyZoomSettings, markDocumentTabOpened, mountRoot, openDocument, openLaunchDocumentPath, openRecoveryDialog, openRecoveryDialogOnBoot, preserveCurrentDocumentSession, readDocumentColorPreference, readHotReloadSessionSnapshot, refreshSavedTemplates, renderAllAroundDocument, rerender, restoreMountScrollRatio, runBusy, selectDocumentTab, setMountRoot, setupErrorSurface, showStartupError, syncDocumentTabs, syncFileMenuState, syncMcpWorkspaces, upsertWorkspace, workspaceFileAiAccess, writeHotReloadSessionSnapshot, type DocumentSession, type HotReloadDocumentSnapshot } from './main';
import { setupRecoveryLifecycle, startBackupTimer } from './mainDocumentSave';
import { render } from './ui';

let findShortcutBound = false;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    preserveCurrentDocumentSession();
    writeHotReloadSessionSnapshot();
  });
}

export async function boot(): Promise<void> {
  setupErrorSurface();
  try {
    loadZoomSettings();
    setMountRoot(render(state, handlers));
    applyZoomSettings();
    bindFindShortcut();
    await refreshRecents();
    await refreshArchivedWorkspaces();
    state.aiSettings = await loadAiSettings();
    state.mcpSettings = await loadMcpSettings();
    state.mcpServerStatus = await loadMcpServerStatus();
    state.mcpStdioLaunchConfig = await loadMcpStdioLaunchConfig();
    state.mcpClientInstallStatus = await loadMcpClientInstallStatus();
    if (state.mcpSettings.startAutomatically && !state.mcpServerStatus.running) {
      state.mcpServerStatus = await startMcpServer();
    }
    state.colorTheme = loadColorThemeSettings();
    applyAppColorTheme();
    installAiChatClient(state.aiSettings);
    await onAppCloseRequest(() => {
      void handleAppCloseRequest();
    });
    await onMenuEvent((event) => {
      if (event === 'new-workspace') handlers.newWorkspace();
      if (event === 'manage-workspaces') handlers.openWorkspaceManager();
      if (event === 'open-workspace') handlers.openWorkspace();
      if (event === 'open-file') handlers.openFile();
      if (event === 'find') openMountedSearch();
      if (event === 'bold') performRichTextAction('bold');
      if (event === 'italic') performRichTextAction('italic');
      if (event === 'underline') performRichTextAction('underline');
      if (event === 'strikethrough') performRichTextAction('strikethrough');
      if (event === 'undo') performUndo();
      if (event === 'redo') performRedo();
      if (event === 'open-guide') void openGuide();
      if (event === 'open-hvy-guide') void openHvyGuide();
      if (event === 'about') handlers.openAbout();
      if (event === 'debug-log') handlers.openDebugLog();
      if (event === 'ai-settings') handlers.openAiSettings();
      if (event === 'mcp-settings') handlers.openMcpSettings();
      if (event === 'colors') handlers.openColorTheme();
      if (event === 'zoom-app-in') handlers.zoomAppIn();
      if (event === 'zoom-app-out') handlers.zoomAppOut();
      if (event === 'zoom-app-reset') handlers.resetAppZoom();
      if (event === 'zoom-document-in') handlers.zoomDocumentIn();
      if (event === 'zoom-document-out') handlers.zoomDocumentOut();
      if (event === 'zoom-document-reset') handlers.resetDocumentZoom();
      if (event === 'recover-backup') void openRecoveryDialog();
      if (event === 'app-close-requested') void handleAppCloseRequest();
      if (event === 'close-document') handlers.closeDocument();
      if (event === 'save') handlers.save();
      if (event === 'save-as') handlers.saveAs();
      if (event === 'save-to-workspace') handlers.saveCurrentToWorkspace();
      if (event === 'import-current') handlers.openImportIntoCurrent();
      if (event === 'export-pdf') handlers.exportPdf();
      if (event.startsWith('recent-workspace:')) handlers.openRecentWorkspace(event.slice('recent-workspace:'.length));
      if (event.startsWith('recent-file:')) handlers.openRecentFile(event.slice('recent-file:'.length));
    });
    await onOpenDocumentPath((path) => {
      void openLaunchDocumentPath(path);
    });
    const launchDocumentPaths = await loadLaunchDocumentPaths();
    for (const path of launchDocumentPaths) {
      await openLaunchDocumentPath(path);
    }
    if (state.document) {
      void loadStartupWorkspacesInBackground();
    } else {
      await loadRecentWorkspaces();
      await refreshSavedTemplates(state.selectedWorkspacePath);
      setMountRoot(render(state, handlers));
      applyZoomSettings();
    }
    syncFileMenuState({ force: true });
    await openRecoveryDialogOnBoot();
    startBackupTimer();
    setupRecoveryLifecycle();
    if (!state.document) {
      await restoreStartupDocument();
    }
    await openDefaultGuide();
  } catch (error) {
    showStartupError(error);
  }
}

export function bindFindShortcut(): void {
  if (findShortcutBound) return;
  findShortcutBound = true;
  window.addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'f') return;
    if (!openMountedSearch()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true });
}

export function openMountedSearch(): boolean {
  const root = currentMountRoot();
  if (!state.document || !root) return false;
  const rawSearchBar = root.querySelector<HTMLElement>('.raw-hvy-search-bar');
  if (rawSearchBar) {
    rawSearchBar.closest<HTMLElement>('.raw-hvy-shell')?.dispatchEvent(new CustomEvent('hvy:open-raw-search'));
    const rawInput = root.querySelector<HTMLInputElement>('[data-field="raw-hvy-search-query"]');
    if (rawInput) {
      rawInput.focus();
      rawInput.setSelectionRange(0, rawInput.value.length);
      return true;
    }
  }
  const input = Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-field="search-query"], [data-field="raw-hvy-search-query"]'))
    .find((candidate) => !candidate.closest('[hidden]'));
  if (input) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    return true;
  }
  const launcher = root.querySelector<HTMLButtonElement>('[data-action="open-search"]');
  if (!launcher) return false;
  launcher.click();
  return true;
}

export function performRichTextAction(action: 'bold' | 'italic' | 'underline' | 'strikethrough'): void {
  const root = currentMountRoot();
  const rawShell = root?.querySelector<HTMLElement>('.raw-hvy-shell');
  if (rawShell) {
    rawShell.dispatchEvent(new CustomEvent(`hvy:toggle-raw-${action}`));
    return;
  }
  const editable = getActiveRichEditable();
  if (!editable || !root) return;
  const sectionKey = editable.dataset.sectionKey ?? '';
  const blockId = editable.dataset.blockId ?? '';
  const field = editable.dataset.field ?? '';
  const selector = [
    `[data-rich-action="${action}"]`,
    sectionKey ? `[data-section-key="${cssEscape(sectionKey)}"]` : '',
    blockId ? `[data-block-id="${cssEscape(blockId)}"]` : '',
    field ? `[data-field="${cssEscape(field)}"]` : '',
  ].join('');
  const button =
    root.querySelector<HTMLButtonElement>(selector) ??
    editable.closest<HTMLElement>('.editor-block, .table-inline-edit-shell')?.querySelector<HTMLButtonElement>(`[data-rich-action="${action}"]`);
  button?.click();
}

export function currentMountRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#hvyMount') ?? mountRoot;
}

export function getActiveRichEditable(): HTMLElement | null {
  const target = document.activeElement;
  if (!(target instanceof HTMLElement) || !target.closest('#hvyMount')) return null;
  if (target.isContentEditable && target.dataset.field) return target;
  return target.closest<HTMLElement>('[contenteditable="true"][data-field]');
}

export function performUndo(): void {
  if (measureDebug('perf', 'undo:routeNativeEditCommand', undefined, () => routeNativeEditCommand('undo'))) return;
  const mounted = state.document?.mounted;
  if (!mounted) return;
  measureDebug('perf', 'undo:mountedDocument', { path: state.document?.path }, () => undoMountedDocument(mounted));
}

export function performRedo(): void {
  if (measureDebug('perf', 'redo:routeNativeEditCommand', undefined, () => routeNativeEditCommand('redo'))) return;
  const mounted = state.document?.mounted;
  if (!mounted) return;
  measureDebug('perf', 'redo:mountedDocument', { path: state.document?.path }, () => redoMountedDocument(mounted));
}

export function routeNativeEditCommand(command: 'undo' | 'redo'): boolean {
  const target = document.activeElement;
  if (!(target instanceof HTMLElement)) return false;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)) return false;
  if (target.closest('#hvyMount') && target.isContentEditable && !document.queryCommandEnabled(command)) return false;
  document.execCommand(command);
  return true;
}

export function applyAppColorTheme(root: HTMLElement | null = mountRoot): void {
  applyColorTheme(state.colorTheme);
  if (!root) return;
  applyMountedDocumentColorTheme(root);
}

function applyMountedDocumentColorTheme(root: HTMLElement): void {
  clearColorTheme(root);
  if (!readDocumentColorPreference(state.document?.path ?? '')) return;
  const theme = state.document?.mounted?.document.meta.theme;
  if (!theme || typeof theme !== 'object' || Array.isArray(theme)) return;
  const colors = (theme as { colors?: unknown }).colors;
  if (!colors || typeof colors !== 'object' || Array.isArray(colors)) return;
  for (const [name, value] of Object.entries(colors)) {
    if (isCssVariableName(name) && typeof value === 'string' && value.trim()) {
      root.style.setProperty(name, value.trim());
    }
  }
}

export async function refreshRecents(): Promise<void> {
  state.recent = await loadRecentState();
}

export async function refreshArchivedWorkspaces(): Promise<void> {
  state.archivedWorkspaces = await loadArchivedWorkspaces();
}

export async function refreshMcpClientInstallStatus(): Promise<void> {
  try {
    state.mcpClientInstallStatus = await loadMcpClientInstallStatus();
    rerender({ preserveMountedDocument: true });
  } catch {
    // The modal still shows the manual config if client detection is unavailable.
  }
}

export async function loadRecentWorkspaces(): Promise<void> {
  for (const path of state.recent.workspaces) {
    try {
      upsertWorkspace(await loadWorkspace(path));
    } catch {
      // Recents are pruned by the backend when they are opened or reloaded.
    }
  }
  state.selectedWorkspacePath = state.workspaces[0]?.path ?? null;
  syncMcpWorkspaces();
}

export async function loadStartupWorkspacesInBackground(): Promise<void> {
  try {
    await loadRecentWorkspaces();
    await refreshSavedTemplates(state.selectedWorkspacePath);
    renderAllAroundDocument();
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    renderAllAroundDocument();
  }
}

export async function openDefaultGuide(options: { force?: boolean } = {}): Promise<void> {
  if (!options.force && (state.document || state.documentTabs.length > 0 || state.selectedFilePath)) return;
  try {
    await openDocument(await loadDefaultGuide(), { defaultDocument: true, defaultDocumentLabel: 'HVY Galaxy guide' });
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = 'Could not load HVY Galaxy guide';
    setMountRoot(render(state, handlers));
  }
}

export async function restoreStartupDocument(): Promise<void> {
  if (documentSessions.size > 0 || hasOpenedDocumentTabs() || state.documentTabs.length > 0) {
    syncDocumentTabs();
    const restoredTab = state.documentTabs.find((tab) => tab.dirty && !tab.readOnly) ?? state.documentTabs.find((tab) => !tab.readOnly);
    if (restoredTab) {
      await selectDocumentTab(restoredTab.path);
      return;
    }
  }
  const restoredFromSnapshot = await restoreHotReloadSession();
  if (restoredFromSnapshot || state.document) return;
  for (const path of state.recent.files) {
    try {
      await openDocument(await readDocumentFile(path));
      state.status = `Restored ${fileNameFromPath(path)}`;
      await refreshRecents();
      return;
    } catch {
      // Recents are pruned by the backend when opened from the menu; boot restore just skips stale entries.
    }
  }
}

export async function restoreHotReloadSession(): Promise<boolean> {
  const snapshot = readHotReloadSessionSnapshot();
  if (!snapshot || snapshot.tabPaths.length === 0) return false;
  let fallbackActivePath: string | null = null;
  for (const path of [...snapshot.tabPaths].reverse()) {
    if (path === snapshot.activePath) continue;
    const file = await readSnapshotDocumentFile(path);
    if (!file) continue;
    const stored = snapshot.documents.find((candidate) => candidate.path === path);
    documentSessions.set(path, await createSessionFromHotReloadSnapshot(file, stored));
    markDocumentTabOpened(path);
    fallbackActivePath = path;
  }
  const activePath = snapshot.activePath ?? fallbackActivePath;
  const activeFile = activePath ? await readSnapshotDocumentFile(activePath) : null;
  if (activeFile && activePath) {
    const stored = snapshot.documents.find((candidate) => candidate.path === activePath);
    documentSessions.set(activePath, await createSessionFromHotReloadSnapshot(activeFile, stored));
    await openDocument(activeFile);
    restoreMountScrollRatio(mountRoot, stored?.scrollRatio ?? null);
    state.status = `Restored ${activeFile.name}`;
    await refreshRecents();
    return true;
  }
  if (fallbackActivePath) {
    await openDocument(await readDocumentFile(fallbackActivePath));
    return true;
  }
  return false;
}

export async function readSnapshotDocumentFile(path: string): Promise<DocumentFile | null> {
  try {
    return await readDocumentFile(path);
  } catch {
    return null;
  }
}

export async function createSessionFromHotReloadSnapshot(file: DocumentFile, stored: HotReloadDocumentSnapshot | undefined): Promise<DocumentSession> {
  const workspaceAccess = workspaceFileAiAccess(file.path);
  return {
    path: file.path,
    name: file.name,
    extension: file.extension,
    mode: stored?.mode ?? defaultDocumentMode(file.extension, { hiddenFromAI: file.hiddenFromAI || workspaceAccess.hiddenFromAI }),
    dirty: false,
    readOnly: file.locked === true || workspaceAccess.readOnly,
    hiddenFromAI: file.hiddenFromAI === true || workspaceAccess.hiddenFromAI,
    isNew: false,
    metaOpen: stored?.metaOpen ?? false,
    document: await deserializeHvy(new Uint8Array(file.bytes), file.extension),
    scrollRatio: stored?.scrollRatio ?? null,
    recoveryState: stored?.recoveryState ?? null,
    recoveryBackupId: null,
  };
}

export async function openGuide(): Promise<void> {
  await runBusy('Opening HVY Galaxy guide...', async () => {
    await openDefaultGuide({ force: true });
  });
}

export async function openHvyGuide(): Promise<void> {
  await runBusy('Opening HVY guide...', async () => {
    await openDocument(await loadHvyGuide(), { defaultDocument: true, defaultDocumentLabel: 'HVY guide' });
  });
}
