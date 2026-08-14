import { convertWorkspaceDocumentKind, listSavedTemplates, loadWorkspace as loadWorkspaceBackend, moveDocumentToWorkspace, readDocumentFile, reauthorizeWorkspace, saveDocumentToWorkspace, updateFileMenuState, updateMcpWorkspaces, type AddFilesResult, type DocumentCreationType, type DocumentExtension, type DocumentFile, type DroppedWorkspaceFile, type Workspace } from './backend';
import { state, workspacePathForFileInWorkspaces, type AppState } from './state';
import { getFileActionAvailability } from './fileActions';
import { deserializeHvy, getMountedDocument, mountHvyDocument, serializeHvy, serializeMountedDocumentAsync, type HvyMode, type MountedDocument, type VisualDocument } from './hvy';
import { getTemplateById, mergeSavedTemplates, templatesForDocumentType, workspaceTemplateVisibility } from './templates';
import { applyTemplateTitle, defaultHvyDocument, documentFileName, documentTypeForExtension, hasDocumentExtension, normalizeAiMaxContextChars, normalizeImageAttachmentMaxDimensions, updateHomepageDocumentPath } from './mainUtilities';
import { displayDocumentName } from './mainWorkspaceFilter';
import { adoptSavedAsDocument, backupDocumentKey, clearRecoveryDraftsForDocument, documentSessions, moveBackupTracking, openDocument, pendingMountDocument, readDocumentColorPreference, refreshRecents, renameDocumentTabPath, rerender, runBusy, updateCurrentDocumentSession } from './main';
import { recordSuccessfulDocumentSave } from './documentHistory';
import { logDebugEvent } from './debugLog';

let lastFileMenuStateKey: string | null = null;

export async function createBlankDocument(): Promise<void> {
  await runBusy('Creating blank document...', async () => {
    const bytes = Array.from(new TextEncoder().encode(defaultHvyDocument()));
    await openDocument({
      path: '',
      name: 'Untitled.hvy',
      extension: '.hvy',
      bytes,
    }, { isNew: true, deferMount: true });
  });
}

export async function refreshOpenWorkspaceForFile(filePath: string): Promise<void> {
  const workspace = state.workspaces.find((candidate) => filePath.startsWith(candidate.path));
  if (!workspace) return;
  upsertWorkspace(await loadWorkspace(workspace.path));
}

export function currentDocumentCanSaveToWorkspace(): boolean {
  return getFileActionAvailability(state).saveToWorkspace;
}

export function openWorkspaceTransfer(
  mode: NonNullable<typeof state.workspaceTransfer>['mode'],
  fileName: string,
  sourcePath: string | null,
  excludedWorkspacePath: string | null,
  targetDirectory = '',
): void {
  const availableWorkspaces = state.workspaces.filter((workspace) => workspace.path !== excludedWorkspacePath);
  if (availableWorkspaces.length === 0) return;
  state.workspaceTransfer = {
    mode,
    sourcePath,
    fileName,
    nameDraft: displayDocumentName(fileName),
    excludedWorkspacePath,
    targetDirectory,
  };
  state.status = 'Ready';
  rerender({ preserveMountedDocument: true });
}

export function workspaceTransferBusyLabel(mode: NonNullable<typeof state.workspaceTransfer>['mode']): string {
  if (mode === 'saveCurrent') return 'Saving to workspace';
  if (mode === 'copyFile') return 'Copying file';
  return 'Moving file';
}

export async function saveCurrentDocumentToWorkspace(workspacePath: string, name: string, targetDirectory = ''): Promise<void> {
  if (!state.document?.mounted) return;
  const mounted = state.document.mounted;
  const document = getMountedDocument(mounted);
  const previousPath = state.document.path;
  const previousName = state.document.name;
  const previousMode = state.document.mode;
  const previousUseDocumentColors = readDocumentColorPreference(previousPath);
  const bytes = await serializeMountedDocumentAsync(mounted);
  const file = await saveDocumentToWorkspace({
    workspacePath,
    name: documentFileName(name, documentTypeForExtension(state.document.extension)) ?? name,
    targetDirectory,
    bytes,
  });
  adoptSavedAsDocument(file, mounted, document, previousMode, previousPath, previousUseDocumentColors);
  recordSuccessfulDocumentSave(file.path, file.name, document);
  state.selectedFilePath = file.path;
  state.selectedWorkspacePath = workspacePath;
  upsertWorkspace(await loadWorkspace(workspacePath));
  await refreshRecents();
  await clearRecoveryDraftsForDocument(previousPath, previousName);
  await clearRecoveryDraftsForDocument(file.path, file.name);
  state.status = `Saved to ${file.name}`;
  rerender({ preserveMountedDocument: true });
}

