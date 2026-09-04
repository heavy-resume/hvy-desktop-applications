import { addDroppedFilesToWorkspace, addFilesToWorkspace, archiveWorkspace, createDocumentFile, createEncryptedFolderChild, createEncryptedFolderDocument, createWorkspace, createWorkspaceFolder, deleteEncryptedFolderChild, deleteWorkspaceFolder, initializeWorkspacePath, loadArchivedWorkspaces, openImportSourceDialog, readDocumentFile, readSidecarFileBytes, renameWorkspace, saveDocumentFile, saveWorkspaceOrder, selectWorkspaceDocumentFiles, unarchiveWorkspace, updateEncryptedFolderManifest, updateWorkspaceAiAccess, updateWorkspaceFolderAiAccess, type DocumentFile, type DroppedWorkspaceFile, type WorkspaceFileNode, type WorkspaceTreeNode } from './backend';
import { measureDebugAsync } from './debugLog';
import { embeddingSidecarPath } from './embeddingIndex';
import { currentDocumentWorkspacePath } from './fileActions';
import { buildMountedImportPlan, getMountedDocument, markMountedDocumentSaved, importTextIntoMountedDocument, serializeMountedDocumentAsync } from './hvy';
import { documentEncryptionKeyring, generateStoredDocumentKey } from './documentKeys';
import { encryptedFolderIdFromPhysicalName, encryptFolderManifest, findEncryptedFolder, prepareEncryptedFolderChildMutation, prepareEncryptedFolderDocumentMutation, prepareEncryptedFolderEntryAIAccessMutation, prepareEncryptedFolderEntryRemoval, prepareEncryptedFolderEntryRename, prepareEncryptedFolderImportedDocumentMutation, prepareEncryptedFolderSelfAIAccessMutation, prepareEncryptedFolderSelfRename, workspaceHasLogicalName } from './encryptedFolders';
import { findFileInWorkspace, state } from './state';
import { cancelCloseWorkspaceChat, cancelWorkspaceChatIndexing, currentWorkspaceChatDocumentPath, discardWorkspaceChat, openWorkspaceChat, requestCloseWorkspaceChat, resolveWorkspaceHref, saveWorkspaceChat, submitWorkspaceChat, updateWorkspaceChatDraft } from './workspaceChat';
import { activateWorkspaceChatDocument, pendingMountDocument, refreshRecents, refreshArchivedWorkspaces, submitWorkspaceFilter, clearWorkspaceFilter, importedTemplateOutputExtension, importSourceFrom, openDocument, updateCurrentDocumentSession, clearWorkspaceFilterDocumentCache, pathStartsWithWorkspace, mountCurrentDocument, ensureCurrentDocumentMounted, setDocumentDirty, clearRecoveryDraftsForDocument, refreshOpenWorkspaceForFile, saveImportedDocumentToWorkspace, createTemporaryImportMount, finishAddingFilesToWorkspace, droppedWorkspaceFilesFrom, loadWorkspace, showWorkspaceDocumentsView, refreshSavedTemplates, creationTemplate, upsertWorkspace, reorderedWorkspaceEntries, sortedWorkspaceEntries, syncMcpWorkspaces, syncOpenDocumentAiAccess, hasOpenWorkspaceNamed, rerender, runBusy, documentFileName, workspaceRootDocumentFileName, hasInvalidDocumentNameSyntax, documentTypeForExtension, documentTitle, closeUiBeforeWorkspaceFilter, normalizeAiMaxContextChars, createWorkspaceInChosenFolder, removeDocumentTabPath, type WorkspaceOrderSort } from './main';
import type { UiHandlers } from './ui';
import { saveWorkspaceExpansionState } from './workspaceExpansionState';

