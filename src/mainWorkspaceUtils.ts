import { convertWorkspaceDocumentKind, copyDocumentToWorkspace, createEncryptedFolderDocument, deleteDocumentFile, deleteEncryptedFolderDocument, listSavedTemplates, loadWorkspace as loadWorkspaceBackend, moveDocumentToWorkspace, readDocumentFile, reauthorizeWorkspace, saveDocumentToWorkspace, updateFileMenuState, updateMcpWorkspaces, type AddFilesResult, type DocumentCreationType, type DocumentExtension, type DocumentFile, type DroppedWorkspaceFile, type Workspace, type WorkspaceFileRelocation } from './backend';
import { relocateDocumentHistory } from './documentHistory';
import { findFileInWorkspace, state, workspacePathForFileInWorkspaces, type AppState } from './state';
import { documentEncryptionKeyring } from './documentKeys';
import { findEncryptedFolder, prepareEncryptedFolderEntryRemoval, prepareEncryptedFolderImportedDocumentMutation, workspaceHasLogicalName } from './encryptedFolders';
import { getFileActionAvailability } from './fileActions';
import { deserializeHvy, getMountedDocument, mountHvyDocument, serializeHvy, serializeMountedDocumentAsync, type HvyMode, type MountedDocument, type VisualDocument } from './hvy';
import { getTemplateById, mergeSavedTemplates, templatesForDocumentType, workspaceTemplateVisibility } from './templates';
import { applyTemplateTitle, defaultHvyDocument, documentFileName, documentTypeForExtension, hasDocumentExtension, normalizeAiMaxContextChars, normalizeImageAttachmentMaxDimensions, updateHomepageDocumentPath } from './mainUtilities';
import { displayDocumentName } from './mainWorkspaceFilter';
import { adoptSavedAsDocument, clearRecoveryDraftsForDocument, documentSessions, fileNameFromPath, openDocument, pendingMountDocument, readDocumentColorPreference, refreshRecents, relocateRecoveryDraftsForDocument, updateOpenDocumentFile, rerender, runBusy, updateCurrentDocumentSession } from './main';
import { recordSuccessfulDocumentSave } from './documentHistory';
import { logDebugEvent } from './debugLog';
import { recoveryDraftIdentity } from './recoveryDocuments';

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
  const previousPath = state.document.source.path;
  const previousRecoveryIdentity = recoveryDraftIdentity(state.document);
  const previousMode = state.document.mode;
  const previousUseDocumentColors = readDocumentColorPreference(previousPath);
  const bytes = await serializeMountedDocumentAsync(mounted);
  const file = await saveDocumentToWorkspace({
    workspacePath,
    name: documentFileName(name, documentTypeForExtension(state.document.source.extension)) ?? name,
    targetDirectory,
    bytes,
  });
  adoptSavedAsDocument(file, mounted, document, previousMode, previousPath, previousUseDocumentColors);
  recordSuccessfulDocumentSave(file.path, file.name, document);
  state.selectedFilePath = file.path;
  state.selectedWorkspacePath = workspacePath;
  upsertWorkspace(await loadWorkspace(workspacePath));
  await refreshRecents();
  await clearRecoveryDraftsForDocument(previousRecoveryIdentity.path, previousRecoveryIdentity.name);
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
  const sourceWorkspace = state.workspaces.find((candidate) => candidate.path === sourceWorkspacePath);
  const destinationWorkspace = state.workspaces.find((candidate) => candidate.path === workspacePath);
  const sourceNode = sourceWorkspace ? findFileInWorkspace(sourceWorkspace, path) : null;
  const destinationFolder = findEncryptedFolder(destinationWorkspace, targetDirectory);
  const sourceEncrypted = Boolean(sourceNode?.encryptedFolderKeyId);
  if (!sourceEncrypted && !destinationFolder) {
    const file = await moveDocumentToWorkspace({ path, workspacePath, targetDirectory });
    await applyArchivedFileRelocations(file.relocatedArchivedFiles);
    await updateHomepageDocumentPath(path, file.path);
    await applyWorkspaceFileRelocation(path, workspacePath, file, sourceWorkspacePath);
    state.status = `Moved to ${file.name}`;
    return;
  }
  if (!sourceWorkspacePath || !sourceNode || !sourceWorkspace) throw new Error('Source document must be inside an open workspace.');
  const sourceParts = sourceNode.relativePath.replaceAll('\\', '/').split('/');
  const sourcePhysicalName = sourceParts.pop() ?? '';
  const sourceDirectory = sourceParts.join('/');
  if (sourceWorkspacePath === workspacePath && sourceDirectory === targetDirectory) {
    state.status = `Already in ${sourceNode.name}`;
    return;
  }
  const sourceFile = await readDocumentFile(path);
  let file: DocumentFile;
  if (destinationFolder) {
    if (sourceNode.extension !== '.hvy' && sourceNode.extension !== '.thvy' && sourceNode.extension !== '.phvy') {
      throw new Error('Encrypted folders support .hvy, .thvy, and .phvy documents.');
    }
    const mutation = await prepareEncryptedFolderImportedDocumentMutation(
      destinationFolder,
      sourceNode.name,
      sourceNode.extension,
      Uint8Array.from(sourceFile.bytes),
      documentEncryptionKeyring(),
    );
    const created = await createEncryptedFolderDocument({
      workspacePath,
      folderDirectory: targetDirectory,
      documentId: mutation.documentId,
      extension: sourceNode.extension,
      documentBytes: mutation.documentBytes,
      previousManifestBytes: mutation.previousManifestBytes,
      manifestBytes: mutation.manifestBytes,
    });
    file = { ...created, name: sourceNode.name, extension: sourceNode.extension };
  } else {
    const created = await saveDocumentToWorkspace({
      workspacePath,
      targetDirectory,
      name: sourceNode.name,
      bytes: sourceFile.bytes,
    });
    file = { ...created, bytes: sourceFile.bytes };
  }
  if (sourceEncrypted) {
    const sourceFolder = findEncryptedFolder(sourceWorkspace, sourceDirectory);
    if (!sourceFolder || (sourceNode.extension !== '.hvy' && sourceNode.extension !== '.thvy' && sourceNode.extension !== '.phvy')) {
      throw new Error('Encrypted source folder was not found.');
    }
    const sourceEntryId = sourcePhysicalName.slice(0, Math.max(0, sourcePhysicalName.length - sourceNode.extension.length));
    const removal = await prepareEncryptedFolderEntryRemoval(sourceFolder, sourceEntryId, documentEncryptionKeyring());
    await deleteEncryptedFolderDocument({
      workspacePath: sourceWorkspacePath,
      folderDirectory: sourceDirectory,
      documentId: sourceEntryId,
      extension: sourceNode.extension,
      previousManifestBytes: removal.previousManifestBytes,
      manifestBytes: removal.manifestBytes,
    });
  } else {
    await deleteDocumentFile(path);
  }
  await applyArchivedFileRelocations(file.relocatedArchivedFiles);
  await updateHomepageDocumentPath(path, file.path);
  await applyWorkspaceFileRelocation(path, workspacePath, file, sourceWorkspacePath);
  state.status = `Moved to ${file.name}`;
}

