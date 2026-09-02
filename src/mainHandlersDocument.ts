import { archiveDocumentFile, chooseWorkspaceFolder, copyDocumentToWorkspace, deleteDocumentFile, openDocumentFile, openFileDialog, pasteSystemFilesToWorkspace, readDocumentFile, renameDocumentFile, restoreDocumentBackup, restoreDocumentFile, revealDocumentFile, saveDocumentTemplate, updateWorkspaceFileAiAccess, updateWorkspaceTemplateVisibility, writeSystemFileClipboard, type TemplateExtension } from './backend';
import { measureDebugAsync } from './debugLog';
import { currentDocumentWorkspacePath, isWorkspaceTemplatePath } from './fileActions';
import { applyMountedRecoveryState, getMountedRecoveryState, getPhvyCompatibilityErrors, openMountedDocumentMeta, serializeHvy } from './hvy';
import { state, type PendingWorkspaceFileOperation } from './state';
import { mountRoot, pendingMountDocument, documentSessions, applyAppColorTheme, refreshRecents, refreshArchivedWorkspaces, applyWorkspaceFilterToCurrentDocument, workspaceFileAiAccess, ensureWorkspaceFileAiAccess, syncOpenDocumentAiAccess, syncOpenDocumentWorkspaceAccess, removeDocumentTabPath, removeOpenDocumentFile, updateOpenDocumentFile, openDocument, updateCurrentDocumentSession, mountCurrentDocument, ensureCurrentDocumentMounted, captureMountScrollRatio, restoreMountScrollRatio, setDocumentDirty, updateModeMetaChrome, saveCurrentDocument, openSaveAsDialog, saveCurrentDocumentAsAnywhere, openVersionHistory, openSavedVersionPreview, exportCurrentDocumentPdf, saveBeforeExportPdf, selectDocumentTab, cycleTabStack, commitTabStack, closeDocumentTab, saveAndCloseDocument, closeDocumentWithoutSaving, closeTargetDocumentWithoutSaving, closeCurrentDocument, saveAndCloseApp, closeAppWithoutSaving, confirmSaveConflict, cancelSaveConflict, backupDocumentKey, clearRecoveryDraftsForDocument, deleteBackupTracking, relocateRecoveryDraftsForDocument, discardRecoveryStateForBackup, recoveryDocumentId, createBlankDocument, refreshOpenWorkspaceForFile, currentDocumentCanSaveToWorkspace, openWorkspaceTransfer, workspaceTransferBusyLabel, saveCurrentDocumentToWorkspace, moveOpenWorkspaceFileToWorkspace, convertOpenWorkspaceFileKind, finishAddingFilesToWorkspace, applyArchivedFileRelocations, workspacePathForFile, loadWorkspace, loadWorkspaceEntry, retryWorkspaceEntry, refreshSavedTemplates, upsertWorkspace, rerender, setAppZoom, setDocumentZoom, nextZoomLevel, runBusy, documentTitle, syncRenamedTemplateMetadata, templateFileName, revealStatusLabel, writeDocumentModePreference, writeHotReloadSessionSnapshot, requestWorkspaceInitialization, setPendingMountState, updateHomepageDocumentPath, clearHomepageDocumentPath, workspaceFilterDocumentCache, preserveCurrentDocumentSession, fileNameFromPath } from './main';
import type { UiHandlers } from './ui';

function pendingWorkspaceFileOperationBusyLabel(operation: PendingWorkspaceFileOperation): string | null {
  if (operation.kind === 'pasteCopy') return 'Copying file...';
  if (operation.kind === 'pasteCut' || operation.kind === 'moveToFolder') return 'Moving file...';
  if (operation.kind === 'convert') return operation.toTemplate ? 'Converting to template...' : 'Converting to document...';
  return null;
}