export function createWorkspaceHandlers(): Partial<UiHandlers> {
  const applyEncryptedAIAccess = async (prompt: NonNullable<typeof state.encryptedAIAccessPrompt>, allowed: boolean): Promise<void> => {
    const workspace = state.workspaces.find((candidate) => candidate.path === prompt.workspacePath);
    if (!workspace) throw new Error('Workspace was not found.');
    let mutation;
    let folderDirectory: string;
    if (prompt.kind === 'folder') {
      const folder = findEncryptedFolder(workspace, prompt.targetDirectory);
      if (!folder) throw new Error('Encrypted folder was not found.');
      mutation = await prepareEncryptedFolderSelfAIAccessMutation(folder, allowed, documentEncryptionKeyring());
      folderDirectory = prompt.targetDirectory;
    } else {
      const file = findFileInWorkspace(workspace, prompt.path);
      if (!file?.encryptedFolderKeyId) throw new Error('Encrypted document was not found.');
      const parts = file.relativePath.replaceAll('\\', '/').split('/');
      const physicalName = parts.pop() ?? '';
      folderDirectory = parts.join('/');
      const folder = findEncryptedFolder(workspace, folderDirectory);
      if (!folder) throw new Error('Encrypted parent folder was not found.');
      const entryId = physicalName.slice(0, Math.max(0, physicalName.length - file.extension.length));
      mutation = await prepareEncryptedFolderEntryAIAccessMutation(folder, entryId, allowed, documentEncryptionKeyring());
    }
    const updated = await updateEncryptedFolderManifest({
      workspacePath: prompt.workspacePath,
      folderDirectory,
      previousManifestBytes: mutation.previousManifestBytes,
      manifestBytes: mutation.manifestBytes,
    });
    upsertWorkspace(updated);
    clearWorkspaceFilterDocumentCache(updated.path);
    const syncFiles = (nodes: WorkspaceTreeNode[]): void => {
      for (const node of nodes) {
        if (node.kind === 'folder') syncFiles(node.children);
        else if (node.encryptedFolderKeyId) syncOpenDocumentAiAccess(node.path, {});
      }
    };
    syncFiles(updated.files);
    if (allowed && prompt.openAIWhenEnabled && state.document?.source.path === prompt.path) {
      state.document.mode = 'ai';
      await mountCurrentDocument();
    }
    state.status = `${allowed ? 'Enabled' : 'Disabled'} AI access for ${prompt.name}`;
  };

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
  setIntegrationsSectionExpanded: (expanded) => {
    state.integrationsSectionExpanded = expanded;
    rerender({ preserveMountedDocument: true });
  },
  setWorkspacesSectionExpanded: (expanded) => {
    state.workspacesSectionExpanded = expanded;
    rerender({ preserveMountedDocument: true });
  },
  createWorkspaceFolder: (workspacePath, parentDirectory, name, encrypted) => void runBusy(`Creating ${encrypted ? 'encrypted ' : ''}folder...`, async () => {
    const trimmed = name.trim();
    if (!workspacePath || !trimmed) {
      state.newFolderWorkspacePath = workspacePath || null;
      state.newFolderParentDirectory = parentDirectory;
      state.status = 'Folder name is required';
      return;
    }
    const currentWorkspace = state.workspaces.find((candidate) => candidate.path === workspacePath);
    if (workspaceHasLogicalName(currentWorkspace, parentDirectory, trimmed)) {
      throw new Error(`A file or folder named ${trimmed} already exists in this folder.`);
    }
    const encryptedParent = findEncryptedFolder(currentWorkspace, parentDirectory);
    let workspace: Awaited<ReturnType<typeof createWorkspaceFolder>>;
    if (encryptedParent) {
      const mutation = await prepareEncryptedFolderChildMutation(encryptedParent, trimmed, documentEncryptionKeyring());
      workspace = await createEncryptedFolderChild({
        workspacePath,
        folderDirectory: parentDirectory,
        childFolderId: mutation.childFolderId,
        childManifestBytes: mutation.childManifestBytes,
        previousManifestBytes: mutation.previousManifestBytes,
        manifestBytes: mutation.manifestBytes,
      });
    } else {
      let encryptedRequest: import('./backend').WorkspaceFolderRequest['encrypted'];
      if (encrypted) {
      const folderId = crypto.randomUUID();
      const folderKey = await generateStoredDocumentKey();
      const manifestBytes = await encryptFolderManifest({
        version: 1,
        folderId,
        name: trimmed,
        entries: {},
      }, folderKey.keyId, folderKey.key);
      encryptedRequest = { folderId, manifestBytes };
      }
      workspace = await createWorkspaceFolder({
        workspacePath,
        parentDirectory,
        name: trimmed,
        ...(encryptedRequest ? { encrypted: encryptedRequest } : {}),
      });
    }
    state.newFolderWorkspacePath = null;
    state.newFolderParentDirectory = '';
    state.newFolderEncrypted = false;
    showWorkspaceDocumentsView(workspacePath);
    upsertWorkspace(workspace);
    state.selectedWorkspacePath = workspacePath;
    state.status = `Created ${trimmed}`;
  }),
  renameEncryptedFolder: (workspacePath, targetDirectory, currentName) => {
    state.renameEncryptedFolderWorkspacePath = workspacePath;
    state.renameEncryptedFolderDirectory = targetDirectory;
    state.renameEncryptedFolderCurrentName = currentName;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  submitRenameEncryptedFolder: (name) => void runBusy('Renaming encrypted folder...', async () => {
    const workspacePath = state.renameEncryptedFolderWorkspacePath;
    const targetDirectory = state.renameEncryptedFolderDirectory;
    const currentName = state.renameEncryptedFolderCurrentName;
    const trimmed = name.trim();
    if (!workspacePath || !targetDirectory || !currentName) return;
    if (!trimmed) throw new Error('Folder name is required.');
    if (trimmed === currentName) {
      state.renameEncryptedFolderWorkspacePath = null;
      state.renameEncryptedFolderDirectory = '';
      state.renameEncryptedFolderCurrentName = null;
      return;
    }
    const workspace = state.workspaces.find((candidate) => candidate.path === workspacePath);
    const folder = findEncryptedFolder(workspace, targetDirectory);
    if (!workspace || !folder) throw new Error('Encrypted folder was not found.');
    const parts = targetDirectory.replaceAll('\\', '/').split('/');
    const entryId = encryptedFolderIdFromPhysicalName(parts.pop() ?? '');
    const parentDirectory = parts.join('/');
    const parent = findEncryptedFolder(workspace, parentDirectory);
    if (workspaceHasLogicalName(workspace, parentDirectory, trimmed, targetDirectory)) {
      throw new Error(`A file or folder named ${trimmed} already exists in this folder.`);
    }
    const mutation = parent
      ? await prepareEncryptedFolderEntryRename(parent, entryId, trimmed, documentEncryptionKeyring())
      : await prepareEncryptedFolderSelfRename(folder, trimmed, documentEncryptionKeyring());
    const updated = await updateEncryptedFolderManifest({
      workspacePath,
      folderDirectory: parent ? parentDirectory : targetDirectory,
      previousManifestBytes: mutation.previousManifestBytes,
      manifestBytes: mutation.manifestBytes,
    });
    state.renameEncryptedFolderWorkspacePath = null;
    state.renameEncryptedFolderDirectory = '';
    state.renameEncryptedFolderCurrentName = null;
    upsertWorkspace(updated);
    state.status = `Renamed to ${trimmed}`;
  }, { preserveMountedDocument: true }),
  cancelRenameEncryptedFolder: () => {
    state.renameEncryptedFolderWorkspacePath = null;
    state.renameEncryptedFolderDirectory = '';
    state.renameEncryptedFolderCurrentName = null;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  openNewFolder: (workspacePath, parentDirectory = '', encrypted = false) => {
    state.openWorkspaceActionsPath = null;
    state.newFolderWorkspacePath = workspacePath;
    state.newFolderParentDirectory = parentDirectory;
    state.newFolderEncrypted = encrypted;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
    requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>('input[name="folderName"]')?.focus();
    });
  },
  cancelNewFolder: () => {
    state.newFolderWorkspacePath = null;
    state.newFolderParentDirectory = '';
    state.newFolderEncrypted = false;
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
      const currentWorkspace = state.workspaces.find((candidate) => candidate.path === workspacePath);
      const encryptedFolder = findEncryptedFolder(currentWorkspace, targetDirectory);
      const parts = targetDirectory.replaceAll('\\', '/').split('/');
      const childPhysicalName = parts.pop() ?? '';
      const parentDirectory = parts.join('/');
      const encryptedParent = findEncryptedFolder(currentWorkspace, parentDirectory);
      const workspace = encryptedFolder && encryptedParent
        ? await (async () => {
          const childFolderId = encryptedFolderIdFromPhysicalName(childPhysicalName);
          const mutation = await prepareEncryptedFolderEntryRemoval(encryptedParent, childFolderId, documentEncryptionKeyring());
          return deleteEncryptedFolderChild({
            workspacePath,
            folderDirectory: parentDirectory,
            childFolderId,
            previousManifestBytes: mutation.previousManifestBytes,
            manifestBytes: mutation.manifestBytes,
          });
        })()
        : await deleteWorkspaceFolder({ workspacePath, targetDirectory });
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
  reorderWorkspace: (draggedPath, targetPath, before) => void runBusy('Reordering workspaces...', async () => {
    const entries = reorderedWorkspaceEntries(state.workspaceEntries, draggedPath, targetPath, before);
    if (entries === state.workspaceEntries) return;
    state.workspaceEntries = entries;
    state.recent = await saveWorkspaceOrder(entries.map((entry) => entry.path));
    state.workspaceManagerOpen = true;
    state.status = 'Reordered workspaces';
  }, { preserveMountedDocument: true }),
  sortWorkspaceOrder: (order: WorkspaceOrderSort) => void runBusy('Sorting workspaces...', async () => {
    const recentPaths = state.recent.recentWorkspaces ?? state.recent.workspaces;
    const entries = sortedWorkspaceEntries(state.workspaceEntries, state.workspaces, recentPaths, order);
    state.workspaceEntries = entries;
    state.recent = await saveWorkspaceOrder(entries.map((entry) => entry.path));
    state.workspaceManagerOpen = true;
    state.status = 'Sorted workspaces';
  }, { preserveMountedDocument: true }),
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
    state.workspaceEntries = state.workspaceEntries.filter((candidate) => candidate.path !== path);
    delete state.workspaceFilters[path];
    delete state.workspaceExpanded[path];
    delete state.workspaceFolderExpanded[path];
    saveWorkspaceExpansionState(state.workspaceExpanded);
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
  setEncryptedFolderAIAllowed: (workspacePath, targetDirectory, name, allowed) => {
    const prompt = { kind: 'folder' as const, workspacePath, targetDirectory, path: '', name };
    if (allowed) {
      state.encryptedAIAccessPrompt = prompt;
      rerender({ preserveMountedDocument: true });
      return;
    }
    void runBusy('Disabling AI access...', () => applyEncryptedAIAccess(prompt, false), { preserveMountedDocument: true });
  },
  setEncryptedFileAIAllowed: (workspacePath, path, name, allowed) => {
    const prompt = { kind: 'file' as const, workspacePath, targetDirectory: '', path, name };
    if (allowed) {
      state.encryptedAIAccessPrompt = prompt;
      rerender({ preserveMountedDocument: true });
      return;
    }
    void runBusy('Disabling AI access...', () => applyEncryptedAIAccess(prompt, false), { preserveMountedDocument: true });
  },
  confirmEncryptedAIAccess: () => {
    const prompt = state.encryptedAIAccessPrompt;
    state.encryptedAIAccessPrompt = null;
    if (!prompt) return;
    void runBusy('Enabling AI access...', () => applyEncryptedAIAccess(prompt, true), { preserveMountedDocument: true });
  },
  cancelEncryptedAIAccess: () => {
    state.encryptedAIAccessPrompt = null;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
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
    const workspace = state.workspaces.find((candidate) => candidate.path === workspacePath);
    const encryptedFolder = findEncryptedFolder(workspace, targetDirectory);
    const file = encryptedFolder
      ? await createEncryptedDocumentInFolder(
        workspacePath,
        targetDirectory,
        encryptedFolder,
        fileName,
        new TextEncoder().encode(template),
      )
      : await createDocumentFile({
        workspacePath,
        relativePath: targetDirectory ? `${targetDirectory}/${fileName}` : fileName,
        template,
      });
    showWorkspaceDocumentsView(workspacePath);
    upsertWorkspace(await loadWorkspace(workspacePath));
    state.selectedWorkspacePath = workspacePath;
    await openDocument(file, { deferMount: true, ...(encryptedFolder ? { initialMode: 'editor' as const } : {}) });
    state.status = `Created ${file.name}`;
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
    if (!state.document || state.document.readOnly || state.document.source.extension === '.md') return;
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
    const encryptedFolder = findEncryptedFolder(state.workspaces.find((candidate) => candidate.path === workspacePath), targetDirectory);
    const file = encryptedFolder
      ? await createEncryptedDocumentInFolder(workspacePath, targetDirectory, encryptedFolder, fileName, new TextEncoder().encode(template))
      : await createDocumentFile({
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
    await saveDocumentFile({ path: state.document.source.path, bytes });
    markMountedDocumentSaved(state.document.mounted);
    state.document.dirty = false;
    state.document.isNew = false;
    updateCurrentDocumentSession(getMountedDocument(state.document.mounted));
    await clearRecoveryDraftsForDocument(state.document.source.path, state.document.source.name);
    await refreshOpenWorkspaceForFile(state.document.source.path);
    await refreshRecents();
    state.status = result.message ?? `Imported ${source.name}`;
    } finally {
      state.importProgressDialogOpen = false;
    }
  }),
  importIntoCurrent: (instructions, pastedSourceText, excludeTags, newSectionsOnly, outputMode, outputName) => void runBusy('Importing into current document...', async () => {
    const source = await importSourceFrom(pastedSourceText);
    if (!state.document || state.document.readOnly || state.document.source.extension === '.md') return;
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
      ? workspaceRootDocumentFileName(outputName, documentTypeForExtension(importedTemplateOutputExtension(state.document.source.extension)))
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
        ? importedTemplateOutputExtension(state.document.source.extension)
        : state.document.source.extension;
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
    const encryptedFolder = findEncryptedFolder(state.workspaces.find((candidate) => candidate.path === workspacePath), targetDirectory);
    if (encryptedFolder) {
      const files = await selectWorkspaceDocumentFiles();
      if (!files) return;
      await addDocumentsToEncryptedFolder(workspacePath, targetDirectory, files);
      await refreshRecents();
      return;
    }
    const result = await addFilesToWorkspace(workspacePath, targetDirectory);
    if (!result) return;
    await finishAddingFilesToWorkspace(result, 'Added files to workspace');
    await refreshRecents();
  }),
  addDroppedFilesToWorkspace: (workspacePath, files, targetDirectory = '') => void runBusy('Adding files...', async () => {
    await measureDebugAsync('event', 'workspace:addDroppedFiles', {
      workspacePath,
      targetDirectory,
      fileNames: files.map((file) => file.name),
    }, async () => {
      const droppedFiles = await droppedWorkspaceFilesFrom(files);
      if (findEncryptedFolder(state.workspaces.find((candidate) => candidate.path === workspacePath), targetDirectory)) {
        await addDocumentsToEncryptedFolder(workspacePath, targetDirectory, droppedFiles);
        await refreshRecents();
        return;
      }
      const result = await addDroppedFilesToWorkspace(workspacePath, droppedFiles, targetDirectory);
      await finishAddingFilesToWorkspace(result, 'Added dropped files to workspace');
      await refreshRecents();
    });
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
    saveWorkspaceExpansionState(state.workspaceExpanded);
    rerender({ preserveMountedDocument: true });
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

async function createEncryptedDocumentInFolder(
  workspacePath: string,
  targetDirectory: string,
  folder: import('./backend').WorkspaceFolderNode,
  fileName: string,
  plaintextBytes: Uint8Array,
): Promise<DocumentFile> {
  const lowerName = fileName.toLowerCase();
  const extension = encryptedFolderDocumentExtension(lowerName);
  if (!extension) throw new Error('Encrypted folders support .hvy, .thvy, and .phvy documents.');
  const mutation = await prepareEncryptedFolderDocumentMutation(
    folder,
    fileName,
    extension,
    plaintextBytes,
    documentEncryptionKeyring(),
  );
  const file = await createEncryptedFolderDocument({
    workspacePath,
    folderDirectory: targetDirectory,
    documentId: mutation.documentId,
    extension,
    documentBytes: mutation.documentBytes,
    previousManifestBytes: mutation.previousManifestBytes,
    manifestBytes: mutation.manifestBytes,
  });
  return { ...file, name: fileName, extension };
}

async function addDocumentsToEncryptedFolder(
  workspacePath: string,
  targetDirectory: string,
  files: DroppedWorkspaceFile[],
): Promise<void> {
  const importedFiles: Array<{ path: string; name: string; extension: '.hvy' | '.thvy' | '.phvy' }> = [];
  for (const source of files) {
    const lowerName = source.name.toLowerCase();
    const extension = encryptedFolderDocumentExtension(lowerName);
    if (!extension) throw new Error('Encrypted folders support .hvy, .thvy, and .phvy documents.');
    const workspace = await loadWorkspace(workspacePath);
    const folder = findEncryptedFolder(workspace, targetDirectory);
    if (!folder) throw new Error('Encrypted folder was not found.');
    const mutation = await prepareEncryptedFolderImportedDocumentMutation(
      folder,
      source.name,
      extension,
      Uint8Array.from(source.bytes),
      documentEncryptionKeyring(),
    );
    const file = await createEncryptedFolderDocument({
      workspacePath,
      folderDirectory: targetDirectory,
      documentId: mutation.documentId,
      extension,
      documentBytes: mutation.documentBytes,
      previousManifestBytes: mutation.previousManifestBytes,
      manifestBytes: mutation.manifestBytes,
    });
    importedFiles.push({ path: file.path, name: source.name, extension });
  }
  const workspace = await loadWorkspace(workspacePath);
  upsertWorkspace(workspace);
  state.selectedWorkspacePath = workspacePath;
  state.status = 'Added files to encrypted folder';
  if (importedFiles.length === 1) {
    const imported = importedFiles[0];
    const physical = await readDocumentFile(imported.path);
    await openDocument({ ...physical, name: imported.name, extension: imported.extension }, { deferMount: true });
  }
}

function encryptedFolderDocumentExtension(fileName: string): '.hvy' | '.thvy' | '.phvy' | null {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.phvy')) return '.phvy';
  if (lowerName.endsWith('.thvy')) return '.thvy';
  if (lowerName.endsWith('.hvy')) return '.hvy';
  return null;
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