export async function copyOpenWorkspaceFileToWorkspace(path: string, workspacePath: string, targetDirectory = ''): Promise<void> {
  const sourceWorkspacePath = workspacePathForFile(path);
  const sourceWorkspace = state.workspaces.find((candidate) => candidate.path === sourceWorkspacePath);
  const destinationWorkspace = state.workspaces.find((candidate) => candidate.path === workspacePath);
  const sourceNode = sourceWorkspace ? findFileInWorkspace(sourceWorkspace, path) : null;
  const destinationFolder = findEncryptedFolder(destinationWorkspace, targetDirectory);
  const sourceEncrypted = Boolean(sourceNode?.encryptedFolderKeyId);
  if (!sourceEncrypted && !destinationFolder) {
    const file = await copyDocumentToWorkspace({ path, workspacePath, targetDirectory });
    await applyArchivedFileRelocations(file.relocatedArchivedFiles);
    upsertWorkspace(await loadWorkspace(workspacePath));
    state.selectedWorkspacePath = workspacePath;
    state.status = `Copied to ${file.name}`;
    await refreshRecents();
    return;
  }
  if (!sourceNode) throw new Error('Source document must be inside an open workspace.');
  const sourceFile = await readDocumentFile(path);
  let file: DocumentFile;
  if (destinationFolder) {
    if (sourceNode.extension !== '.hvy' && sourceNode.extension !== '.thvy' && sourceNode.extension !== '.phvy') {
      throw new Error('Encrypted folders support .hvy, .thvy, and .phvy documents.');
    }
    const logicalName = uniqueWorkspaceDocumentName(destinationWorkspace, targetDirectory, sourceNode.name);
    const mutation = await prepareEncryptedFolderImportedDocumentMutation(
      destinationFolder,
      logicalName,
      sourceNode.extension,
      Uint8Array.from(sourceFile.bytes),
      documentEncryptionKeyring(),
    );
    const created = await createEncryptedFolderDocument({
      workspacePath,
      folderDirectory: targetDirectory,
      documentId: mutation.documentId,
      extension: sourceNode.extension,
      documentBytes: mutation.documentBytes,
      previousManifestBytes: mutation.previousManifestBytes,
      manifestBytes: mutation.manifestBytes,
    });
    file = { ...created, name: logicalName, extension: sourceNode.extension };
  } else {
    const created = await saveDocumentToWorkspace({
      workspacePath,
      targetDirectory,
      name: sourceNode.name,
      bytes: sourceFile.bytes,
    });
    file = { ...created, bytes: sourceFile.bytes };
  }
  await applyArchivedFileRelocations(file.relocatedArchivedFiles);
  upsertWorkspace(await loadWorkspace(workspacePath));
  state.selectedWorkspacePath = workspacePath;
  state.status = `Copied to ${file.name}`;
  await refreshRecents();
}