export async function saveImportedDocumentToWorkspace(
  workspacePath: string,
  fileName: string,
  document: VisualDocument,
  targetDirectory = '',
): Promise<void> {
  const bytes = Array.from(await serializeHvy(document));
  const file = await saveDocumentToWorkspace({
    workspacePath,
    name: fileName,
    targetDirectory,
    bytes,
  });
  documentSessions.delete(file.path);
  upsertWorkspace(await loadWorkspace(workspacePath));
  await openDocument({ ...file, bytes }, { deferMount: true });
  await refreshRecents();
  await clearRecoveryDraftsForDocument(file.path, file.name);
  state.status = `Saved to ${file.name}`;
}

export async function createTemporaryImportMount(
  sourceDocument: VisualDocument,
  mode: HvyMode,
  extension: DocumentExtension,
): Promise<{ mounted: MountedDocument; cleanup: () => void }> {
  const bytes = await serializeHvy(sourceDocument);
  const document = await deserializeHvy(bytes, sourceDocument.extension);
  document.extension = extension;
  const root = globalThis.document.createElement('div');
  root.hidden = true;
  globalThis.document.body.append(root);
  const mounted = await mountHvyDocument(root, document, mode, {
    maxContextChars: normalizeAiMaxContextChars(state.aiSettings.maxContextChars),
    imageAttachmentMaxDimensions: normalizeImageAttachmentMaxDimensions(state.appSettings.imageAttachmentMaxDimensions),
  });
  return {
    mounted,
    cleanup() {
      mounted.mount.destroy();
      root.remove();
    },
  };
}

export async function moveOpenWorkspaceFileToWorkspace(path: string, workspacePath: string, targetDirectory = ''): Promise<void> {
  const sourceWorkspacePath = workspacePathForFile(path);
  const file = await moveDocumentToWorkspace({ path, workspacePath, targetDirectory });
  await updateHomepageDocumentPath(path, file.path);
  await applyWorkspaceFileRelocation(path, workspacePath, file, sourceWorkspacePath);
  state.status = `Moved to ${file.name}`;
}

export async function convertOpenWorkspaceFileKind(path: string, workspacePath: string, toTemplate: boolean): Promise<void> {
  const file = await convertWorkspaceDocumentKind({ path, workspacePath, toTemplate });
  await updateHomepageDocumentPath(path, file.path);
  state.workspaceFileViews[workspacePath] = toTemplate ? 'templates' : 'documents';
  await applyWorkspaceFileRelocation(path, workspacePath, file, workspacePath);
  await refreshSavedTemplates(workspacePath);
  state.status = `${toTemplate ? 'Converted to template' : 'Converted to document'}: ${file.name}`;
}

async function applyWorkspaceFileRelocation(
  path: string,
  workspacePath: string,
  file: DocumentFile,
  sourceWorkspacePath: string | null,
): Promise<void> {
  const currentDocument = state.document?.path === path ? state.document : null;
  const mountedDocument = currentDocument?.mounted?.document ?? pendingMountDocument;
  const oldBackupKey = currentDocument ? backupDocumentKey(currentDocument.path, currentDocument.name) : null;
  documentSessions.delete(path);
  renameDocumentTabPath(path, file.path);
  if (state.selectedFilePath === path) {
    state.selectedFilePath = file.path;
  }
  state.selectedWorkspacePath = workspacePath;
  if (currentDocument) {
    currentDocument.path = file.path;
    currentDocument.name = file.name;
    currentDocument.extension = file.extension;
    if (mountedDocument) {
      updateCurrentDocumentSession(mountedDocument);
    }
    if (oldBackupKey) {
      moveBackupTracking(oldBackupKey, backupDocumentKey(file.path, file.name));
    }
  }
  if (sourceWorkspacePath) {
    upsertWorkspace(await loadWorkspace(sourceWorkspacePath));
  }
  upsertWorkspace(await loadWorkspace(workspacePath));
  await refreshRecents();
}