async function performWorkspaceFileOperation(operation: PendingWorkspaceFileOperation): Promise<void> {
  if (operation.kind === 'copyClipboard' || operation.kind === 'cutClipboard') {
    const mode = operation.kind === 'copyClipboard' ? 'copy' : 'cut';
    state.workspaceClipboard = { mode, path: operation.path, name: operation.name };
    state.status = `${mode === 'copy' ? 'Copied' : 'Cut'} ${operation.name}`;
    rerender({ preserveMountedDocument: true });
    try {
      await writeSystemFileClipboard({ paths: [operation.path], operation: mode });
    } catch (error) {
      state.status = `${mode === 'copy' ? 'Copied' : 'Cut'} in HVY, but could not copy to Finder: ${error instanceof Error ? error.message : String(error)}`;
      rerender({ preserveMountedDocument: true });
    }
    return;
  }
  if (operation.kind === 'openTransfer') {
    openWorkspaceTransfer(operation.mode, operation.name, operation.path, null);
    return;
  }
  if (operation.kind === 'pasteCopy') {
    const file = await copyDocumentToWorkspace({ path: operation.path, workspacePath: operation.workspacePath, targetDirectory: operation.targetDirectory });
    await applyArchivedFileRelocations(file.relocatedArchivedFiles);
    upsertWorkspace(await loadWorkspace(operation.workspacePath));
    state.selectedWorkspacePath = operation.workspacePath;
    state.status = `Pasted ${file.name}`;
    await refreshRecents();
    return;
  }
  if (operation.kind === 'pasteCut') {
    await moveOpenWorkspaceFileToWorkspace(operation.path, operation.workspacePath, operation.targetDirectory);
    state.workspaceClipboard = null;
    return;
  }
  if (operation.kind === 'moveToFolder') {
    await moveOpenWorkspaceFileToWorkspace(operation.path, operation.workspacePath, operation.targetDirectory);
    return;
  }
  await convertOpenWorkspaceFileKind(operation.path, operation.workspacePath, operation.toTemplate);
}

async function executeWorkspaceFileOperation(operation: PendingWorkspaceFileOperation): Promise<void> {
  state.pendingWorkspaceFileOperation = null;
  state.workspaceFileOperationPromptOpen = false;
  const busyLabel = pendingWorkspaceFileOperationBusyLabel(operation);
  if (busyLabel) {
    await runBusy(busyLabel, () => performWorkspaceFileOperation(operation), { preserveMountedDocument: true });
    return;
  }
  await performWorkspaceFileOperation(operation);
}

async function requestWorkspaceFileOperation(operation: PendingWorkspaceFileOperation): Promise<void> {
  preserveCurrentDocumentSession();
  const activeDirtyDocumentId = state.document?.source.path === operation.path && state.document.dirty && !state.document.readOnly
    ? state.document.versionId
    : null;
  const dirtySession = [...documentSessions.values()].find((session) => session.source.path === operation.path && session.dirty && !session.readOnly);
  const dirtyDocumentId = activeDirtyDocumentId ?? dirtySession?.versionId ?? null;
  if (!dirtyDocumentId) {
    await executeWorkspaceFileOperation(operation);
    return;
  }
  await selectDocumentTab(dirtyDocumentId);
  if (state.document?.versionId === dirtyDocumentId && !state.document.dirty) {
    setDocumentDirty(true, { preserveStatus: true });
  }
  state.pendingWorkspaceFileOperation = operation;
  state.workspaceFileOperationPromptOpen = true;
  state.status = 'Ready';
  rerender({ preserveMountedDocument: true });
}

async function resumeWorkspaceFileOperationAfterSave(): Promise<void> {
  const operation = state.pendingWorkspaceFileOperation;
  if (!operation || state.saveConflictDialogOpen) return;
  if (state.document?.source.path !== operation.path || state.document.dirty) {
    state.workspaceFileOperationPromptOpen = true;
    rerender({ preserveMountedDocument: true });
    return;
  }
  await executeWorkspaceFileOperation(operation);
}

function selectWorkspaceFile(path: string): void {
  if (state.document?.source.path === path) return;
  const openSessions = [...documentSessions.values()].filter((session) => session.source.path === path);
  const openSession = openSessions.find((session) => session.dirty || session.virtual === 'recoveryDraft') ?? openSessions[0];
  void selectDocumentTab(openSession?.versionId ?? path);
}