function uniqueWorkspaceDocumentName(workspace: Workspace | undefined, targetDirectory: string, fileName: string): string {
  if (!workspaceHasLogicalName(workspace, targetDirectory, fileName)) return fileName;
  const extension = fileName.match(/\.(hvy|thvy|phvy)$/i)?.[0] ?? '';
  const stem = extension ? fileName.slice(0, -extension.length) : fileName;
  let index = 2;
  while (workspaceHasLogicalName(workspace, targetDirectory, `${stem} ${index}${extension}`)) index += 1;
  return `${stem} ${index}${extension}`;
}

export async function convertOpenWorkspaceFileKind(path: string, workspacePath: string, toTemplate: boolean): Promise<void> {
  const workspace = state.workspaces.find((candidate) => candidate.path === workspacePath);
  const sourceNode = workspace ? findFileInWorkspace(workspace, path) : null;
  if (workspace && sourceNode?.encryptedFolderKeyId) {
    if (sourceNode.extension !== '.hvy' && sourceNode.extension !== '.thvy' && sourceNode.extension !== '.phvy') {
      throw new Error('Only .hvy, .thvy, and .phvy files can be converted.');
    }
    const nextExtension = sourceNode.extension === '.phvy' ? '.phvy' : toTemplate ? '.thvy' : '.hvy';
    const nextName = `${sourceNode.name.slice(0, -sourceNode.extension.length)}${nextExtension}`;
    const sourceFile = await readDocumentFile(path);
    const created = await saveDocumentToWorkspace({
      workspacePath,
      targetDirectory: toTemplate ? 'templates' : '',
      name: nextName,
      bytes: sourceFile.bytes,
    });
    const parts = sourceNode.relativePath.replaceAll('\\', '/').split('/');
    const physicalName = parts.pop() ?? '';
    const sourceDirectory = parts.join('/');
    const sourceFolder = findEncryptedFolder(workspace, sourceDirectory);
    if (!sourceFolder) throw new Error('Encrypted source folder was not found.');
    const sourceEntryId = physicalName.slice(0, Math.max(0, physicalName.length - sourceNode.extension.length));
    const removal = await prepareEncryptedFolderEntryRemoval(sourceFolder, sourceEntryId, documentEncryptionKeyring());
    await deleteEncryptedFolderDocument({
      workspacePath,
      folderDirectory: sourceDirectory,
      documentId: sourceEntryId,
      extension: sourceNode.extension,
      previousManifestBytes: removal.previousManifestBytes,
      manifestBytes: removal.manifestBytes,
    });
    const file = { ...created, bytes: sourceFile.bytes };
    await updateHomepageDocumentPath(path, file.path);
    state.workspaceFileViews[workspacePath] = toTemplate ? 'templates' : 'documents';
    await applyWorkspaceFileRelocation(path, workspacePath, file, workspacePath);
    await refreshSavedTemplates(workspacePath);
    state.status = `${toTemplate ? 'Converted to template' : 'Converted to document'}: ${file.name}`;
    return;
  }
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
  const currentDocument = state.document?.source.path === path && state.document.virtual !== 'versionHistory'
    ? state.document
    : null;
  const mountedDocument = currentDocument?.mounted?.document ?? pendingMountDocument;
  updateOpenDocumentFile(path, file);
  await relocateRecoveryDraftsForDocument(path, fileNameFromPath(path), file);
  if (state.selectedFilePath === path) {
    state.selectedFilePath = file.path;
  }
  state.selectedWorkspacePath = workspacePath;
  if (currentDocument) {
    if (mountedDocument) {
      updateCurrentDocumentSession(mountedDocument);
    }
  }
  if (sourceWorkspacePath) {
    upsertWorkspace(await loadWorkspace(sourceWorkspacePath));
  }
  upsertWorkspace(await loadWorkspace(workspacePath));
  await refreshRecents();
}