export async function finishAddingFilesToWorkspace(result: AddFilesResult, status: string): Promise<void> {
  upsertWorkspace(result.workspace);
  state.selectedWorkspacePath = result.workspace.path;
  state.status = status;
  if (result.copiedTemplatePaths?.length) {
    await refreshSavedTemplates(result.workspace.path);
  }
  if (result.copiedPaths.length !== 1) return;
  const file = await readDocumentFile(result.copiedPaths[0]);
  await openDocument(file, { deferMount: true });
}

export async function droppedWorkspaceFilesFrom(files: File[]): Promise<DroppedWorkspaceFile[]> {
  const droppedFiles: DroppedWorkspaceFile[] = [];
  for (const file of files) {
    droppedFiles.push({
      name: file.name,
      bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
    });
  }
  return droppedFiles;
}

export function workspacePathForFile(filePath: string): string | null {
  return workspacePathForFileInWorkspaces(state.workspaces, filePath);
}

export function loadWorkspace(path: string): Promise<Workspace> {
  return loadWorkspaceBackend(path, { includeTemplates: state.workspaceFileViews[path] === 'templates' });
}

export function showWorkspaceDocumentsView(workspacePath: string): void {
  state.workspaceFileViews[workspacePath] = 'documents';
}

export async function refreshSavedTemplates(workspacePath?: string | null): Promise<void> {
  state.savedTemplates = await listSavedTemplates(workspacePath ?? workspacePathForFile(state.document?.path ?? '') ?? state.selectedWorkspacePath);
}

export function templatesForCurrentWorkspaceDocumentType(workspacePath: string | null | undefined, documentType: DocumentCreationType) {
  const workspace = state.workspaces.find((candidate) => candidate.path === workspacePath) ?? null;
  return templatesForDocumentType(mergeSavedTemplates(state.savedTemplates), documentType, workspaceTemplateVisibility(workspace));
}

export function creationTemplate(
  workspacePath: string | null | undefined,
  documentType: DocumentCreationType,
  templateId: string,
  title: string,
): string {
  if (documentType === 'hvy' && !hasDocumentExtension(templateId)) {
    return defaultHvyDocument(title);
  }
  const template = getTemplateById(templatesForCurrentWorkspaceDocumentType(workspacePath, documentType), templateId);
  return applyTemplateTitle(template.content, title);
}

export function upsertWorkspace(workspace: Awaited<ReturnType<typeof loadWorkspace>>): void {
  const index = state.workspaces.findIndex((candidate) => candidate.path === workspace.path);
  if (index >= 0) {
    state.workspaces[index] = workspace;
  } else {
    state.workspaces.push(workspace);
  }
  sortWorkspaces();
  const entryIndex = state.workspaceEntries.findIndex((candidate) => candidate.path === workspace.path);
  const entry = { path: workspace.path, displayName: workspace.manifest.name, status: 'ready' as const, error: null };
  if (entryIndex >= 0) state.workspaceEntries[entryIndex] = entry;
  else state.workspaceEntries.push(entry);
  syncMcpWorkspaces();
}

export function workspaceDisplayNameFromPath(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '');
  return normalized.split(/[\\/]/).pop() || path;
}

export async function loadWorkspaceEntry(path: string): Promise<void> {
  await loadWorkspaceEntryUsing(path, () => loadWorkspace(path), 'direct');
}

export async function retryWorkspaceEntry(path: string): Promise<void> {
  const entry = state.workspaceEntries.find((candidate) => candidate.path === path);
  const permissionDenied = entry?.status === 'error' && /operation not permitted(?: \(os error 1\))?/i.test(entry.error ?? '');
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);
  await loadWorkspaceEntryUsing(
    path,
    permissionDenied && isMac ? () => reauthorizeWorkspace(path) : () => loadWorkspace(path),
    permissionDenied && isMac ? 'macOSPermissionPicker' : 'direct',
  );
}

