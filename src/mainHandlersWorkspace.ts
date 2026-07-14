import { addDroppedFilesToWorkspace, addFilesToWorkspace, archiveWorkspace, createDocumentFile, createWorkspace, createWorkspaceFolder, deleteWorkspaceFolder, initializeWorkspacePath, loadArchivedWorkspaces, openImportSourceDialog, readDocumentFile, readSidecarFileBytes, renameWorkspace, saveDocumentFile, unarchiveWorkspace, updateWorkspaceAiAccess, updateWorkspaceFolderAiAccess, type WorkspaceFileNode, type WorkspaceTreeNode } from './backend';
import { embeddingSidecarPath } from './embeddingIndex';
import { currentDocumentWorkspacePath } from './fileActions';
import { buildMountedImportPlan, getMountedDocument, markMountedDocumentSaved, importTextIntoMountedDocument, serializeMountedDocumentAsync } from './hvy';
import { state } from './state';
import { cancelCloseWorkspaceChat, cancelWorkspaceChatIndexing, currentWorkspaceChatDocumentPath, discardWorkspaceChat, openWorkspaceChat, requestCloseWorkspaceChat, resolveWorkspaceHref, saveWorkspaceChat, submitWorkspaceChat, updateWorkspaceChatDraft } from './workspaceChat';
import { activateWorkspaceChatDocument, pendingMountDocument, refreshRecents, refreshArchivedWorkspaces, submitWorkspaceFilter, clearWorkspaceFilter, importedTemplateOutputExtension, importSourceFrom, openDocument, updateCurrentDocumentSession, clearWorkspaceFilterDocumentCache, pathStartsWithWorkspace, mountCurrentDocument, ensureCurrentDocumentMounted, setDocumentDirty, clearRecoveryDraftsForDocument, refreshOpenWorkspaceForFile, saveImportedDocumentToWorkspace, createTemporaryImportMount, finishAddingFilesToWorkspace, droppedWorkspaceFilesFrom, loadWorkspace, showWorkspaceDocumentsView, refreshSavedTemplates, creationTemplate, upsertWorkspace, syncMcpWorkspaces, hasOpenWorkspaceNamed, rerender, runBusy, documentFileName, workspaceRootDocumentFileName, hasInvalidDocumentNameSyntax, documentTypeForExtension, documentTitle, closeUiBeforeWorkspaceFilter, normalizeAiMaxContextChars, createWorkspaceInChosenFolder, removeDocumentTabPath } from './main';
import type { UiHandlers } from './ui';