export function createDocumentHandlers(newDocumentInWorkspace: UiHandlers['newDocumentInWorkspace']): Partial<UiHandlers> {
  return {
  restoreBackup: (id) => void runBusy('Restoring unsaved edits...', async () => {
    const file = await measureDebugAsync('load', 'recovery:restoreBackup', { backupId: id }, () => restoreDocumentBackup(id));
    if (file.path) {
      deleteBackupTracking(backupDocumentKey(file.path, file.name));
    }
    state.recoveryDialogOpen = false;
    state.recoveryBackups = [];
    await openDocument(file, { versionId: recoveryDocumentId(id), recovered: true, deferMount: true, recoveryBackupId: id });
  }),
  discardBackup: (id) => void runBusy('Discarding recovery draft...', async () => {
    const backup = state.recoveryBackups.find((candidate) => candidate.id === id);
    if (backup) {
      await clearRecoveryDraftsForDocument(backup.documentPath, backup.name);
      await discardRecoveryStateForBackup(backup);
    }
    state.recoveryBackups = state.recoveryBackups.filter((candidate) => candidate.id !== id);
    state.status = state.recoveryBackups.length > 0 ? 'Discarded recovery draft' : 'No recoverable edits available';
    rerender({ preserveMountedDocument: true });
  }, { preserveMountedDocument: true }),
  cancelRecovery: () => {
    state.recoveryDialogOpen = false;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  openVersionHistory: () => void openVersionHistory(),
  selectSavedVersion: (id) => void openSavedVersionPreview(id),
  closeVersionHistory: () => {
    state.versionHistoryDialogOpen = false;
    state.selectedSavedVersionId = null;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  cancelCloseDocument: () => {
    state.closeDocumentDialogOpen = false;
    state.closeDocumentDraftDialogOpen = false;
    state.closeDocumentTargetPath = null;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  confirmSaveConflict: () => void confirmSaveConflict().then(() => resumeWorkspaceFileOperationAfterSave()),
  cancelSaveConflict: () => {
    cancelSaveConflict();
    if (state.pendingWorkspaceFileOperation) {
      state.workspaceFileOperationPromptOpen = true;
      rerender({ preserveMountedDocument: true });
    }
  },
  saveBeforeWorkspaceFileOperation: () => {
    state.workspaceFileOperationPromptOpen = false;
    rerender({ preserveMountedDocument: true });
    void saveCurrentDocument().then(() => resumeWorkspaceFileOperationAfterSave());
  },
  discardBeforeWorkspaceFileOperation: () => {
    const operation = state.pendingWorkspaceFileOperation;
    if (!operation) return;
    state.workspaceFileOperationPromptOpen = false;
    state.pendingWorkspaceFileOperation = null;
    void runBusy('Discarding unsaved edits...', async () => {
      await closeCurrentDocument({ discard: true });
      for (const session of [...documentSessions.values()]) {
        if (session.source.path !== operation.path) continue;
        documentSessions.delete(session.versionId);
        removeDocumentTabPath(session.versionId);
        deleteBackupTracking(backupDocumentKey(session.source.path, session.source.name));
      }
      const access = workspaceFileAiAccess(operation.path);
      await openDocument(await readDocumentFile(operation.path), {
        deferMount: true,
        readOnly: access.readOnly,
        hiddenFromAI: access.hiddenFromAI,
      });
      await performWorkspaceFileOperation(operation);
    });
  },
  cancelWorkspaceFileOperation: () => {
    state.workspaceFileOperationPromptOpen = false;
    state.pendingWorkspaceFileOperation = null;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  closeDocumentWithoutSaving: () => void closeDocumentWithoutSaving(),
  discardCloseDocumentDraft: () => void closeTargetDocumentWithoutSaving({ discardDraft: true }),
  reviewCloseDocumentLater: () => void closeTargetDocumentWithoutSaving({ discardDraft: false }),
  saveAndCloseApp: () => void saveAndCloseApp(),
  closeAppWithoutSaving: () => void closeAppWithoutSaving(),
  cancelAppClose: () => {
    state.appCloseDialogOpen = false;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  selectDocumentTab: (path) => void selectDocumentTab(path),
  closeDocumentTab: (path) => void closeDocumentTab(path),
  cycleTabStack: (direction) => cycleTabStack(direction),
  commitTabStack: () => void commitTabStack(),
  cancelTabStack: () => {
    if (!state.tabStackOpen) return;
    state.tabStackOpen = false;
    state.tabStackIndex = 0;
    rerender({ preserveMountedDocument: true });
  },
  openWorkspace: () => void runBusy('Opening workspace...', async () => {
    const candidate = await chooseWorkspaceFolder();
    if (!candidate) return;
    const workspace = candidate.hasManifest
      ? await loadWorkspace(candidate.path, { recordRecent: true })
      : requestWorkspaceInitialization(candidate.path, candidate.defaultName);
    if (!workspace) {
      state.status = 'Ready';
      return;
    }
    upsertWorkspace(workspace);
    state.selectedWorkspacePath = workspace.path;
    await refreshRecents();
    await refreshArchivedWorkspaces();
    rerender();
  }),
  openFile: () => void runBusy('Opening file...', async () => {
    const file = await openFileDialog();
    if (!file) return;
    await openDocument(file, { deferMount: true });
    await refreshRecents();
  }),
  openRecentWorkspace: (path) => void (async () => {
    await loadWorkspaceEntry(path, { recordRecent: true });
    if (state.workspaces.some((workspace) => workspace.path === path)) state.selectedWorkspacePath = path;
    await refreshRecents();
    await refreshArchivedWorkspaces();
    rerender();
  })(),
  openRecentFile: (path) => void runBusy('Opening recent file...', async () => {
    await openDocument(await readDocumentFile(path), { deferMount: true });
    await refreshRecents();
  }),
  selectFile: (path) => selectWorkspaceFile(path),
  refreshWorkspace: (path) => void (async () => {
    await loadWorkspaceEntry(path);
    if (state.workspaces.some((workspace) => workspace.path === path)) state.selectedWorkspacePath = path;
    await refreshRecents();
  })(),
  retryWorkspace: (path) => void retryWorkspaceEntry(path),
  showFileInFolder: (path) => void runBusy('Showing file...', async () => {
    await revealDocumentFile(path);
    state.status = revealStatusLabel();
  }),
  renameFile: (path, currentName) => {
    state.renameFilePath = path;
    state.renameFileCurrentName = currentName;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  archiveFile: (path, currentName) => void runBusy('Archiving file...', async () => {
    const workspace = await archiveDocumentFile(path);
    await clearHomepageDocumentPath(path);
    await clearRecoveryDraftsForDocument(path, currentName);
    upsertWorkspace(await loadWorkspace(workspace.path));
    if (state.selectedFilePath === path) state.selectedFilePath = null;
    syncOpenDocumentWorkspaceAccess(path);
    await refreshSavedTemplates(workspace.path);
    state.status = `Archived ${currentName}`;
  }, { preserveMountedDocument: true }),
  restoreFile: (path, currentName) => void runBusy('Restoring file...', async () => {
    const workspace = await restoreDocumentFile(path);
    upsertWorkspace(await loadWorkspace(workspace.path));
    state.selectedFilePath = path;
    syncOpenDocumentWorkspaceAccess(path);
    await refreshSavedTemplates(workspace.path);
    state.status = `Restored ${currentName}`;
  }),
  setFileLocked: (path, currentName, locked) => void runBusy(`${locked ? 'Locking' : 'Unlocking'} file...`, async () => {
    const workspace = await updateWorkspaceFileAiAccess(path, { locked });
    ensureWorkspaceFileAiAccess(workspace, path, { locked });
    upsertWorkspace(workspace);
    syncOpenDocumentAiAccess(path, { locked });
    state.status = `${locked ? 'Locked' : 'Unlocked'} ${currentName}`;
  }),
  setFileHiddenFromAI: (path, currentName, hiddenFromAI) => void runBusy(`${hiddenFromAI ? 'Hiding file from AI' : 'Unhiding file from AI'}...`, async () => {
    const workspace = await updateWorkspaceFileAiAccess(path, { hiddenFromAI });
    ensureWorkspaceFileAiAccess(workspace, path, { hiddenFromAI });
    upsertWorkspace(workspace);
    workspaceFilterDocumentCache.delete(path);
    syncOpenDocumentAiAccess(path, { hiddenFromAI });
    await applyWorkspaceFilterToCurrentDocument();
    state.status = `${hiddenFromAI ? 'Hidden from AI' : 'Visible to AI'}: ${currentName}`;
  }),
  confirmDeleteFile: (path, currentName) => {
    state.deleteFilePath = path;
    state.deleteFileName = currentName;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  deleteFile: () => {
    const path = state.deleteFilePath;
    const name = state.deleteFileName;
    if (!path || !name) return;
    state.deleteFilePath = null;
    state.deleteFileName = null;
    void runBusy('Deleting file...', async () => {
      const workspace = await deleteDocumentFile(path);
      if (workspace) {
        upsertWorkspace(await loadWorkspace(workspace.path));
        await refreshSavedTemplates(workspace.path);
      }
      removeOpenDocumentFile(path);
      workspaceFilterDocumentCache.delete(path);
      deleteBackupTracking(backupDocumentKey(path, name));
      if (state.selectedFilePath === path) state.selectedFilePath = null;
      if (state.document?.source.path === path) {
        state.document = null;
        setPendingMountState(null, null);
      }
      await refreshRecents();
      state.status = `Deleted ${name}`;
    });
  },
  cancelDeleteFile: () => {
    state.deleteFilePath = null;
    state.deleteFileName = null;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  copyWorkspaceFile: (path, currentName) => void requestWorkspaceFileOperation({ kind: 'copyClipboard', path, name: currentName }),
  cutWorkspaceFile: (path, currentName) => void requestWorkspaceFileOperation({ kind: 'cutClipboard', path, name: currentName }),
  pasteWorkspaceClipboard: (workspacePath, targetDirectory = '') => {
    const clipboard = state.workspaceClipboard;
    if (!clipboard) {
      void runBusy('Copying file...', async () => {
        const result = await pasteSystemFilesToWorkspace(workspacePath, targetDirectory);
        await finishAddingFilesToWorkspace(result, `Pasted ${result.copiedPaths.length} file${result.copiedPaths.length === 1 ? '' : 's'}`);
      });
      return;
    }
    const kind = clipboard.mode === 'copy' ? 'pasteCopy' : 'pasteCut';
    void requestWorkspaceFileOperation({ kind, path: clipboard.path, name: clipboard.name, workspacePath, targetDirectory });
  },
  copyFileToWorkspace: (path, currentName) => void requestWorkspaceFileOperation({ kind: 'openTransfer', mode: 'copyFile', path, name: currentName }),
  moveFileToWorkspace: (path, currentName) => void requestWorkspaceFileOperation({ kind: 'openTransfer', mode: 'moveFile', path, name: currentName }),
  moveWorkspaceFileToFolder: (path, workspacePath, targetDirectory = '') => void requestWorkspaceFileOperation({
    kind: 'moveToFolder',
    path,
    name: fileNameFromPath(path),
    workspacePath,
    targetDirectory,
  }),
  convertWorkspaceFileKind: (path, workspacePath, toTemplate) => void requestWorkspaceFileOperation({
    kind: 'convert',
    path,
    name: fileNameFromPath(path),
    workspacePath,
    toTemplate,
  }),
  submitRenameFile: (name) => {
    const path = state.renameFilePath;
    const currentName = state.renameFileCurrentName;
    if (!path || !currentName) return;
    const currentStem = documentTitle(currentName);
    const trimmed = name.trim();
    if (!trimmed) {
      state.status = 'Document name is required';
      rerender({ preserveMountedDocument: true });
      return;
    }
    if (trimmed === currentStem) {
      state.renameFilePath = null;
      state.renameFileCurrentName = null;
      rerender({ preserveMountedDocument: true });
      return;
    }
    state.renameFilePath = null;
    state.renameFileCurrentName = null;
    void runBusy('Renaming file...', async () => {
      preserveCurrentDocumentSession();
      const workspacePath = workspacePathForFile(path);
      const currentDocument = state.document?.source.path === path && state.document.virtual !== 'versionHistory'
        ? state.document
        : null;
      const mountedDocument = currentDocument?.mounted?.document ?? pendingMountDocument;
      const file = await renameDocumentFile({ path, name: trimmed });
      await updateHomepageDocumentPath(path, file.path);
      const renamedOpenTemplateMetadata = Boolean(
        currentDocument
        && mountedDocument
        && isWorkspaceTemplatePath(state, path)
        && syncRenamedTemplateMetadata(mountedDocument, currentStem, documentTitle(file.name))
      );
      updateOpenDocumentFile(path, file);
      await relocateRecoveryDraftsForDocument(path, currentName, file);
      if (state.selectedFilePath === path) {
        state.selectedFilePath = file.path;
      }
      if (currentDocument) {
        if (mountedDocument) {
          updateCurrentDocumentSession(mountedDocument);
        }
        if (renamedOpenTemplateMetadata) {
          setDocumentDirty(true);
          if (currentDocument.metaOpen) {
            currentDocument.metaOpen = currentDocument.mounted?.mount.openDocumentMeta?.() ?? currentDocument.metaOpen;
            updateModeMetaChrome();
          }
        }
      }
      if (workspacePath) {
        upsertWorkspace(await loadWorkspace(workspacePath));
        await refreshSavedTemplates(workspacePath);
      } else {
        await refreshOpenWorkspaceForFile(file.path);
      }
      await refreshRecents();
      state.status = `Renamed to ${file.name}`;
    }, { preserveMountedDocument: true });
  },
  cancelRenameFile: () => {
    state.renameFilePath = null;
    state.renameFileCurrentName = null;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  saveCurrentToWorkspace: () => {
    if (!currentDocumentCanSaveToWorkspace()) return;
    openWorkspaceTransfer('saveCurrent', state.document!.source.name, null, currentDocumentWorkspacePath(state));
  },
  submitWorkspaceTransfer: (workspacePath, name, targetDirectory = '') => {
    if (!workspacePath || !state.workspaceTransfer) return;
    const transfer = state.workspaceTransfer;
    if (transfer.mode === 'saveCurrent' && !name.trim()) {
      state.status = 'Document name is required';
      rerender({ preserveMountedDocument: true });
      return;
    }
    transfer.nameDraft = name.trim();
    state.workspaceTransfer = null;
    void runBusy(`${workspaceTransferBusyLabel(transfer.mode)}...`, async () => {
      if (transfer.mode === 'saveCurrent') {
        await saveCurrentDocumentToWorkspace(workspacePath, transfer.nameDraft, targetDirectory);
        return;
      }
      if (!transfer.sourcePath) return;
      if (transfer.mode === 'copyFile') {
        const file = await copyDocumentToWorkspace({ path: transfer.sourcePath, workspacePath, targetDirectory });
        await applyArchivedFileRelocations(file.relocatedArchivedFiles);
        upsertWorkspace(await loadWorkspace(workspacePath));
        state.status = `Copied to ${file.name}`;
        await refreshRecents();
        return;
      }
      await moveOpenWorkspaceFileToWorkspace(transfer.sourcePath, workspacePath, targetDirectory);
    }, { preserveMountedDocument: true });
  },
  cancelWorkspaceTransfer: () => {
    state.workspaceTransfer = null;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  setMode: (mode) => {
    if (!state.document) return;
    if (state.document.readOnly && mode !== 'viewer') {
      state.status = 'This document is read-only';
      rerender();
      void mountCurrentDocument();
      return;
    }
    if (state.document.hiddenFromAI && mode === 'ai') {
      state.status = 'This document is hidden from AI';
      rerender();
      void mountCurrentDocument();
      return;
    }
    const document = state.document.mounted?.document;
    const recoveryState = state.document.mounted ? getMountedRecoveryState(state.document.mounted) : null;
    const documentId = state.document.versionId;
    const scrollRatio = captureMountScrollRatio(mountRoot);
    state.document.mode = mode;
    state.document.metaOpen = false;
    writeDocumentModePreference(state.document.source.path, mode);
    if (document) {
      updateCurrentDocumentSession(document);
    } else {
      writeHotReloadSessionSnapshot();
    }
    rerender();
    void mountCurrentDocument(document).then(() => {
      if (state.document?.versionId !== documentId || state.document.mode !== mode || !state.document.mounted) return;
      applyMountedRecoveryState(state.document.mounted, recoveryState);
      restoreMountScrollRatio(mountRoot, scrollRatio);
    });
  },
  openDocumentMeta: () => {
    if (!state.document) return;
    if (state.document.readOnly) {
      state.status = 'The HVY Galaxy guide is read-only';
      rerender();
      void mountCurrentDocument();
      return;
    }
    if (state.document.mounted && state.document.mode !== 'advanced') {
      const opened = openMountedDocumentMeta(state.document.mounted);
      if (opened) {
        state.document.mode = 'advanced';
        state.document.metaOpen = true;
        updateCurrentDocumentSession(state.document.mounted.document);
        applyAppColorTheme();
        updateModeMetaChrome();
        return;
      }
    }
    if (state.document.mode === 'advanced') {
      if (state.document.mounted) {
        state.document.metaOpen = openMountedDocumentMeta(state.document.mounted);
        updateCurrentDocumentSession(state.document.mounted.document);
        applyAppColorTheme();
        updateModeMetaChrome();
      }
      return;
    }
    const document = state.document.mounted?.document;
    state.document.mode = 'advanced';
    state.document.metaOpen = false;
    if (document) {
      updateCurrentDocumentSession(document);
    }
    rerender();
    void mountCurrentDocument(document).then(() => {
      if (state.document?.mode === 'advanced' && state.document.mounted) {
        state.document.metaOpen = openMountedDocumentMeta(state.document.mounted);
        updateCurrentDocumentSession(state.document.mounted.document);
        applyAppColorTheme();
        updateModeMetaChrome();
      }
    });
  },
  save: () => void saveCurrentDocument(),
  saveAs: () => {
    openSaveAsDialog();
  },
  setSaveAsKind: (kind) => {
    if (kind === 'template' && state.document?.source.extension === '.md') return;
    state.saveAsKind = kind;
    state.error = null;
    rerender({ preserveMountedDocument: true });
  },
  setSaveAsScope: (scope) => {
    if (scope === 'workspace' && state.workspaces.length === 0) return;
    state.saveAsScope = scope;
    rerender({ preserveMountedDocument: true });
  },
  saveAsToWorkspace: (workspacePath, name, targetDirectory = '') => {
    if (!workspacePath || !name.trim()) {
      state.status = 'Document name is required';
      rerender({ preserveMountedDocument: true });
      return;
    }
    state.saveAsDialogOpen = false;
    void runBusy('Saving as...', async () => {
      await saveCurrentDocumentToWorkspace(workspacePath, name.trim(), targetDirectory);
    });
  },
  saveAsAnywhere: () => {
    state.saveAsDialogOpen = false;
    void saveCurrentDocumentAsAnywhere();
  },
  cancelSaveAs: () => {
    state.saveAsDialogOpen = false;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  saveAndCloseDocument: () => void saveAndCloseDocument(),
  openSaveTemplate: () => void (async () => {
    if (!state.document || state.document.readOnly || state.document.source.extension === '.md') return;
    await ensureCurrentDocumentMounted();
    if (!state.document?.mounted) return;
    state.saveAsDialogOpen = true;
    state.saveAsKind = 'template';
    state.saveTemplateScope = workspacePathForFile(state.document.source.path) ? 'workspace' : 'app';
    state.error = null;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  })(),
  exportPdf: () => void exportCurrentDocumentPdf(),
  openExportedPdf: () => void runBusy('Opening PDF...', async () => {
    const path = state.exportedPdfPath;
    if (!path) return;
    await openDocumentFile(path);
    state.exportedPdfPath = null;
    state.status = 'Opened PDF';
  }, { preserveMountedDocument: true }),
  revealExportedPdf: () => void runBusy('Showing PDF...', async () => {
    const path = state.exportedPdfPath;
    if (!path) return;
    await revealDocumentFile(path);
    state.exportedPdfPath = null;
    state.status = revealStatusLabel();
  }, { preserveMountedDocument: true }),
  closeExportedPdfDialog: () => {
    state.exportedPdfPath = null;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  saveBeforeExportPdf: () => void saveBeforeExportPdf(),
  cancelExportPdfSavePrompt: () => {
    state.exportPdfSavePromptOpen = false;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  setSaveTemplateScope: (scope) => {
    if (scope === 'workspace' && !workspacePathForFile(state.document?.source.path ?? '')) return;
    state.saveTemplateScope = scope;
    state.error = null;
    rerender({ preserveMountedDocument: true });
  },
  saveAsTemplate: (name, scope, extension: TemplateExtension) => void runBusy('Saving template...', async () => {
    if (!state.document || state.document.readOnly || state.document.source.extension === '.md') return;
    await ensureCurrentDocumentMounted();
    if (!state.document?.mounted) return;
    const workspacePath = scope === 'workspace' ? workspacePathForFile(state.document.source.path) : null;
    if (scope === 'workspace' && !workspacePath) {
      throw new Error('Workspace template requires a document in an open workspace.');
    }
    if (extension === '.phvy') {
      const errors = await getPhvyCompatibilityErrors(state.document.mounted.document);
      if (errors.length > 0) {
        throw new Error(`Cannot save as PHVY until the document is PDF-safe. ${errors.slice(0, 3).join(' ')}`);
      }
    }
    const bytes = Array.from(await serializeHvy({ ...state.document.mounted.document, extension }));
    await saveDocumentTemplate({ scope, workspacePath, name, extension, bytes });
    state.saveAsDialogOpen = false;
    await refreshSavedTemplates(workspacePath);
    state.status = `Saved template ${templateFileName(name, extension)}`;
  }),
  cancelSaveTemplate: () => {
    state.saveAsDialogOpen = false;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  saveWorkspaceTemplateVisibility: (workspacePath, templateVisibility) => void runBusy('Saving template visibility...', async () => {
    if (!workspacePath) return;
    const workspace = await updateWorkspaceTemplateVisibility(workspacePath, templateVisibility);
    upsertWorkspace(workspace);
    state.status = 'Saved template visibility';
  }, { preserveMountedDocument: true }),
  createFile: () => {
    const workspacePath = state.selectedWorkspacePath ?? state.workspaces[0]?.path ?? null;
    if (workspacePath) {
      newDocumentInWorkspace(workspacePath);
      return;
    }
    void createBlankDocument();
  },
  zoomAppIn: () => setAppZoom(nextZoomLevel(state.appZoom, 1)),
  zoomAppOut: () => setAppZoom(nextZoomLevel(state.appZoom, -1)),
  resetAppZoom: () => setAppZoom(1),
  zoomDocumentIn: () => setDocumentZoom(nextZoomLevel(state.documentZoom, 1)),
  zoomDocumentOut: () => setDocumentZoom(nextZoomLevel(state.documentZoom, -1)),
  resetDocumentZoom: () => setDocumentZoom(1),
  closeDocument: () => void closeCurrentDocument(),
  };
}