async function loadWorkspaceEntryUsing(
  path: string,
  loader: () => Promise<Workspace | null>,
  source: 'direct' | 'macOSPermissionPicker',
): Promise<void> {
  const startedAt = performance.now();
  const existing = state.workspaceEntries.find((entry) => entry.path === path);
  const loading = {
    path,
    displayName: existing?.displayName ?? workspaceDisplayNameFromPath(path),
    status: 'loading' as const,
    error: null,
  };
  const index = state.workspaceEntries.findIndex((entry) => entry.path === path);
  if (index >= 0) state.workspaceEntries[index] = loading;
  else state.workspaceEntries.push(loading);
  logDebugEvent('load', 'workspace:loadStart', {
    path,
    displayName: loading.displayName,
    previousStatus: existing?.status ?? null,
    source,
    runtime: typeof window !== 'undefined' && window.hvyElectron
      ? 'electron'
      : typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
        ? 'tauri'
        : 'browser',
  });
  rerender({ preserveMountedDocument: true });
  try {
    const workspace = await loader();
    if (!workspace) {
      if (existing) {
        const cancelledIndex = state.workspaceEntries.findIndex((entry) => entry.path === path);
        if (cancelledIndex >= 0) state.workspaceEntries[cancelledIndex] = existing;
      }
      logDebugEvent('load', 'workspace:loadCancelled', { path, source });
      rerender({ preserveMountedDocument: true });
      return;
    }
    upsertWorkspace(workspace);
    logDebugEvent('load', 'workspace:loadComplete', {
      path,
      manifestName: workspace.manifest.name,
      rootNodeCount: workspace.files.length,
      source,
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    });
  } catch (error) {
    state.workspaces = state.workspaces.filter((workspace) => workspace.path !== path);
    const failedIndex = state.workspaceEntries.findIndex((entry) => entry.path === path);
    const failed = {
      ...loading,
      status: 'error' as const,
      error: error instanceof Error ? error.message : String(error),
    };
    if (failedIndex >= 0) state.workspaceEntries[failedIndex] = failed;
    else state.workspaceEntries.push(failed);
    logDebugEvent('load', 'workspace:loadError', {
      path,
      displayName: failed.displayName,
      source,
      errorMessage: failed.error,
      errorType: error instanceof Error ? error.name : typeof error,
      errorStack: error instanceof Error ? error.stack ?? null : null,
      errorCause: error instanceof Error && error.cause !== undefined ? String(error.cause) : null,
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    });
    syncMcpWorkspaces();
  }
  rerender({ preserveMountedDocument: true });
}

export function sortWorkspaces(): void {
  state.workspaces.sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
}

export function reorderedWorkspaceEntries(
  entries: AppState['workspaceEntries'],
  draggedPath: string,
  targetPath: string,
  before: boolean,
): AppState['workspaceEntries'] {
  const reordered = [...entries];
  const draggedIndex = reordered.findIndex((entry) => entry.path === draggedPath);
  if (draggedIndex < 0 || !reordered.some((entry) => entry.path === targetPath) || draggedPath === targetPath) return entries;
  const [dragged] = reordered.splice(draggedIndex, 1);
  const targetIndex = reordered.findIndex((entry) => entry.path === targetPath);
  reordered.splice(before ? targetIndex : targetIndex + 1, 0, dragged);
  return reordered;
}

export function syncMcpWorkspaces(): void {
  void updateMcpWorkspaces(state.workspaces.map((workspace) => workspace.path));
}

export function syncFileMenuState(options: { force?: boolean } = {}): void {
  const fileMenuState = getFileActionAvailability(state);
  const key = JSON.stringify(fileMenuState);
  if (!options.force && key === lastFileMenuStateKey) return;
  lastFileMenuStateKey = key;
  void updateFileMenuState(fileMenuState).catch(() => {
    // Native menu state is unavailable in browser-only smoke runs.
  });
}

export function hasOpenWorkspaceNamed(name: string, exceptPath: string | null = null): boolean {
  const normalized = name.trim().toLowerCase();
  return state.workspaces.some((workspace) => workspace.path !== exceptPath && workspace.manifest.name.trim().toLowerCase() === normalized);
}