export function createWorkspaceHandlers(): Partial<UiHandlers> {
  const newDocumentInWorkspace: UiHandlers['newDocumentInWorkspace'] = (workspacePath, targetDirectory = '') => {
    state.openWorkspaceActionsPath = null;
    state.newDocumentWorkspacePath = workspacePath;
    state.newDocumentDirectory = targetDirectory;
    state.newDocumentType = 'hvy';
    state.importWorkspacePath = null;
    state.importDirectory = '';
    state.importIntoCurrentDialogOpen = false;
    state.importSource = null;
    state.importSourceTextDraft = '';
    state.importExcludeTags = '';
    state.importNewSectionsOnly = false;
    state.status = 'Ready';
    void refreshSavedTemplates(workspacePath).then(() => rerender({ preserveMountedDocument: true }));
    rerender({ preserveMountedDocument: true });
    requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>('input[name="documentName"]')?.focus();
    });
  };

  return {
  createWorkspaceFolder: (workspacePath, parentDirectory, name) => void runBusy('Creating folder...', async () => {
    const trimmed = name.trim();
    if (!workspacePath || !trimmed) {
      state.newFolderWorkspacePath = workspacePath || null;
      state.newFolderParentDirectory = parentDirectory;
      state.status = 'Folder name is required';
      return;
    }
    const workspace = await createWorkspaceFolder({ workspacePath, parentDirectory, name: trimmed });
    state.newFolderWorkspacePath = null;
    state.newFolderParentDirectory = '';
    showWorkspaceDocumentsView(workspacePath);
    upsertWorkspace(workspace);
    state.selectedWorkspacePath = workspacePath;
    state.status = `Created ${trimmed}`;
  }),
  openNewFolder: (workspacePath, parentDirectory = '') => {
    state.openWorkspaceActionsPath = null;
    state.newFolderWorkspacePath = workspacePath;
    state.newFolderParentDirectory = parentDirectory;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
    requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>('input[name="folderName"]')?.focus();
    });
  },
  cancelNewFolder: () => {
    state.newFolderWorkspacePath = null;
    state.newFolderParentDirectory = '';
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  deleteWorkspaceFolder: (workspacePath, targetDirectory) => {
    if (!workspacePath || !targetDirectory) return;
    state.deleteFolderWorkspacePath = null;
    state.deleteFolderDirectory = '';
    state.deleteFolderName = null;
    state.deleteFolderArchivedFiles = [];
    void runBusy('Deleting folder...', async () => {
      const workspace = await deleteWorkspaceFolder({ workspacePath, targetDirectory });
      upsertWorkspace(await loadWorkspace(workspace.path));
      clearWorkspaceFilterDocumentCache(workspace.path);
      await refreshSavedTemplates(workspace.path);
      await refreshRecents();
      state.status = `Deleted ${targetDirectory.split('/').filter(Boolean).at(-1) ?? 'folder'}`;
    });
  },
  confirmDeleteWorkspaceFolder: (workspacePath, targetDirectory, folderName, archivedFiles) => {
    state.deleteFolderWorkspacePath = workspacePath;
    state.deleteFolderDirectory = targetDirectory;
    state.deleteFolderName = folderName;
    state.deleteFolderArchivedFiles = archivedFiles;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  cancelDeleteWorkspaceFolder: () => {
    state.deleteFolderWorkspacePath = null;
    state.deleteFolderDirectory = '';
    state.deleteFolderName = null;
    state.deleteFolderArchivedFiles = [];
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  newWorkspace: () => {
    state.openWorkspaceActionsPath = null;
    state.newWorkspaceDialogOpen = true;
    state.workspaceInitializationDialogOpen = false;
    state.workspaceInitializationPath = null;
    state.workspaceInitializationName = null;
    state.newWorkspaceLocation = 'managed';
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
    requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>('input[name="workspaceName"]')?.focus();
    });
  },
  openWorkspaceManager: () => {
    state.openWorkspaceActionsPath = null;
    state.workspaceManagerOpen = true;
    state.status = 'Ready';
    void refreshArchivedWorkspaces().then(() => rerender({ preserveMountedDocument: true }));
    rerender({ preserveMountedDocument: true });
  },
  closeWorkspaceManager: () => {
    state.workspaceManagerOpen = false;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  renameWorkspace: (path, name) => void runBusy('Renaming workspace...', async () => {
    const trimmed = name.trim();
    if (!path || !trimmed) {
      state.workspaceManagerOpen = true;
      state.status = 'Workspace name is required';
      return;
    }
    if (hasOpenWorkspaceNamed(trimmed, path)) {
      state.workspaceManagerOpen = true;
      state.status = 'Workspace name must be unique';
      return;
    }
    const workspace = await renameWorkspace(path, trimmed);
    upsertWorkspace(workspace);
    state.workspaceManagerOpen = true;
    state.status = `Renamed workspace to ${workspace.manifest.name}`;
    await refreshRecents();
  }),
  archiveWorkspace: (path) => void runBusy('Archiving workspace...', async () => {
    const workspace = state.workspaces.find((candidate) => candidate.path === path);
    await archiveWorkspace(path);
    state.workspaces = state.workspaces.filter((candidate) => candidate.path !== path);
    delete state.workspaceFilters[path];
    delete state.workspaceExpanded[path];
    delete state.workspaceFolderExpanded[path];
    clearWorkspaceFilterDocumentCache(path);
    if (state.workspaceFilter.workspacePath === path) {
      state.workspaceFilter.open = false;
      state.workspaceFilter.workspacePath = null;
    }
    if (state.selectedWorkspacePath === path) {
      state.selectedWorkspacePath = state.workspaces[0]?.path ?? null;
    }
    if (state.selectedFilePath && pathStartsWithWorkspace(state.selectedFilePath, path)) {
      state.selectedFilePath = null;
    }
    syncMcpWorkspaces();
    state.archivedWorkspaces = await loadArchivedWorkspaces();
    state.workspaceManagerOpen = true;
    state.status = `Archived ${workspace?.manifest.name ?? 'workspace'}`;
    await refreshRecents();
  }),
  unarchiveWorkspace: (path) => void runBusy('Unarchiving workspace...', async () => {
    const workspace = await unarchiveWorkspace(path);
    upsertWorkspace(workspace);
    state.selectedWorkspacePath = workspace.path;
    state.archivedWorkspaces = await loadArchivedWorkspaces();
    state.workspaceManagerOpen = true;
    state.status = `Unarchived ${workspace.manifest.name}`;
    await refreshRecents();
  }),
  setWorkspaceHiddenFromAI: (workspacePath, hiddenFromAI) => void runBusy(`${hiddenFromAI ? 'Hiding workspace from AI' : 'Unhiding workspace from AI'}...`, async () => {
    const workspace = await updateWorkspaceAiAccess(workspacePath, { hiddenFromAI });
    upsertWorkspace(workspace);
    clearWorkspaceFilterDocumentCache(workspace.path);
    state.status = `${workspace.manifest.name} ${hiddenFromAI ? 'hidden from AI' : 'visible to AI'}`;
  }),
  setWorkspaceFolderHiddenFromAI: (workspacePath, targetDirectory, hiddenFromAI) => void runBusy(`${hiddenFromAI ? 'Hiding folder from AI' : 'Unhiding folder from AI'}...`, async () => {
    const workspace = await updateWorkspaceFolderAiAccess(workspacePath, targetDirectory, { hiddenFromAI });
    upsertWorkspace(workspace);
    clearWorkspaceFilterDocumentCache(workspace.path);
    state.status = `${targetDirectory.split('/').filter(Boolean).at(-1) ?? 'Folder'} ${hiddenFromAI ? 'hidden from AI' : 'visible to AI'}`;
  }),
  toggleWorkspaceActions: (path) => {
    state.openWorkspaceActionsPath = state.openWorkspaceActionsPath === path ? null : path;
    rerender({ preserveMountedDocument: true });
  },
  closeWorkspaceActions: () => {
    if (!state.openWorkspaceActionsPath) return;
    state.openWorkspaceActionsPath = null;
    rerender({ preserveMountedDocument: true });
  },
  createWorkspace: (name, location) => void runBusy('Creating workspace...', async () => {
    const trimmed = name.trim();
    if (location === 'managed' && !trimmed) {
      state.newWorkspaceDialogOpen = true;
      state.status = 'Workspace name is required';
      return;
    }
    if (location === 'managed' && hasOpenWorkspaceNamed(trimmed)) {
      state.newWorkspaceDialogOpen = true;
      state.status = 'Workspace name must be unique';
      return;
    }
    const workspace = location === 'choose'
      ? await createWorkspaceInChosenFolder()
      : await createWorkspace(trimmed);
    if (!workspace) {
      state.newWorkspaceDialogOpen = true;
      state.status = 'Ready';
      return;
    }
    state.newWorkspaceDialogOpen = false;
    upsertWorkspace(workspace);
    state.selectedWorkspacePath = workspace.path;
    await refreshRecents();
  }),
  confirmWorkspaceInitialization: () => void runBusy('Creating workspace...', async () => {
    const path = state.workspaceInitializationPath;
    if (!path) return;
    const workspace = await initializeWorkspacePath(path);
    state.workspaceInitializationDialogOpen = false;
    state.workspaceInitializationPath = null;
    state.workspaceInitializationName = null;
    state.newWorkspaceDialogOpen = false;
    upsertWorkspace(workspace);
    state.selectedWorkspacePath = workspace.path;
    await refreshRecents();
    await refreshArchivedWorkspaces();
  }),
  cancelWorkspaceInitialization: () => {
    state.workspaceInitializationDialogOpen = false;
    state.workspaceInitializationPath = null;
    state.workspaceInitializationName = null;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  setNewWorkspaceLocation: (location) => {
    state.newWorkspaceLocation = location;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  cancelNewWorkspace: () => {
    state.newWorkspaceDialogOpen = false;
    state.workspaceInitializationDialogOpen = false;
    state.workspaceInitializationPath = null;
    state.workspaceInitializationName = null;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  newDocumentInWorkspace,
  setNewDocumentType: (type) => {
    state.newDocumentType = type;
    rerender({ preserveMountedDocument: true });
  },
  createDocumentInWorkspace: (name, templateId, selectedTargetDirectory = state.newDocumentDirectory) => void runBusy('Creating document...', async () => {
    const workspacePath = state.newDocumentWorkspacePath;
    const targetDirectory = selectedTargetDirectory;
    const fileName = documentFileName(name, state.newDocumentType);
    if (!workspacePath) return;
    if (!fileName) {
      state.status = 'Document name is required';
      return;
    }
    const template = creationTemplate(workspacePath, state.newDocumentType, templateId, documentTitle(fileName));
    state.newDocumentWorkspacePath = null;
    state.newDocumentDirectory = '';
    const file = await createDocumentFile({
      workspacePath,
      relativePath: targetDirectory ? `${targetDirectory}/${fileName}` : fileName,
      template,
    });
    showWorkspaceDocumentsView(workspacePath);
    upsertWorkspace(await loadWorkspace(workspacePath));
    state.selectedWorkspacePath = workspacePath;
    await openDocument(file, { deferMount: true });
    state.status = 'Created blank HVY document';
    await refreshRecents();
  }),
  cancelNewDocument: () => {
    state.newDocumentWorkspacePath = null;
    state.newDocumentDirectory = '';
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  openImportInWorkspace: (workspacePath, targetDirectory = '') => {
    state.openWorkspaceActionsPath = null;
    state.newDocumentWorkspacePath = null;
    state.newDocumentDirectory = '';
    state.importWorkspacePath = workspacePath;
    state.importDirectory = targetDirectory;
    state.importDocumentType = 'hvy';
    state.importIntoCurrentDialogOpen = false;
    state.importSourceTab = 'anywhere';
    state.importSource = null;
    state.importSourceTextDraft = '';
    state.importExcludeTags = '';
    state.importNewSectionsOnly = false;
    state.status = 'Ready';
    void refreshSavedTemplates(workspacePath).then(() => rerender({ preserveMountedDocument: true }));
    rerender({ preserveMountedDocument: true });
    requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>('input[name="documentName"]')?.focus();
    });
  },
  setImportDocumentType: (type) => {
    state.importDocumentType = type;
    rerender({ preserveMountedDocument: true });
  },
  openImportIntoCurrent: () => void (async () => {
    if (!state.document || state.document.readOnly || state.document.extension === '.md') return;
    await ensureCurrentDocumentMounted();
    if (!state.document?.mounted) return;
    state.newDocumentWorkspacePath = null;
    state.importWorkspacePath = null;
    state.importIntoCurrentDialogOpen = true;
    state.importSourceTab = 'workspace';
    state.importOutputMode = currentDocumentWorkspacePath(state) ? 'workspace' : 'current';
    state.importSource = null;
    state.importSourceTextDraft = '';
    state.importExcludeTags = '';
    state.importNewSectionsOnly = false;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  })(),
  setImportSourceTab: (tab) => {
    state.importSourceTab = tab;
    state.importSource = null;
    state.importSourceTextDraft = '';
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  setImportOutputMode: (mode) => {
    state.importOutputMode = mode;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  updateImportExcludeTags: (tags) => {
    state.importExcludeTags = tags;
  },
  updateImportSourceText: (text) => {
    state.importSourceTextDraft = text;
  },
  setImportNewSectionsOnly: (newSectionsOnly) => {
    state.importNewSectionsOnly = newSectionsOnly;
  },
  selectImportWorkspaceSource: (path) => void runBusy('Selecting import source...', async () => {
    if (!path) {
      state.importSource = null;
      state.status = 'Ready';
      return;
    }
    const file = await readDocumentFile(path);
    state.importSource = {
      path: file.path,
      name: file.name,
      extension: file.extension,
      bytes: file.bytes,
    };
    state.importSourceTextDraft = '';
    state.status = `Selected ${file.name}`;
  }, { preserveMountedDocument: true }),
  chooseImportSource: () => void runBusy('Choosing import source...', async () => {
    const source = await openImportSourceDialog();
    if (!source) {
      state.status = 'Ready';
      return;
    }
    state.importSource = source;
    state.importSourceTextDraft = '';
    state.status = `Selected ${source.name}`;
  }),
  createImportedDocument: (name, templateId, instructions, pastedSourceText, excludeTags, newSectionsOnly, selectedTargetDirectory = state.importDirectory) => void runBusy('Importing document...', async () => {
    const workspacePath = state.importWorkspacePath;
    const targetDirectory = selectedTargetDirectory;
    const source = await importSourceFrom(pastedSourceText);
    const fileName = documentFileName(name, state.importDocumentType);
    if (!workspacePath) return;
    if (!source) {
      state.status = 'Import source is required';
      return;
    }
    if (!fileName) {
      state.status = 'Document name is required';
      return;
    }
    const template = creationTemplate(workspacePath, state.importDocumentType, templateId, documentTitle(fileName));
    state.importWorkspacePath = null;
    state.importDirectory = '';
    state.importSource = null;
    state.importSourceTextDraft = '';
    state.importExcludeTags = '';
    state.importNewSectionsOnly = false;
    state.importProgressDialogOpen = true;
    rerender({ preserveMountedDocument: true });
    try {
    const file = await createDocumentFile({
      workspacePath,
      relativePath: targetDirectory ? `${targetDirectory}/${fileName}` : fileName,
      template,
    });
    upsertWorkspace(await loadWorkspace(workspacePath));
    state.selectedWorkspacePath = workspacePath;
    await openDocument(file, { deferMount: true });
    rerender();
    await mountCurrentDocument(pendingMountDocument ?? undefined);
    if (!state.document?.mounted) return;
    const plan = await buildMountedImportPlan(state.document.mounted, {
      sourceName: source.name,
      sourceText: source.text,
      sourceDocument: source.sourceDocument,
      instructions,
      newSectionsOnly,
      excludeTags,
      maxContextChars: normalizeAiMaxContextChars(state.aiSettings.maxContextChars),
      onProgress: (event) => {
        if (event.message) state.status = event.message;
        rerender({ preserveMountedDocument: true });
      },
    });
    if (plan.status !== 'ready' || !plan.steps?.length) {
      throw new Error(plan.message ?? 'Import planner did not return a usable plan.');
    }
    const result = await importTextIntoMountedDocument(state.document.mounted, {
      sourceName: source.name,
      sourceText: source.text,
      sourceDocument: source.sourceDocument,
      instructions,
      steps: plan.steps,
      newSectionsOnly,
      excludeTags,
      maxContextChars: normalizeAiMaxContextChars(state.aiSettings.maxContextChars),
      onProgress: (event) => {
        if (event.message) state.status = event.message;
        rerender({ preserveMountedDocument: true });
      },
    });
    if (result.status !== 'complete') {
      throw new Error(result.message ?? 'Import failed.');
    }
    const bytes = await serializeMountedDocumentAsync(state.document.mounted);
    await saveDocumentFile({ path: state.document.path, bytes });
    markMountedDocumentSaved(state.document.mounted);
    state.document.dirty = false;
    state.document.isNew = false;
    updateCurrentDocumentSession(getMountedDocument(state.document.mounted));
    await clearRecoveryDraftsForDocument(state.document.path, state.document.name);
    await refreshOpenWorkspaceForFile(state.document.path);
    await refreshRecents();
    state.status = result.message ?? `Imported ${source.name}`;
    } finally {
      state.importProgressDialogOpen = false;
    }
  }),
  importIntoCurrent: (instructions, pastedSourceText, excludeTags, newSectionsOnly, outputMode, outputName) => void runBusy('Importing into current document...', async () => {
    const source = await importSourceFrom(pastedSourceText);
    if (!state.document || state.document.readOnly || state.document.extension === '.md') return;
    await ensureCurrentDocumentMounted();
    if (!state.document?.mounted) return;
    if (!source) {
      state.status = 'Import source is required';
      return;
    }
    const outputWorkspacePath = outputMode === 'workspace' ? currentDocumentWorkspacePath(state) : null;
    if (outputMode === 'workspace' && !outputWorkspacePath) {
      state.status = 'Current workspace is required';
      return;
    }
    if (outputMode === 'workspace' && !outputName.trim()) {
      state.status = 'Output name is required';
      return;
    }
    if (outputMode === 'workspace' && hasInvalidDocumentNameSyntax(outputName)) {
      state.status = 'Document name contains invalid characters.';
      return;
    }
    const outputFileName = outputMode === 'workspace'
      ? workspaceRootDocumentFileName(outputName, documentTypeForExtension(importedTemplateOutputExtension(state.document.extension)))
      : null;
    if (outputMode === 'workspace' && !outputFileName) {
      state.status = 'Document name is required';
      return;
    }
    state.importIntoCurrentDialogOpen = false;
    state.importSource = null;
    state.importSourceTextDraft = '';
    state.importExcludeTags = '';
    state.importNewSectionsOnly = false;
    state.importProgressDialogOpen = true;
    rerender({ preserveMountedDocument: true });
    try {
      const outputExtension = outputMode === 'workspace'
        ? importedTemplateOutputExtension(state.document.extension)
        : state.document.extension;
      if (outputMode !== 'workspace') {
        state.document.mounted.document.extension = outputExtension;
      }
      const importTarget = outputMode === 'workspace'
        ? await createTemporaryImportMount(state.document.mounted.document, state.document.mode, outputExtension)
        : { mounted: state.document.mounted, cleanup: () => {} };
      try {
        const requestMode = outputExtension === '.phvy' ? 'pdf-template-import' : undefined;
        const plan = await buildMountedImportPlan(importTarget.mounted, {
          sourceName: source.name,
          sourceText: source.text,
          sourceDocument: source.sourceDocument,
          instructions,
          newSectionsOnly,
          excludeTags,
          requestMode,
          maxContextChars: normalizeAiMaxContextChars(state.aiSettings.maxContextChars),
          onProgress: (event) => {
            if (event.message) state.status = event.message;
            rerender({ preserveMountedDocument: true });
          },
        });
        if (plan.status !== 'ready' || !plan.steps?.length) {
          throw new Error(plan.message ?? 'Import planner did not return a usable plan.');
        }
        const result = await importTextIntoMountedDocument(importTarget.mounted, {
          sourceName: source.name,
          sourceText: source.text,
          sourceDocument: source.sourceDocument,
          instructions,
          steps: plan.steps,
          newSectionsOnly,
          excludeTags,
          requestMode,
          maxContextChars: normalizeAiMaxContextChars(state.aiSettings.maxContextChars),
          onProgress: (event) => {
            if (event.message) state.status = event.message;
            rerender({ preserveMountedDocument: true });
          },
        });
        if (result.status !== 'complete') {
          throw new Error(result.message ?? 'Import failed.');
        }
        if (outputMode === 'workspace' && outputWorkspacePath) {
          showWorkspaceDocumentsView(outputWorkspacePath);
          await saveImportedDocumentToWorkspace(outputWorkspacePath, outputFileName ?? outputName.trim(), importTarget.mounted.document);
        } else {
          setDocumentDirty(true);
          updateCurrentDocumentSession(getMountedDocument(state.document.mounted));
        }
        state.status = result.message ?? `Imported ${source.name}`;
      } finally {
        importTarget.cleanup();
      }
    } finally {
      state.importProgressDialogOpen = false;
    }
  }),
  cancelImport: () => {
    state.importWorkspacePath = null;
    state.importDirectory = '';
    state.importIntoCurrentDialogOpen = false;
    state.importSourceTab = 'workspace';
    state.importOutputMode = 'current';
    state.importSource = null;
    state.importSourceTextDraft = '';
    state.importExcludeTags = '';
    state.importNewSectionsOnly = false;
    state.importProgressDialogOpen = false;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  addFilesToWorkspace: (workspacePath, targetDirectory = '') => void runBusy('Adding files...', async () => {
    state.openWorkspaceActionsPath = null;
    const result = await addFilesToWorkspace(workspacePath, targetDirectory);
    if (!result) return;
    await finishAddingFilesToWorkspace(result, 'Added files to workspace');
    await refreshRecents();
  }),
  addDroppedFilesToWorkspace: (workspacePath, files, targetDirectory = '') => void runBusy('Adding files...', async () => {
    const droppedFiles = await droppedWorkspaceFilesFrom(files);
    const result = await addDroppedFilesToWorkspace(workspacePath, droppedFiles, targetDirectory);
    await finishAddingFilesToWorkspace(result, 'Added dropped files to workspace');
    await refreshRecents();
  }),
  openWorkspaceFilter: (workspacePath, targetDirectory = '') => {
    closeUiBeforeWorkspaceFilter();
    const activeFilter = state.workspaceFilters[workspacePath];
    const normalizedTargetDirectory = targetDirectory.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
    const activeFilterMatchesTarget = (activeFilter?.targetDirectory ?? '') === normalizedTargetDirectory;
    state.workspaceFilter.workspacePath = workspacePath;
    state.workspaceFilter.targetDirectory = normalizedTargetDirectory;
    state.workspaceFilter.open = true;
    state.workspaceFilter.error = null;
    state.workspaceFilter.status = null;
    state.workspaceFilter.queryDraft = activeFilterMatchesTarget ? activeFilter?.query ?? '' : '';
    state.workspaceFilter.submittedQuery = activeFilterMatchesTarget ? activeFilter?.query ?? '' : '';
    state.workspaceFilter.mode = activeFilterMatchesTarget ? activeFilter?.mode ?? 'keyword' : 'keyword';
    state.workspaceFilter.filterMode = activeFilterMatchesTarget ? activeFilter?.filterMode ?? 'deprioritize' : 'deprioritize';
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
    requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-field="workspace-filter-query"]')?.focus();
    });
  },
  setWorkspaceFileView: (workspacePath, view) => void runBusy(
    view === 'templates' ? 'Loading templates...' : 'Loading documents...',
    async () => {
      state.workspaceFileViews[workspacePath] = view;
      if (view === 'templates') {
        await refreshSavedTemplates(workspacePath);
      }
      upsertWorkspace(await loadWorkspace(workspacePath));
      state.selectedWorkspacePath = workspacePath;
      state.openWorkspaceActionsPath = null;
      state.status = view === 'templates' ? 'Showing templates' : 'Showing documents';
    },
    { preserveMountedDocument: true }
  ),
  toggleWorkspaceEmbeddingPreview: (workspacePath) => {
    const current = state.workspaceEmbeddingPreviews[workspacePath];
    state.openWorkspaceActionsPath = null;
    if (current?.enabled) {
      state.workspaceEmbeddingPreviews[workspacePath] = {
        enabled: false,
        loading: false,
        sidecars: {},
        error: null,
      };
      state.status = 'Embedding preview hidden';
      rerender({ preserveMountedDocument: true });
      return;
    }
    state.workspaceEmbeddingPreviews[workspacePath] = {
      enabled: true,
      loading: true,
      sidecars: {},
      error: null,
    };
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
    void refreshWorkspaceEmbeddingPreview(workspacePath);
  },
  setWorkspaceExpanded: (workspacePath, expanded) => {
    state.workspaceExpanded[workspacePath] = expanded;
  },
  setWorkspaceFolderExpanded: (workspacePath, relativePath, expanded) => {
    const normalizedPath = relativePath.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
    state.workspaceFolderExpanded[workspacePath] = {
      ...(state.workspaceFolderExpanded[workspacePath] ?? {}),
      [normalizedPath]: expanded,
    };
  },
  closeWorkspaceFilter: () => {
    state.workspaceFilter.open = false;
    state.workspaceFilter.isLoading = false;
    state.workspaceFilter.status = null;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  openWorkspaceChat: (workspacePath, targetDirectory = '') => {
    closeUiBeforeWorkspaceFilter();
    openWorkspaceChat(workspacePath, targetDirectory);
    activateWorkspaceChatDocument();
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  closeWorkspaceChat: () => {
    const activeWorkspaceChat = state.document?.virtual === 'workspaceChat';
    const path = currentWorkspaceChatDocumentPath();
    if (requestCloseWorkspaceChat()) {
      if (path) {
        removeDocumentTabPath(path);
      }
      if (activeWorkspaceChat) {
        state.document = null;
      }
      rerender({ preserveMountedDocument: true });
    } else {
      rerender({ preserveMountedDocument: true });
    }
  },
  saveWorkspaceChat: () => void runBusy('Saving chat...', async () => {
    const activeWorkspaceChat = state.document?.virtual === 'workspaceChat';
    const path = currentWorkspaceChatDocumentPath();
    await saveWorkspaceChat();
    if (activeWorkspaceChat && !state.workspaceChat.open) {
      state.document = null;
    }
    if (!state.workspaceChat.open && path) {
      removeDocumentTabPath(path);
    }
  }, { preserveMountedDocument: true }),
  discardWorkspaceChat: () => {
    const activeWorkspaceChat = state.document?.virtual === 'workspaceChat';
    const path = currentWorkspaceChatDocumentPath();
    discardWorkspaceChat();
    if (path) {
      removeDocumentTabPath(path);
    }
    if (activeWorkspaceChat) {
      state.document = null;
    }
    rerender({ preserveMountedDocument: true });
  },
  cancelCloseWorkspaceChat: () => {
    cancelCloseWorkspaceChat();
    rerender({ preserveMountedDocument: true });
  },
  cancelWorkspaceChatIndexing: () => {
    cancelWorkspaceChatIndexing();
    rerender({ preserveMountedDocument: true });
  },
  updateWorkspaceChatDraft: (value) => {
    updateWorkspaceChatDraft(value);
  },
  submitWorkspaceChat: () => {
    void submitWorkspaceChat(() => rerender({ preserveMountedDocument: true }));
    rerender({ preserveMountedDocument: true });
  },
  openWorkspaceLink: (href) => void runBusy('Opening linked document...', async () => {
    const path = resolveWorkspaceHref(href);
    if (!path) return;
    await openDocument(await readDocumentFile(path), { deferMount: true });
  }),
  setWorkspaceFilterMode: (mode) => {
    state.workspaceFilter.mode = mode;
    state.workspaceFilter.error = null;
    state.workspaceFilter.status = null;
    rerender({ preserveMountedDocument: true });
    requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-field="workspace-filter-query"]')?.focus();
    });
  },
  setWorkspaceFilterBehavior: (mode) => {
    state.workspaceFilter.filterMode = mode;
    state.workspaceFilter.error = null;
    state.workspaceFilter.status = null;
    rerender({ preserveMountedDocument: true });
  },
  updateWorkspaceFilterQuery: (query) => {
    state.workspaceFilter.queryDraft = query;
  },
  submitWorkspaceFilter: () => void submitWorkspaceFilter(),
  clearWorkspaceFilter: () => void clearWorkspaceFilter(),
  };
}

async function refreshWorkspaceEmbeddingPreview(workspacePath: string): Promise<void> {
  const workspace = state.workspaces.find((candidate) => candidate.path === workspacePath);
  if (!workspace) return;
  const files = flattenWorkspaceFilesForEmbeddingPreview(workspace.files)
    .filter((file) => file.extension === '.hvy' && !file.hiddenFromAI);
  const sidecars: Record<string, boolean> = {};
  try {
    await Promise.all(files.map(async (file) => {
      const bytes = await readSidecarFileBytes(embeddingSidecarPath(file.path)).catch(() => null);
      if (bytes) {
        sidecars[file.path] = true;
      }
    }));
    const current = state.workspaceEmbeddingPreviews[workspacePath];
    if (!current?.enabled) return;
    state.workspaceEmbeddingPreviews[workspacePath] = {
      enabled: true,
      loading: false,
      sidecars,
      error: null,
    };
    const count = Object.keys(sidecars).length;
    state.status = count === 1 ? 'Found embeddings for 1 file' : `Found embeddings for ${count} files`;
  } catch (error) {
    const current = state.workspaceEmbeddingPreviews[workspacePath];
    if (!current?.enabled) return;
    state.workspaceEmbeddingPreviews[workspacePath] = {
      enabled: true,
      loading: false,
      sidecars,
      error: error instanceof Error ? error.message : String(error),
    };
    state.status = 'Embedding preview failed';
  }
  rerender({ preserveMountedDocument: true });
}

function flattenWorkspaceFilesForEmbeddingPreview(nodes: WorkspaceTreeNode[]): WorkspaceFileNode[] {
  return nodes.flatMap((node) => node.kind === 'file' ? [node] : flattenWorkspaceFilesForEmbeddingPreview(node.children));
}