export async function finishAddingFilesToWorkspace(result: AddFilesResult, status: string): Promise<void> {
  await applyArchivedFileRelocations(result.relocatedArchivedFiles);
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

export async function applyArchivedFileRelocations(relocations: WorkspaceFileRelocation[] = []): Promise<void> {
  for (const relocation of relocations) {
    updateOpenDocumentFile(relocation.previousPath, relocation);
    if (state.selectedFilePath === relocation.previousPath) state.selectedFilePath = relocation.path;
    await updateHomepageDocumentPath(relocation.previousPath, relocation.path);
    await relocateDocumentHistory(relocation.previousPath, relocation.path, relocation.name);
    await relocateRecoveryDraftsForDocument(
      relocation.previousPath,
      fileNameFromPath(relocation.previousPath),
      relocation,
    );
  }
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

export function loadWorkspace(path: string, options: { recordRecent?: boolean; unlockEncryptedFolders?: boolean } = {}): Promise<Workspace> {
  return loadWorkspaceBackend(path, {
    includeTemplates: state.workspaceFileViews[path] === 'templates',
    recordRecent: options.recordRecent === true,
    unlockEncryptedFolders: options.unlockEncryptedFolders,
  });
}

export function showWorkspaceDocumentsView(workspacePath: string): void {
  state.workspaceFileViews[workspacePath] = 'documents';
}

export async function refreshSavedTemplates(workspacePath?: string | null): Promise<void> {
  state.savedTemplates = await listSavedTemplates(workspacePath ?? workspacePathForFile(state.document?.source.path ?? '') ?? state.selectedWorkspacePath);
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
  else state.workspaceEntries.unshift(entry);
  syncMcpWorkspaces();
}

export function workspaceDisplayNameFromPath(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '');
  return normalized.split(/[\\/]/).pop() || path;
}

export async function loadWorkspaceEntry(path: string, options: { recordRecent?: boolean; unlockEncryptedFolders?: boolean } = {}): Promise<void> {
  await loadWorkspaceEntryUsing(path, () => loadWorkspace(path, options), 'direct');
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

export type WorkspaceOrderSort = 'nameAsc' | 'nameDesc' | 'recentDesc' | 'recentAsc';

export function sortedWorkspaceEntries(
  entries: AppState['workspaceEntries'],
  workspaces: Workspace[],
  recentPaths: string[],
  order: WorkspaceOrderSort,
): AppState['workspaceEntries'] {
  const originalIndexes = new Map(entries.map((entry, index) => [entry.path, index]));
  const workspaceNames = new Map(workspaces.map((workspace) => [workspace.path, workspace.manifest.name]));
  const recentIndexes = new Map(recentPaths.map((path, index) => [path, index]));
  return [...entries].sort((left, right) => {
    let comparison = 0;
    if (order === 'nameAsc' || order === 'nameDesc') {
      const leftName = workspaceNames.get(left.path) ?? left.displayName;
      const rightName = workspaceNames.get(right.path) ?? right.displayName;
      comparison = leftName.localeCompare(rightName);
      if (order === 'nameDesc') comparison *= -1;
    } else {
      const leftIndex = recentIndexes.get(left.path);
      const rightIndex = recentIndexes.get(right.path);
      if (leftIndex !== undefined && rightIndex !== undefined) {
        comparison = order === 'recentDesc' ? leftIndex - rightIndex : rightIndex - leftIndex;
      } else if (leftIndex !== undefined) {
        comparison = -1;
      } else if (rightIndex !== undefined) {
        comparison = 1;
      }
    }
    return comparison || (originalIndexes.get(left.path) ?? 0) - (originalIndexes.get(right.path) ?? 0);
  });
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
