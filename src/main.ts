import './styles.css';
import { installAiChatClient } from './aiClient';
import type { HvyDocumentSearchDocument } from '../../heavy-file-format/src/search/types';
import {
  addDroppedFilesToWorkspace,
  addFilesToWorkspace,
  archiveDocumentFile,
  archiveWorkspace,
  chooseWorkspaceFolder,
  clearDocumentRecoveryDrafts,
  createDocumentBackup,
  createDocumentFile,
  createWorkspace,
  deleteDocumentFile,
  discardDocumentBackup,
  copyDocumentToWorkspace,
  initializeWorkspacePath,
  installMcpClient,
  loadArchivedWorkspaces,
  loadAiSettings,
  loadMcpClientInstallStatus,
  loadDefaultGuide,
  loadMcpServerStatus,
  loadMcpSettings,
  loadMcpStdioLaunchConfig,
  loadLaunchDocumentPaths,
  loadWorkspace as loadWorkspaceBackend,
  listSavedTemplates,
  listDocumentBackups,
  loadRecentState,
  onMenuEvent,
  onOpenDocumentPath,
  onAppCloseRequest,
  openDocumentFile,
  openExternalUrl,
  openColorThemeDialog,
  openFileDialog,
  openImportSourceDialog,
  readDocumentFile,
  requestAppClose,
  removeMcpClient,
  renameDocumentFile,
  renameWorkspace,
  restoreDocumentFile,
  revealDocumentFile,
  restoreMcpClientBackup,
  restoreDocumentBackup,
  saveMcpSettings,
  saveAiSettings,
  saveDocumentToWorkspace,
  saveColorThemeAsDialog,
  saveDocumentAsDialog,
  saveDocumentFile,
  saveDocumentTemplate,
  savePdfAsDialog,
  moveDocumentToWorkspace,
  pasteSystemFilesToWorkspace,
  startMcpServer,
  stopMcpServer,
  unarchiveWorkspace,
  updateWorkspaceTemplateVisibility,
  updateWorkspaceFileAiAccess,
  updateFileMenuState,
  type AddFilesResult,
  type DocumentBackup,
  type DocumentCreationType,
  type DocumentExtension,
  type DocumentFile,
  type DroppedWorkspaceFile,
  type ImportSourceFile,
  type McpClientInstallTarget,
  type McpSettings,
  type TemplateExtension,
  type Workspace,
  type WorkspaceFileNode,
  type WorkspaceTreeNode,
  updateMcpWorkspaces,
  writeSystemFileClipboard,
} from './backend';
import { applyColorTheme, createColorThemeFile, createSavedThemeId, getMatchedPaletteId, getMatchedSavedThemeId, getPaletteById, isCssVariableName, loadColorThemeSettings, parseColorThemeFile, saveColorThemeSettings, serializeColorThemeFile } from './colorTheme';
import { currentDocumentWorkspacePath, getFileActionAvailability, isWorkspaceTemplatePath } from './fileActions';
import { applyMountedRecoveryState, buildMountedImportPlan, createHvyDocumentFilterSnapshot, deserializeHvy, exportHvySourceMarkdown, getMountedDocument, getMountedRecoveryState, getPhvyCompatibilityErrors, importTextIntoMountedDocument, isMountedDocumentDirty, markMountedDocumentSaved, mountHvyDocument, openMountedDocumentMeta, redoMountedDocument, serializeHvy, serializeMountedDocument, setMountedSearchSnapshot, undoMountedDocument, type HvyMode, type MountedDocument, type VisualDocument } from './hvy';
import { state, workspaceFileAccessInWorkspaces, workspacePathForFileInWorkspaces, type WorkspaceFilterConfig } from './state';
import { getTemplateById, mergeSavedTemplates, templatesForDocumentType, workspaceTemplateVisibility } from './templates';
import { render, renderAllAroundDocument as renderUiAroundDocument, type UiHandlers } from './ui';

let mountRoot: HTMLElement | null = null;
let mountGeneration = 0;
let pendingMountDocument: VisualDocument | null = null;
let pendingMountRecoveryState: string | null = null;
let backupTimer: number | null = null;
let pendingBackupIdleHandle: ReturnType<typeof setTimeout> | number | null = null;
let mountThemeReapplyCleanup: (() => void) | null = null;
let workspaceFilterAbortController: AbortController | null = null;
let workspaceFilterRenderTimer: number | null = null;
let workspaceFilterRenderQueued = false;
let lastFileMenuStateKey: string | null = null;
const BACKUP_INTERVAL_MS = 5 * 60 * 1000;
const BACKUP_DEBOUNCE_MS = 1500;
const MIN_BACKUP_SPACING_MS = 60 * 1000;
const DEFAULT_AI_MAX_CONTEXT_CHARS = 40_000;
const AI_MIN_CONTEXT_CHARS = 1_000;
const AI_MAX_CONTEXT_CHARS = 750_000;
const AI_CONTEXT_STEP_CHARS = 1_000;

interface MountScrollRatio {
  top: number;
  left: number;
  topPosition: number;
  leftPosition: number;
}

interface DocumentSession {
  path: string;
  name: string;
  extension: DocumentFile['extension'];
  mode: HvyMode;
  dirty: boolean;
  readOnly: boolean;
  hiddenFromAI: boolean;
  isNew: boolean;
  metaOpen: boolean;
  document: VisualDocument;
  recoveryState: string | null;
  recoveryBackupId: string | null;
}

type PreparedImportSource = ImportSourceFile & { text: string };
const documentSessions = new Map<string, DocumentSession>();
const workspaceFilterDocumentCache = new Map<string, VisualDocument>();
const backupSnapshots = new Map<string, { bytesKey: string; createdAtMs: number }>();
let openedDocumentTabOrder: string[] = [];

const handlers: UiHandlers = {
  newWorkspace: () => {
    state.openWorkspaceActionsPath = null;
    state.newWorkspaceDialogOpen = true;
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
  setNewWorkspaceLocation: (location) => {
    state.newWorkspaceLocation = location;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  cancelNewWorkspace: () => {
    state.newWorkspaceDialogOpen = false;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  newDocumentInWorkspace: (workspacePath) => {
    state.openWorkspaceActionsPath = null;
    state.newDocumentWorkspacePath = workspacePath;
    state.newDocumentType = 'hvy';
    state.importWorkspacePath = null;
    state.importIntoCurrentDialogOpen = false;
    state.importSource = null;
    state.status = 'Ready';
    void refreshSavedTemplates(workspacePath).then(() => rerender({ preserveMountedDocument: true }));
    rerender({ preserveMountedDocument: true });
    requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>('input[name="documentName"]')?.focus();
    });
  },
  setNewDocumentType: (type) => {
    state.newDocumentType = type;
    rerender({ preserveMountedDocument: true });
  },
  createDocumentInWorkspace: (name, templateId) => void runBusy('Creating document...', async () => {
    const workspacePath = state.newDocumentWorkspacePath;
    const fileName = documentFileName(name, state.newDocumentType);
    if (!workspacePath) return;
    if (!fileName) {
      state.status = 'Document name is required';
      return;
    }
    const template = creationTemplate(workspacePath, state.newDocumentType, templateId, documentTitle(fileName));
    state.newDocumentWorkspacePath = null;
    const file = await createDocumentFile({
      workspacePath,
      relativePath: fileName,
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
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  openImportInWorkspace: (workspacePath) => {
    state.openWorkspaceActionsPath = null;
    state.newDocumentWorkspacePath = null;
    state.importWorkspacePath = workspacePath;
    state.importDocumentType = 'hvy';
    state.importIntoCurrentDialogOpen = false;
    state.importSourceTab = 'anywhere';
    state.importSource = null;
    state.importExcludeTags = '';
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
    state.importExcludeTags = '';
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  })(),
  setImportSourceTab: (tab) => {
    state.importSourceTab = tab;
    state.importSource = null;
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
    state.status = `Selected ${file.name}`;
  }, { preserveMountedDocument: true }),
  chooseImportSource: () => void runBusy('Choosing import source...', async () => {
    const source = await openImportSourceDialog();
    if (!source) {
      state.status = 'Ready';
      return;
    }
    state.importSource = source;
    state.status = `Selected ${source.name}`;
  }),
  createImportedDocument: (name, templateId, instructions, pastedSourceText, excludeTags) => void runBusy('Importing document...', async () => {
    const workspacePath = state.importWorkspacePath;
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
    state.importSource = null;
    state.importExcludeTags = '';
    state.importProgressDialogOpen = true;
    rerender({ preserveMountedDocument: true });
    try {
    const file = await createDocumentFile({
      workspacePath,
      relativePath: fileName,
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
      instructions,
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
      instructions,
      steps: plan.steps,
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
    const bytes = Array.from(serializeMountedDocument(state.document.mounted));
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
  importIntoCurrent: (instructions, pastedSourceText, excludeTags, outputMode, outputName) => void runBusy('Importing into current document...', async () => {
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
    state.importExcludeTags = '';
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
          instructions,
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
          instructions,
          steps: plan.steps,
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
    state.importIntoCurrentDialogOpen = false;
    state.importSourceTab = 'workspace';
    state.importOutputMode = 'current';
    state.importSource = null;
    state.importExcludeTags = '';
    state.importProgressDialogOpen = false;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  addFilesToWorkspace: (workspacePath) => void runBusy('Adding files...', async () => {
    state.openWorkspaceActionsPath = null;
    const result = await addFilesToWorkspace(workspacePath);
    if (!result) return;
    await finishAddingFilesToWorkspace(result, 'Added files to workspace');
    await refreshRecents();
  }),
  addDroppedFilesToWorkspace: (workspacePath, files) => void runBusy('Adding files...', async () => {
    const droppedFiles = await droppedWorkspaceFilesFrom(files);
    const result = await addDroppedFilesToWorkspace(workspacePath, droppedFiles);
    await finishAddingFilesToWorkspace(result, 'Added dropped files to workspace');
    await refreshRecents();
  }),
  openWorkspaceFilter: (workspacePath) => {
    closeUiBeforeWorkspaceFilter();
    const activeFilter = state.workspaceFilters[workspacePath];
    state.workspaceFilter.workspacePath = workspacePath;
    state.workspaceFilter.open = true;
    state.workspaceFilter.error = null;
    state.workspaceFilter.status = null;
    state.workspaceFilter.queryDraft = activeFilter?.query ?? '';
    state.workspaceFilter.submittedQuery = activeFilter?.query ?? '';
    state.workspaceFilter.mode = activeFilter?.mode ?? 'keyword';
    state.workspaceFilter.filterMode = activeFilter?.filterMode ?? 'deprioritize';
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
  setWorkspaceExpanded: (workspacePath, expanded) => {
    state.workspaceExpanded[workspacePath] = expanded;
  },
  closeWorkspaceFilter: () => {
    state.workspaceFilter.open = false;
    state.workspaceFilter.isLoading = false;
    state.workspaceFilter.status = null;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
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
  openAbout: () => {
    closeUiBeforeAbout();
    state.aboutDialogOpen = true;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  closeAbout: () => {
    state.aboutDialogOpen = false;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  openAiSettings: () => {
    closeUiBeforeAiSettings();
    state.aiSettingsDraft = cloneAiSettings(state.aiSettings);
    state.aiSettingsDialogInitialJson = JSON.stringify(canonicalAiSettings(state.aiSettingsDraft));
    state.aiSettingsDialogOpen = true;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  selectAiProvider: (providerId, settings) => {
    state.aiSettingsDraft = {
      ...settings,
      activeProviderId: providerId,
    };
    rerender({ preserveMountedDocument: true });
  },
  openProviderDocs: (url) => {
    void openExternalUrl(url)
      .then(() => {
        state.status = 'Opened setup instructions';
      })
      .catch((error) => {
        state.error = error instanceof Error ? error.message : String(error);
        state.status = 'Ready';
        rerender();
        void mountCurrentDocument();
      });
  },
  saveAiSettings: (settings) => void runBusy('Saving AI settings...', async () => {
    state.aiSettings = await saveAiSettings(settings);
    installAiChatClient(state.aiSettings);
    state.aiSettingsDialogOpen = false;
    state.aiSettingsDraft = null;
    state.aiSettingsDialogInitialJson = null;
    state.status = 'Saved AI settings';
  }),
  cancelAiSettings: (settings) => {
    if (!confirmDiscardAiSettings(settings)) return;
    state.aiSettingsDialogOpen = false;
    state.aiSettingsDraft = null;
    state.aiSettingsDialogInitialJson = null;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  openMcpSettings: () => {
    closeUiBeforeMcpSettings();
    state.mcpSettingsDraft = cloneMcpSettings(state.mcpSettings);
    state.mcpSettingsDialogInitialJson = JSON.stringify(state.mcpSettingsDraft);
    state.mcpSettingsDialogOpen = true;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
    void refreshMcpClientInstallStatus();
  },
  saveMcpSettings: (settings) => void runBusy('Saving MCP settings...', async () => {
    state.mcpSettings = await saveMcpSettings(settings);
    state.mcpSettingsDialogOpen = false;
    state.mcpSettingsDraft = null;
    state.mcpSettingsDialogInitialJson = null;
    state.status = 'Saved MCP settings';
  }),
  cancelMcpSettings: (settings) => {
    if (!confirmDiscardMcpSettings(settings)) return;
    state.mcpSettingsDialogOpen = false;
    state.mcpSettingsDraft = null;
    state.mcpSettingsDialogInitialJson = null;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  startMcpServer: () => void runBusy('Starting MCP server...', async () => {
    state.mcpServerStatus = await startMcpServer();
    state.status = state.mcpServerStatus.message;
  }),
  stopMcpServer: () => void runBusy('Stopping MCP server...', async () => {
    state.mcpServerStatus = await stopMcpServer();
    state.status = state.mcpServerStatus.message;
  }),
  restartMcpServer: () => void runBusy('Restarting MCP server...', async () => {
    await stopMcpServer();
    state.mcpServerStatus = await startMcpServer();
    state.status = state.mcpServerStatus.message;
  }),
  installMcpClient: (target: McpClientInstallTarget) => void runBusy('Installing MCP client config...', async () => {
    state.mcpClientInstallStatus = await installMcpClient(target);
    const client = state.mcpClientInstallStatus.find((status) => status.target === target);
    state.status = client?.message ?? 'Installed MCP client config';
  }),
  removeMcpClient: (target: McpClientInstallTarget) => void runBusy('Removing MCP client config...', async () => {
    state.mcpClientInstallStatus = await removeMcpClient(target);
    const client = state.mcpClientInstallStatus.find((status) => status.target === target);
    state.status = client?.message ?? 'Removed MCP client config';
  }),
  restoreMcpClientBackup: (target: McpClientInstallTarget) => void runBusy('Restoring MCP client config...', async () => {
    state.mcpClientInstallStatus = await restoreMcpClientBackup(target);
    const client = state.mcpClientInstallStatus.find((status) => status.target === target);
    state.status = client?.message ?? 'Restored MCP client config backup';
  }),
  copyMcpConnectionUrl: (url) => void copyMcpConnectionUrl(url),
  copyMcpBearerToken: (token) => void copyMcpBearerToken(token),
  copyMcpSetupValue: (value, label) => void copyMcpSetupValue(value, label),
  openColorTheme: () => {
    closeUiBeforeColorTheme();
    state.colorThemeDialogOpen = true;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  closeColorTheme: () => {
    state.colorThemeDialogOpen = false;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  updateColorThemeName: (name) => {
    state.colorTheme = { ...state.colorTheme, themeName: name };
    saveColorThemeSettings(state.colorTheme);
  },
  saveColorTheme: () => {
    const name = state.colorTheme.themeName.trim() || currentThemeDisplayName() || 'Untitled Theme';
    const matchedThemeId = getMatchedSavedThemeId(state.colorTheme.colors, state.colorTheme.savedThemes);
    const now = Date.now();
    const savedThemes = [...state.colorTheme.savedThemes];
    const existingIndex = savedThemes.findIndex((theme) => theme.id === matchedThemeId || theme.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0);
    if (existingIndex >= 0) {
      savedThemes[existingIndex] = { ...savedThemes[existingIndex], name, colors: { ...state.colorTheme.colors }, lastUsedAt: now };
    } else {
      savedThemes.push({ id: createSavedThemeId(), name, colors: { ...state.colorTheme.colors }, lastUsedAt: now });
    }
    state.colorTheme = { ...state.colorTheme, themeName: name, savedThemes };
    persistAndApplyColorTheme();
    rerender({ preserveMountedDocument: true });
  },
  exportColorTheme: () => void runBusy('Exporting theme...', async () => {
    const theme = createColorThemeFile(state.colorTheme.themeName || currentThemeDisplayName() || 'Untitled Theme', state.colorTheme.colors);
    const bytes = Array.from(new TextEncoder().encode(serializeColorThemeFile(theme)));
    await saveColorThemeAsDialog({ suggestedName: themeSuggestedFileName(theme.name), bytes });
    state.colorThemeDialogOpen = true;
    state.status = `Exported theme ${theme.name}`;
  }),
  importColorTheme: () => void runBusy('Importing theme...', async () => {
    const file = await openColorThemeDialog();
    if (!file) {
      state.colorThemeDialogOpen = true;
      return;
    }
    const theme = parseColorThemeFile(new TextDecoder().decode(new Uint8Array(file.bytes)));
    const now = Date.now();
    const savedThemes = [...state.colorTheme.savedThemes];
    const existingIndex = savedThemes.findIndex((saved) => saved.name.localeCompare(theme.name, undefined, { sensitivity: 'accent' }) === 0);
    if (existingIndex >= 0) {
      savedThemes[existingIndex] = { ...savedThemes[existingIndex], colors: theme.colors, lastUsedAt: now };
    } else {
      savedThemes.push({ id: createSavedThemeId(), name: theme.name, colors: theme.colors, lastUsedAt: now });
    }
    state.colorTheme = {
      colors: theme.colors,
      themeName: theme.name,
      savedThemes,
      themeUses: state.colorTheme.themeUses,
    };
    persistAndApplyColorTheme();
    state.colorThemeDialogOpen = true;
    state.status = `Imported theme ${theme.name}`;
  }),
  selectColorTheme: (id) => {
    const now = Date.now();
    if (id === 'default') {
      state.colorTheme = {
        ...state.colorTheme,
        colors: {},
        themeName: 'Default',
        themeUses: { ...state.colorTheme.themeUses, default: now },
      };
    } else if (id.startsWith('palette:')) {
      const palette = getPaletteById(id.slice('palette:'.length));
      if (!palette) return;
      state.colorTheme = {
        ...state.colorTheme,
        colors: { ...palette.colors },
        themeName: palette.name,
        themeUses: { ...state.colorTheme.themeUses, [id]: now },
      };
    } else if (id.startsWith('custom:')) {
      const themeId = id.slice('custom:'.length);
      const savedThemes = state.colorTheme.savedThemes.map((theme) => theme.id === themeId ? { ...theme, lastUsedAt: now } : theme);
      const theme = savedThemes.find((item) => item.id === themeId);
      if (!theme) return;
      state.colorTheme = {
        ...state.colorTheme,
        colors: { ...theme.colors },
        themeName: theme.name,
        savedThemes,
      };
    }
    persistAndApplyColorTheme();
    rerender({ preserveMountedDocument: true });
  },
  deleteColorTheme: (id) => {
    if (!id.startsWith('custom:')) return;
    const themeId = id.slice('custom:'.length);
    state.colorTheme = {
      ...state.colorTheme,
      savedThemes: state.colorTheme.savedThemes.filter((theme) => theme.id !== themeId),
    };
    saveColorThemeSettings(state.colorTheme);
    rerender({ preserveMountedDocument: true });
  },
  updateColorTheme: (name, value) => {
    if (!isCssVariableName(name)) return;
    const next = { ...state.colorTheme.colors };
    if (value.trim()) {
      next[name] = value.trim();
    } else {
      delete next[name];
    }
    state.colorTheme = { ...state.colorTheme, colors: next };
    persistAndApplyColorTheme();
    updateThemeRowChrome(name, next[name] ?? '');
  },
  resetColorTheme: (name) => {
    const next = { ...state.colorTheme.colors };
    delete next[name];
    state.colorTheme = { ...state.colorTheme, colors: next };
    persistAndApplyColorTheme();
    rerender({ preserveMountedDocument: true });
  },
  applyColorThemePalette: (id) => {
    const palette = id ? getPaletteById(id) : null;
    const themeUseId = id ? `palette:${id}` : 'default';
    state.colorTheme = {
      colors: palette ? { ...palette.colors } : {},
      themeName: palette?.name ?? '',
      savedThemes: state.colorTheme.savedThemes,
      themeUses: { ...state.colorTheme.themeUses, [themeUseId]: Date.now() },
    };
    persistAndApplyColorTheme();
    rerender({ preserveMountedDocument: true });
  },
  restoreBackup: (id) => void runBusy('Restoring unsaved edits...', async () => {
    const file = await restoreDocumentBackup(id);
    if (file.path) {
      documentSessions.delete(file.path);
      workspaceFilterDocumentCache.delete(file.path);
      backupSnapshots.delete(backupDocumentKey(file.path, file.name));
    }
    state.recoveryDialogOpen = false;
    state.recoveryBackups = [];
    await openDocument(file, { recovered: true, deferMount: true, recoveryBackupId: id });
  }),
  discardBackup: (id) => void runBusy('Discarding recovery draft...', async () => {
    const backup = state.recoveryBackups.find((candidate) => candidate.id === id);
    await discardDocumentBackup(id);
    if (backup) {
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
  cancelCloseDocument: () => {
    state.closeDocumentDialogOpen = false;
    state.closeDocumentDraftDialogOpen = false;
    state.closeDocumentTargetPath = null;
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
      ? await loadWorkspace(candidate.path)
      : await confirmWorkspaceInitialization(candidate.path, candidate.defaultName);
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
  openRecentWorkspace: (path) => void runBusy('Opening recent workspace...', async () => {
    upsertWorkspace(await loadWorkspace(path));
    state.selectedWorkspacePath = path;
    await refreshRecents();
    await refreshArchivedWorkspaces();
    rerender();
  }),
  openRecentFile: (path) => void runBusy('Opening recent file...', async () => {
    await openDocument(await readDocumentFile(path), { deferMount: true });
    await refreshRecents();
  }),
  selectFile: (path) => void runBusy('Opening file...', async () => {
    const access = workspaceFileAiAccess(path);
    await openDocument(await readDocumentFile(path), { deferMount: true, readOnly: access.readOnly, hiddenFromAI: access.hiddenFromAI });
    await refreshRecents();
  }),
  refreshWorkspace: (path) => void runBusy('Refreshing workspace...', async () => {
    upsertWorkspace(await loadWorkspace(path));
    state.selectedWorkspacePath = path;
    await refreshRecents();
  }),
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
    upsertWorkspace(await loadWorkspace(workspace.path));
    if (state.selectedFilePath === path) state.selectedFilePath = null;
    syncOpenDocumentWorkspaceAccess(path);
    await refreshSavedTemplates(workspace.path);
    state.status = `Archived ${currentName}`;
  }),
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
      documentSessions.delete(path);
      workspaceFilterDocumentCache.delete(path);
      removeDocumentTabPath(path);
      backupSnapshots.delete(backupDocumentKey(path, name));
      if (state.selectedFilePath === path) state.selectedFilePath = null;
      if (state.document?.path === path) {
        state.document = null;
        pendingMountDocument = null;
        pendingMountRecoveryState = null;
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
  copyWorkspaceFile: (path, currentName) => {
    state.workspaceClipboard = { mode: 'copy', path, name: currentName };
    state.status = `Copied ${currentName}`;
    rerender({ preserveMountedDocument: true });
    void writeSystemFileClipboard({ paths: [path], operation: 'copy' }).catch((error) => {
      state.status = `Copied in HVY, but could not copy to Finder: ${error instanceof Error ? error.message : String(error)}`;
      rerender({ preserveMountedDocument: true });
    });
  },
  cutWorkspaceFile: (path, currentName) => {
    state.workspaceClipboard = { mode: 'cut', path, name: currentName };
    state.status = `Cut ${currentName}`;
    rerender({ preserveMountedDocument: true });
    void writeSystemFileClipboard({ paths: [path], operation: 'cut' }).catch((error) => {
      state.status = `Cut in HVY, but could not copy to Finder: ${error instanceof Error ? error.message : String(error)}`;
      rerender({ preserveMountedDocument: true });
    });
  },
  pasteWorkspaceClipboard: (workspacePath) => {
    const clipboard = state.workspaceClipboard;
    void runBusy(`${clipboard?.mode === 'cut' ? 'Moving' : 'Copying'} file...`, async () => {
      if (!clipboard) {
        const result = await pasteSystemFilesToWorkspace(workspacePath);
        await finishAddingFilesToWorkspace(result, `Pasted ${result.copiedPaths.length} file${result.copiedPaths.length === 1 ? '' : 's'}`);
        return;
      }
      if (clipboard.mode === 'copy') {
        const file = await copyDocumentToWorkspace({ path: clipboard.path, workspacePath });
        upsertWorkspace(await loadWorkspace(workspacePath));
        state.selectedWorkspacePath = workspacePath;
        state.status = `Pasted ${file.name}`;
        await refreshRecents();
        return;
      }
      await moveOpenWorkspaceFileToWorkspace(clipboard.path, workspacePath);
      state.workspaceClipboard = null;
    });
  },
  copyFileToWorkspace: (path, currentName) => {
    openWorkspaceTransfer('copyFile', currentName, path, workspacePathForFile(path));
  },
  moveFileToWorkspace: (path, currentName) => {
    openWorkspaceTransfer('moveFile', currentName, path, workspacePathForFile(path));
  },
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
      const workspacePath = workspacePathForFile(path);
      const currentDocument = state.document?.path === path ? state.document : null;
      const mountedDocument = currentDocument?.mounted?.document ?? pendingMountDocument;
      const oldBackupKey = currentDocument ? backupDocumentKey(currentDocument.path, currentDocument.name) : null;
      const file = await renameDocumentFile({ path, name: trimmed });
      const renamedOpenTemplateMetadata = Boolean(
        currentDocument
        && mountedDocument
        && isWorkspaceTemplatePath(state, path)
        && syncRenamedTemplateMetadata(mountedDocument, currentStem, documentTitle(file.name))
      );
      documentSessions.delete(path);
      renameDocumentTabPath(path, file.path);
      if (state.selectedFilePath === path) {
        state.selectedFilePath = file.path;
      }
      if (currentDocument) {
        currentDocument.path = file.path;
        currentDocument.name = file.name;
        currentDocument.extension = file.extension;
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
        if (oldBackupKey) {
          const backup = backupSnapshots.get(oldBackupKey);
          if (backup) {
            backupSnapshots.delete(oldBackupKey);
            backupSnapshots.set(backupDocumentKey(file.path, file.name), backup);
          }
        }
      }
      if (workspacePath) {
        upsertWorkspace(await loadWorkspace(workspacePath));
      } else {
        await refreshOpenWorkspaceForFile(file.path);
      }
      await refreshRecents();
      state.status = `Renamed to ${file.name}`;
    });
  },
  cancelRenameFile: () => {
    state.renameFilePath = null;
    state.renameFileCurrentName = null;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  saveCurrentToWorkspace: () => {
    if (!currentDocumentCanSaveToWorkspace()) return;
    openWorkspaceTransfer('saveCurrent', state.document!.name, null, currentDocumentWorkspacePath(state));
  },
  submitWorkspaceTransfer: (workspacePath, name) => {
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
        await saveCurrentDocumentToWorkspace(workspacePath, transfer.nameDraft);
        return;
      }
      if (!transfer.sourcePath) return;
      if (transfer.mode === 'copyFile') {
        const file = await copyDocumentToWorkspace({ path: transfer.sourcePath, workspacePath });
        upsertWorkspace(await loadWorkspace(workspacePath));
        state.status = `Copied to ${file.name}`;
        await refreshRecents();
        return;
      }
      await moveOpenWorkspaceFileToWorkspace(transfer.sourcePath, workspacePath);
    });
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
    const scrollRatio = captureMountScrollRatio(mountRoot);
    state.document.mode = mode;
    state.document.metaOpen = false;
    if (document) {
      updateCurrentDocumentSession(document);
    }
    rerender();
    void mountCurrentDocument(document).then(() => restoreMountScrollRatio(mountRoot, scrollRatio));
  },
  openDocumentMeta: () => {
    if (!state.document) return;
    if (state.document.readOnly) {
      state.status = 'The HVY guide is read-only';
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
    if (kind === 'template' && state.document?.extension === '.md') return;
    state.saveAsKind = kind;
    state.error = null;
    rerender({ preserveMountedDocument: true });
  },
  setSaveAsScope: (scope) => {
    if (scope === 'workspace' && state.workspaces.length === 0) return;
    state.saveAsScope = scope;
    rerender({ preserveMountedDocument: true });
  },
  saveAsToWorkspace: (workspacePath, name) => {
    if (!workspacePath || !name.trim()) {
      state.status = 'Document name is required';
      rerender({ preserveMountedDocument: true });
      return;
    }
    state.saveAsDialogOpen = false;
    void runBusy('Saving as...', async () => {
      await saveCurrentDocumentToWorkspace(workspacePath, name.trim());
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
    if (!state.document || state.document.readOnly || state.document.extension === '.md') return;
    await ensureCurrentDocumentMounted();
    if (!state.document?.mounted) return;
    state.saveAsDialogOpen = true;
    state.saveAsKind = 'template';
    state.saveTemplateScope = workspacePathForFile(state.document.path) ? 'workspace' : 'app';
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
    if (scope === 'workspace' && !workspacePathForFile(state.document?.path ?? '')) return;
    state.saveTemplateScope = scope;
    state.error = null;
    rerender({ preserveMountedDocument: true });
  },
  saveAsTemplate: (name, scope, extension: TemplateExtension) => void runBusy('Saving template...', async () => {
    if (!state.document || state.document.readOnly || state.document.extension === '.md') return;
    await ensureCurrentDocumentMounted();
    if (!state.document?.mounted) return;
    const workspacePath = scope === 'workspace' ? workspacePathForFile(state.document.path) : null;
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
  openWorkspaceTemplateVisibility: (workspacePath) => {
    state.openWorkspaceActionsPath = null;
    state.workspaceTemplateVisibilityPath = workspacePath;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  saveWorkspaceTemplateVisibility: (workspacePath, templateVisibility) => void runBusy('Saving template visibility...', async () => {
    if (!workspacePath) return;
    const workspace = await updateWorkspaceTemplateVisibility(workspacePath, templateVisibility);
    upsertWorkspace(workspace);
    state.workspaceTemplateVisibilityPath = null;
    state.status = 'Saved template visibility';
  }, { preserveMountedDocument: true }),
  cancelWorkspaceTemplateVisibility: () => {
    state.workspaceTemplateVisibilityPath = null;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  createFile: () => {
    const workspacePath = state.selectedWorkspacePath ?? state.workspaces[0]?.path ?? null;
    if (workspacePath) {
      handlers.newDocumentInWorkspace(workspacePath);
      return;
    }
    void createBlankDocument();
  },
  closeDocument: () => void closeCurrentDocument(),
};

let findShortcutBound = false;

void boot();

async function boot(): Promise<void> {
  setupErrorSurface();
  try {
    mountRoot = render(state, handlers);
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
    await loadRecentWorkspaces();
    await refreshSavedTemplates(state.selectedWorkspacePath);
    mountRoot = render(state, handlers);
    syncFileMenuState({ force: true });
    await openRecoveryDialogOnBoot();
    startBackupTimer();
    setupRecoveryLifecycle();
    await onAppCloseRequest(() => {
      void handleAppCloseRequest();
    });
    await onMenuEvent((event) => {
      if (event === 'new-workspace') handlers.newWorkspace();
      if (event === 'manage-workspaces') handlers.openWorkspaceManager();
      if (event === 'open-workspace') handlers.openWorkspace();
      if (event === 'open-file') handlers.openFile();
      if (event === 'find') openMountedSearch();
      if (event === 'bold') performBold();
      if (event === 'undo') performUndo();
      if (event === 'redo') performRedo();
      if (event === 'open-guide') void openGuide();
      if (event === 'about') handlers.openAbout();
      if (event === 'ai-settings') handlers.openAiSettings();
      if (event === 'mcp-settings') handlers.openMcpSettings();
      if (event === 'colors') handlers.openColorTheme();
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
    for (const path of await loadLaunchDocumentPaths()) {
      await openLaunchDocumentPath(path);
    }
  } catch (error) {
    showStartupError(error);
  }
}

function bindFindShortcut(): void {
  if (findShortcutBound) return;
  findShortcutBound = true;
  document.addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'f') return;
    if (state.document?.mode === 'hvy' && currentMountRoot()?.querySelector('.raw-hvy-shell')) return;
    if (!openMountedSearch()) return;
    event.preventDefault();
    event.stopPropagation();
  }, { capture: true });
}

function openMountedSearch(): boolean {
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

function performBold(): void {
  const root = currentMountRoot();
  const rawShell = root?.querySelector<HTMLElement>('.raw-hvy-shell');
  if (rawShell) {
    rawShell.dispatchEvent(new CustomEvent('hvy:toggle-raw-bold'));
    return;
  }
  const editable = getActiveRichEditable();
  if (!editable || !root) return;
  const sectionKey = editable.dataset.sectionKey ?? '';
  const blockId = editable.dataset.blockId ?? '';
  const field = editable.dataset.field ?? '';
  const selector = [
    '[data-rich-action="bold"]',
    sectionKey ? `[data-section-key="${cssEscape(sectionKey)}"]` : '',
    blockId ? `[data-block-id="${cssEscape(blockId)}"]` : '',
    field ? `[data-field="${cssEscape(field)}"]` : '',
  ].join('');
  const button =
    root.querySelector<HTMLButtonElement>(selector) ??
    editable.closest<HTMLElement>('.editor-block, .table-inline-edit-shell')?.querySelector<HTMLButtonElement>('[data-rich-action="bold"]');
  button?.click();
}

function currentMountRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#hvyMount') ?? mountRoot;
}

function getActiveRichEditable(): HTMLElement | null {
  const target = document.activeElement;
  if (!(target instanceof HTMLElement) || !target.closest('#hvyMount')) return null;
  if (target.isContentEditable && target.dataset.field) return target;
  return target.closest<HTMLElement>('[contenteditable="true"][data-field]');
}

function performUndo(): void {
  if (routeNativeEditCommand('undo')) return;
  const mounted = state.document?.mounted;
  if (!mounted) return;
  undoMountedDocument(mounted);
}

function performRedo(): void {
  if (routeNativeEditCommand('redo')) return;
  const mounted = state.document?.mounted;
  if (!mounted) return;
  redoMountedDocument(mounted);
}

function routeNativeEditCommand(command: 'undo' | 'redo'): boolean {
  const target = document.activeElement;
  if (!(target instanceof HTMLElement)) return false;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)) return false;
  if (target.closest('#hvyMount') && target.isContentEditable && !document.queryCommandEnabled(command)) return false;
  document.execCommand(command);
  return true;
}

function applyAppColorTheme(root: HTMLElement | null = mountRoot): void {
  applyColorTheme(state.colorTheme, root);
}

async function refreshRecents(): Promise<void> {
  state.recent = await loadRecentState();
}

async function refreshArchivedWorkspaces(): Promise<void> {
  state.archivedWorkspaces = await loadArchivedWorkspaces();
}

async function refreshMcpClientInstallStatus(): Promise<void> {
  try {
    state.mcpClientInstallStatus = await loadMcpClientInstallStatus();
    rerender({ preserveMountedDocument: true });
  } catch {
    // The modal still shows the manual config if client detection is unavailable.
  }
}

async function loadRecentWorkspaces(): Promise<void> {
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

async function openDefaultGuide(options: { force?: boolean } = {}): Promise<void> {
  if (!options.force && (state.document || state.selectedFilePath)) return;
  try {
    await openDocument(await loadDefaultGuide(), { defaultDocument: true });
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = 'Could not load HVY guide';
    mountRoot = render(state, handlers);
  }
}

async function openGuide(): Promise<void> {
  await runBusy('Opening HVY guide...', async () => {
    await openDefaultGuide({ force: true });
  });
}

async function submitWorkspaceFilter(): Promise<void> {
  if (state.workspaceFilter.isLoading) {
    workspaceFilterAbortController?.abort();
    state.workspaceFilter.status = 'Stopping filter...';
    state.status = 'Stopping filter...';
    rerender({ preserveMountedDocument: true });
    return;
  }
  const workspacePath = state.workspaceFilter.workspacePath;
  const query = state.workspaceFilter.queryDraft.trim();
  state.workspaceFilter.submittedQuery = query;
  state.workspaceFilter.error = null;
  state.workspaceFilter.status = null;
  if (!workspacePath || !state.workspaces.some((workspace) => workspace.path === workspacePath)) {
    state.workspaceFilter.error = 'Open a workspace before filtering.';
    rerender({ preserveMountedDocument: true });
    return;
  }
  if (!query) {
    delete state.workspaceFilters[workspacePath];
    clearWorkspaceFilterDocumentCache(workspacePath);
    await applyWorkspaceFilterToCurrentDocument();
    rerender({ preserveMountedDocument: true });
    return;
  }

  state.workspaceFilter.isLoading = true;
  const abortController = new AbortController();
  workspaceFilterAbortController = abortController;
  rerender({ preserveMountedDocument: true });
  try {
    preserveCurrentDocumentSession();
    const workspace = state.workspaces.find((candidate) => candidate.path === workspacePath);
    if (!workspace) {
      throw new Error('Open a workspace before filtering.');
    }
    const documents = await buildWorkspaceFilterDocuments(workspace);
    const snapshots = await createWorkspaceFilterSnapshots(documents, {
      query,
      mode: state.workspaceFilter.mode,
      filterMode: state.workspaceFilter.filterMode,
      signal: abortController.signal,
    });
    const config: WorkspaceFilterConfig = {
      query,
      mode: state.workspaceFilter.mode,
      filterMode: state.workspaceFilter.filterMode,
      snapshots,
    };
    state.workspaceFilters[workspacePath] = config;
    cacheWorkspaceFilterDocuments(workspacePath, documents);
    await applyWorkspaceFilterToCurrentDocument();
    state.workspaceFilter.open = false;
    state.workspaceFilter.error = null;
    state.workspaceFilter.status = null;
    state.status = `Filtered ${workspaceNameForPath(workspacePath)}`;
  } catch (error) {
    state.workspaceFilter.error = isAbortError(error) ? null : error instanceof Error ? error.message : String(error);
    state.workspaceFilter.status = null;
    state.status = isAbortError(error) ? 'Filter stopped' : 'Ready';
  } finally {
    if (workspaceFilterAbortController === abortController) {
      workspaceFilterAbortController = null;
    }
    cancelWorkspaceFilterProgressRender();
    state.workspaceFilter.isLoading = false;
    rerender({ preserveMountedDocument: true });
  }
}

async function clearWorkspaceFilter(): Promise<void> {
  const workspacePath = state.workspaceFilter.workspacePath;
  if (!workspacePath) return;
  delete state.workspaceFilters[workspacePath];
  clearWorkspaceFilterDocumentCache(workspacePath);
  state.workspaceFilter.submittedQuery = '';
  state.workspaceFilter.error = null;
  state.workspaceFilter.status = null;
  state.workspaceFilter.open = false;
  await applyWorkspaceFilterToCurrentDocument();
  state.status = `Cleared filter for ${workspaceNameForPath(workspacePath)}`;
  rerender({ preserveMountedDocument: true });
}

async function applyWorkspaceFilterToCurrentDocument(): Promise<void> {
  const openDocument = state.document;
  const document = openDocument?.mounted?.document ?? pendingMountDocument;
  if (!openDocument || !document) return;
  const snapshot = await createWorkspaceFilterSnapshotForDocument(openDocument.path, openDocument.name, document);
  if (openDocument.mounted) {
    setMountedSearchSnapshot(openDocument.mounted, snapshot);
    applyAppColorTheme();
  }
}

async function createWorkspaceFilterSnapshotForDocument(
  path: string,
  name: string,
  document: VisualDocument,
) {
  void name;
  void document;
  const workspacePath = workspacePathForFile(path);
  if (workspaceFileAiAccess(path).hiddenFromAI) {
    return null;
  }
  const filter = workspacePath ? state.workspaceFilters[workspacePath] : null;
  if (!filter || !filter.query.trim()) {
    return null;
  }
  return findWorkspaceFilterSnapshot(filter, path);
}

function findWorkspaceFilterSnapshot(filter: WorkspaceFilterConfig, path: string) {
  const direct = filter.snapshots[path];
  if (direct) return direct;
  const workspacePath = workspacePathForFile(path);
  const candidates = new Set([
    normalizeFilePath(path),
    ...(workspacePath ? [normalizeWorkspaceRelativePath(path, workspacePath)] : []),
  ]);
  const match = Object.entries(filter.snapshots).find(([candidatePath]) => {
    const normalizedCandidate = normalizeFilePath(candidatePath);
    return candidates.has(normalizedCandidate)
      || (workspacePath ? candidates.has(normalizeWorkspaceRelativePath(candidatePath, workspacePath)) : false);
  });
  return match?.[1] ?? null;
}

function normalizeFilePath(path: string): string {
  return path.replaceAll('\\', '/');
}

function normalizeWorkspaceRelativePath(path: string, workspacePath: string): string {
  const normalizedPath = normalizeFilePath(path);
  const normalizedWorkspacePath = normalizeFilePath(workspacePath).replace(/\/+$/, '');
  return normalizedPath.startsWith(`${normalizedWorkspacePath}/`)
    ? normalizedPath.slice(normalizedWorkspacePath.length + 1)
    : normalizedPath;
}

async function createWorkspaceFilterSnapshots(
  documents: HvyDocumentSearchDocument[],
  filter: Pick<WorkspaceFilterConfig, 'query' | 'mode' | 'filterMode'> & { signal?: AbortSignal },
): Promise<WorkspaceFilterConfig['snapshots']> {
  const snapshots: WorkspaceFilterConfig['snapshots'] = {};
  for (const [index, entry] of documents.entries()) {
    const label = `Filtering ${entry.documentTitle ?? displayDocumentName(entry.documentId)} (${index + 1}/${documents.length})`;
    state.workspaceFilter.status = label;
    state.status = label;
    scheduleWorkspaceFilterProgressRender();
    const snapshot = await createHvyDocumentFilterSnapshot({
      document: entry.document,
      query: filter.query,
      mode: filter.mode,
      view: 'viewer',
      filterMode: filter.filterMode,
      traceRunId: `workspace-filter:${Date.now().toString(36)}`,
      signal: filter.signal,
      onSemanticProgress: filter.mode === 'semantic'
        ? (progress) => {
          state.workspaceFilter.error = null;
          state.workspaceFilter.status = `Semantic windows ${progress.completedWindows}/${progress.totalWindows}; ${progress.matchedCandidates} matches in ${entry.documentTitle ?? displayDocumentName(entry.documentId)}`;
          state.status = `Filtering ${entry.documentTitle ?? displayDocumentName(entry.documentId)} (${index + 1}/${documents.length})`;
          scheduleWorkspaceFilterProgressRender();
        }
        : undefined,
    });
    snapshots[entry.documentId] = snapshot;
  }
  return snapshots;
}

async function buildWorkspaceFilterDocuments(workspace: Awaited<ReturnType<typeof loadWorkspace>>): Promise<HvyDocumentSearchDocument[]> {
  const documents: HvyDocumentSearchDocument[] = [];
  for (const file of flattenWorkspaceFiles(workspace.files)) {
    if (file.hiddenFromAI) continue;
    const session = documentSessions.get(file.path);
    const openDocument = state.document?.path === file.path ? state.document : null;
    const liveDocument = openDocument?.mounted?.document ?? (openDocument ? pendingMountDocument : null) ?? session?.document ?? null;
    if (liveDocument) {
      documents.push({
        documentId: file.path,
        documentTitle: displayDocumentName(file.name),
        document: liveDocument,
      });
      continue;
    }
    try {
      const documentFile = await readDocumentFile(file.path);
      documents.push({
        documentId: file.path,
        documentTitle: displayDocumentName(documentFile.name),
        document: await deserializeHvy(new Uint8Array(documentFile.bytes), documentFile.extension),
      });
    } catch {
      // Keep workspace filtering resilient if one file was moved, deleted, or cannot be parsed.
    }
  }
  return documents;
}

function flattenWorkspaceFiles(nodes: WorkspaceTreeNode[]): WorkspaceFileNode[] {
  return nodes.flatMap((node) => node.kind === 'file' ? [node] : flattenWorkspaceFiles(node.children));
}

function workspaceFileAiAccess(path: string): { archived: boolean; locked: boolean; hiddenFromAI: boolean; readOnly: boolean } {
  return workspaceFileAccessInWorkspaces(state.workspaces, path);
}

function ensureWorkspaceFileAiAccess(workspace: Workspace, path: string, access: { locked?: boolean; hiddenFromAI?: boolean }): void {
  const file = flattenWorkspaceFiles(workspace.files).find((candidate) => candidate.path === path);
  if (!file) {
    throw new Error('Updated file was not found in the workspace.');
  }
  if (typeof access.locked === 'boolean' && file.locked !== access.locked) {
    throw new Error(`Workspace did not ${access.locked ? 'lock' : 'unlock'} the file.`);
  }
  if (typeof access.hiddenFromAI === 'boolean' && file.hiddenFromAI !== access.hiddenFromAI) {
    throw new Error(`Workspace did not ${access.hiddenFromAI ? 'hide the file from AI' : 'make the file visible to AI'}.`);
  }
}

function syncOpenDocumentAiAccess(path: string, access: { locked?: boolean; hiddenFromAI?: boolean }): void {
  syncOpenDocumentWorkspaceAccess(path, access);
}

function syncOpenDocumentWorkspaceAccess(path: string, access: { locked?: boolean; hiddenFromAI?: boolean } = {}): void {
  const workspaceAccess = workspaceFileAiAccess(path);
  const readOnly = typeof access.locked === 'boolean'
    ? access.locked || workspaceAccess.archived
    : workspaceAccess.readOnly;
  const hiddenFromAI = typeof access.hiddenFromAI === 'boolean'
    ? access.hiddenFromAI
    : workspaceAccess.hiddenFromAI;
  const session = documentSessions.get(path);
  if (session) {
    session.readOnly = readOnly;
    session.hiddenFromAI = hiddenFromAI;
    if (session.hiddenFromAI && session.mode === 'ai') session.mode = 'viewer';
  }
  if (state.document?.path !== path) return;
  state.document.readOnly = readOnly;
  state.document.hiddenFromAI = hiddenFromAI;
  if (state.document.readOnly || (state.document.hiddenFromAI && state.document.mode === 'ai')) {
    state.document.mode = 'viewer';
    void mountCurrentDocument(state.document.mounted?.document ?? pendingMountDocument ?? undefined);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function workspaceNameForPath(path: string): string {
  return state.workspaces.find((workspace) => workspace.path === path)?.manifest.name ?? 'workspace';
}

function displayDocumentName(name: string): string {
  return name.replace(/\.([tp]?hvy|md)$/i, '');
}

function importedTemplateOutputExtension(extension: DocumentExtension): DocumentExtension {
  if (extension === '.thvy') return '.hvy';
  if (extension === '.phvy') return '.phvy';
  return extension;
}

async function importSourceFrom(pastedSourceText: string): Promise<PreparedImportSource | null> {
  const pasted = pastedSourceText.trim();
  const source = state.importSource;
  if (source?.extension === '.pdf' || source?.extension === '.docx') {
    const text = pasted || source.text?.trim() || '';
    return text ? { ...source, text } : null;
  }
  if (pasted.length >= 50) {
    return { path: '', name: 'Pasted text', extension: '.txt', text: pasted };
  }
  if (!source) {
    return null;
  }
  if (source.text) {
    return { ...source, text: source.text };
  }
  if (!source.bytes || !isHvyDocumentExtension(source.extension)) {
    return null;
  }
  const document = await deserializeHvy(new Uint8Array(source.bytes), source.extension);
  return {
    ...source,
    text: await exportHvySourceMarkdown(document),
  };
}

function isHvyDocumentExtension(extension: ImportSourceFile['extension']): extension is DocumentExtension {
  return extension === '.hvy' || extension === '.thvy' || extension === '.phvy' || extension === '.md';
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function markDocumentTabOpened(path: string): void {
  openedDocumentTabOrder = [path, ...openedDocumentTabOrder.filter((candidate) => candidate !== path)];
}

function removeDocumentTabPath(path: string): void {
  openedDocumentTabOrder = openedDocumentTabOrder.filter((candidate) => candidate !== path);
}

function renameDocumentTabPath(previousPath: string, nextPath: string): void {
  openedDocumentTabOrder = openedDocumentTabOrder.map((candidate) => candidate === previousPath ? nextPath : candidate);
  markDocumentTabOpened(nextPath);
}

function getTabStackIndex(): number {
  const count = state.documentTabs.length;
  if (count === 0) return 0;
  return ((state.tabStackIndex % count) + count) % count;
}

function defaultDocumentMode(extension: DocumentFile['extension'], options: { defaultDocument?: boolean; hiddenFromAI?: boolean } = {}): HvyMode {
  if (options.defaultDocument) return 'viewer';
  if (options.hiddenFromAI && extension === '.hvy') return 'viewer';
  if (extension === '.thvy' || extension === '.phvy') return 'editor';
  if (extension === '.hvy') return 'ai';
  return 'viewer';
}

function syncDocumentTabs(): void {
  const tabs = new Map<string, { path: string; name: string; dirty: boolean; readOnly: boolean; hiddenFromAI: boolean; active: boolean }>();
  if (state.document) {
    tabs.set(state.document.path, {
      path: state.document.path,
      name: state.document.name,
      dirty: state.document.dirty,
      readOnly: state.document.readOnly,
      hiddenFromAI: state.document.hiddenFromAI,
      active: true,
    });
  }
  for (const session of documentSessions.values()) {
    if (session.readOnly || (!openedDocumentTabOrder.includes(session.path) && !session.dirty && !session.isNew)) continue;
    const active = session.path === state.document?.path;
    tabs.set(session.path, {
      path: session.path,
      name: session.name,
      dirty: active ? state.document?.dirty ?? session.dirty : session.dirty,
      readOnly: session.readOnly,
      hiddenFromAI: session.hiddenFromAI,
      active,
    });
  }
  for (const path of openedDocumentTabOrder) {
    if (tabs.has(path)) continue;
    const session = documentSessions.get(path);
    tabs.set(path, {
      path,
      name: session?.name ?? fileNameFromPath(path),
      dirty: session?.dirty ?? false,
      readOnly: session?.readOnly ?? false,
      hiddenFromAI: session?.hiddenFromAI ?? false,
      active: false,
    });
  }
  state.documentTabs = Array.from(tabs.values()).sort((left, right) => {
    const leftIndex = openedDocumentTabOrder.indexOf(left.path);
    const rightIndex = openedDocumentTabOrder.indexOf(right.path);
    return (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex);
  });
  if (state.tabStackIndex >= state.documentTabs.length) {
    state.tabStackIndex = 0;
  }
}

async function openDocument(file: DocumentFile, options: { defaultDocument?: boolean; isNew?: boolean; recovered?: boolean; deferMount?: boolean; recoveryBackupId?: string | null; readOnly?: boolean; hiddenFromAI?: boolean } = {}): Promise<void> {
  preserveCurrentDocumentSession();
  markDocumentTabOpened(file.path);
  state.document?.mounted?.mount.destroy();
  const storedSession = options.defaultDocument || options.recovered || options.isNew ? null : documentSessions.get(file.path);
  const session = storedSession?.dirty || storedSession?.isNew ? storedSession : null;
  const bytes = new Uint8Array(file.bytes);
  const cachedFilterDocument = options.defaultDocument || options.recovered || options.isNew ? null : workspaceFilterDocumentCache.get(file.path) ?? null;
  const workspaceAccess = workspaceFileAiAccess(file.path);
  const access = options.defaultDocument
    ? { locked: true, archived: false, hiddenFromAI: false, readOnly: true }
    : {
        archived: workspaceAccess.archived,
        locked: file.locked === true || workspaceAccess.locked,
        hiddenFromAI: file.hiddenFromAI === true || workspaceAccess.hiddenFromAI,
        readOnly: file.locked === true || workspaceAccess.readOnly,
      };
  const readOnly = session?.readOnly ?? (options.readOnly === true || access.readOnly || options.defaultDocument === true);
  const hiddenFromAI = session?.hiddenFromAI ?? (options.hiddenFromAI === true || access.hiddenFromAI);
  const document = session?.document ?? cachedFilterDocument ?? await deserializeHvy(bytes, file.extension);
  const recoveryState = options.recovered ? file.recoveryState ?? null : session?.recoveryState ?? null;
  state.document = {
    path: session?.path ?? file.path,
    name: session?.name ?? file.name,
    extension: session?.extension ?? file.extension,
    mode: session?.mode ?? defaultDocumentMode(file.extension, { ...options, hiddenFromAI }),
    dirty: session?.dirty ?? (options.isNew === true || options.recovered === true),
    readOnly,
    hiddenFromAI,
    isNew: session?.isNew ?? options.isNew === true,
    metaOpen: session?.metaOpen ?? false,
    mounted: null,
    recoveryBackupId: session?.recoveryBackupId ?? options.recoveryBackupId ?? null,
  };
  state.selectedFilePath = options.defaultDocument ? null : file.path;
  state.status = options.defaultDocument
    ? 'Opened HVY guide'
    : session
    ? `Restored unsaved session for ${file.name}`
    : options.recovered
    ? `Restored unsaved edits for ${file.name}`
    : options.isNew
    ? 'Created blank HVY document'
    : `Opened ${file.name}`;
  if (options.deferMount) {
    pendingMountDocument = document;
    pendingMountRecoveryState = recoveryState;
    return;
  }
  rerender();
  await mountCurrentDocument(document);
  if (recoveryState && state.document?.mounted) {
    applyMountedRecoveryState(state.document.mounted, recoveryState);
  }
}

async function openLaunchDocumentPath(path: string): Promise<void> {
  if (!path) return;
  await runBusy('Opening file...', async () => {
    await openDocument(await readDocumentFile(path), { deferMount: true });
    await refreshRecents();
  });
}

function preserveCurrentDocumentSession(): void {
  const openDocument = state.document;
  if (!openDocument?.path || openDocument.readOnly) return;
  const document = openDocument.mounted?.document ?? pendingMountDocument;
  if (!document) return;
  const dirty = openDocument.mounted
    ? openDocument.dirty || isMountedDocumentDirty(openDocument.mounted)
    : openDocument.dirty;
  documentSessions.set(openDocument.path, {
    path: openDocument.path,
    name: openDocument.name,
    extension: openDocument.extension,
    mode: openDocument.mode,
    dirty,
    readOnly: openDocument.readOnly,
    hiddenFromAI: openDocument.hiddenFromAI,
    isNew: openDocument.isNew,
    metaOpen: openDocument.metaOpen,
    document,
    recoveryState: openDocument.mounted ? getMountedRecoveryState(openDocument.mounted) : null,
    recoveryBackupId: openDocument.recoveryBackupId,
  });
}

function updateCurrentDocumentSession(document: VisualDocument): void {
  const openDocument = state.document;
  if (!openDocument?.path || openDocument.readOnly) return;
  documentSessions.set(openDocument.path, {
    path: openDocument.path,
    name: openDocument.name,
    extension: openDocument.extension,
    mode: openDocument.mode,
    dirty: openDocument.dirty,
    readOnly: openDocument.readOnly,
    hiddenFromAI: openDocument.hiddenFromAI,
    isNew: openDocument.isNew,
    metaOpen: openDocument.metaOpen,
    document,
    recoveryState: openDocument.mounted ? getMountedRecoveryState(openDocument.mounted) : null,
    recoveryBackupId: openDocument.recoveryBackupId,
  });
}

function cacheWorkspaceFilterDocuments(workspacePath: string, documents: HvyDocumentSearchDocument[]): void {
  clearWorkspaceFilterDocumentCache(workspacePath);
  for (const entry of documents) {
    workspaceFilterDocumentCache.set(entry.documentId, entry.document);
  }
}

function clearWorkspaceFilterDocumentCache(workspacePath: string): void {
  for (const path of workspaceFilterDocumentCache.keys()) {
    if (pathStartsWithWorkspace(path, workspacePath)) {
      workspaceFilterDocumentCache.delete(path);
    }
  }
}

function pathStartsWithWorkspace(path: string, workspacePath: string): boolean {
  const normalizedPath = normalizeFilePath(path);
  const normalizedWorkspacePath = normalizeFilePath(workspacePath).replace(/\/+$/, '');
  return normalizedPath === normalizedWorkspacePath || normalizedPath.startsWith(`${normalizedWorkspacePath}/`);
}

async function mountCurrentDocument(document = state.document?.mounted?.document): Promise<void> {
  if (!state.document || !mountRoot || !document) return;
  const generation = ++mountGeneration;
  const searchSnapshot = await createWorkspaceFilterSnapshotForDocument(state.document.path, state.document.name, document);
  if (generation !== mountGeneration || !state.document || !mountRoot) return;
  state.document.mounted?.mount.destroy();
  mountThemeReapplyCleanup?.();
  mountThemeReapplyCleanup = null;
  mountRoot.classList.toggle('is-hidden-from-ai', state.document.hiddenFromAI);
  const mounted = await mountHvyDocument(mountRoot, document, state.document.mode, {
    storageKey: documentStorageKey(state.document.path || state.document.name),
    searchSnapshot,
    onDocumentChange: (event) => {
      if (generation !== mountGeneration) return;
      setDocumentDirty(event.dirty);
    },
  });
  if (pendingMountRecoveryState) {
    applyMountedRecoveryState(mounted, pendingMountRecoveryState);
    pendingMountRecoveryState = null;
  }
  applyAppColorTheme();
  mountThemeReapplyCleanup = bindMountThemeReapply(mountRoot);
  state.document.mounted = mounted;
  setDocumentDirty(state.document.dirty || state.document.isNew ? true : isMountedDocumentDirty(mounted), { preserveStatus: true });
}

async function ensureCurrentDocumentMounted(): Promise<void> {
  if (!state.document || state.document.mounted) return;
  await mountCurrentDocument(pendingMountDocument ?? undefined);
}

function bindMountThemeReapply(root: HTMLElement): () => void {
  const controller = new AbortController();
  let frame = 0;
  const schedule = () => {
    if (frame) window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        applyAppColorTheme(root);
        updateDocumentStageOverlayState(root);
      });
    });
  };
  root.addEventListener('click', schedule, { signal: controller.signal });
  root.addEventListener('input', schedule, { signal: controller.signal });
  root.addEventListener('submit', schedule, { signal: controller.signal });
  root.addEventListener('keydown', schedule, { signal: controller.signal });
  const overlayObserver = new MutationObserver(schedule);
  overlayObserver.observe(root, {
    attributes: true,
    attributeFilter: ['class', 'hidden', 'style'],
    childList: true,
    subtree: true,
  });
  updateDocumentStageOverlayState(root);
  return () => {
    controller.abort();
    overlayObserver.disconnect();
    root.closest<HTMLElement>('.document-stage')?.classList.remove(
      'has-embedded-overlay',
      'has-embedded-pullout',
      'has-embedded-context-popover',
    );
    if (frame) window.cancelAnimationFrame(frame);
  };
}

function updateDocumentStageOverlayState(root: HTMLElement): void {
  const stage = root.closest<HTMLElement>('.document-stage');
  if (!stage) return;
  const hasPullout = Boolean(root.querySelector('.viewer-shell.is-sidebar-open, .editor-shell.is-sidebar-open'));
  const hasContextPopover = Boolean(root.querySelector('.hvy-context-popover-backdrop'));
  stage.classList.toggle('has-embedded-pullout', hasPullout);
  stage.classList.toggle('has-embedded-context-popover', hasContextPopover);
}

function getMountScrollElement(root: HTMLElement | null): HTMLElement | null {
  const metaView = root?.querySelector<HTMLElement>('.document-meta-view');
  const metaPane = metaView?.closest<HTMLElement>('.full-pane');
  if (metaPane) return metaPane;
  return root?.querySelector<HTMLElement>(
    '.editor-shell .editor-tree, .viewer-shell .reader-document, .raw-hvy-textarea'
  ) ?? null;
}

function captureMountScrollRatio(root: HTMLElement | null): MountScrollRatio | null {
  const scroller = getMountScrollElement(root);
  if (!scroller) return null;
  return {
    top: scrollRatio(scroller.scrollTop, scroller.scrollHeight - scroller.clientHeight),
    left: scrollRatio(scroller.scrollLeft, scroller.scrollWidth - scroller.clientWidth),
    topPosition: scroller.scrollTop,
    leftPosition: scroller.scrollLeft,
  };
}

function scrollRatio(position: number, max: number): number {
  return max > 0 ? position / max : 0;
}

function restoreMountScrollRatio(root: HTMLElement | null, ratio: MountScrollRatio | null): void {
  if (!root || !ratio) return;
  const restore = () => {
    const scroller = getMountScrollElement(root);
    if (!scroller) return;
    const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const maxLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    scroller.scrollTop = Math.min(ratio.topPosition, maxTop) || ratio.top * maxTop;
    scroller.scrollLeft = Math.min(ratio.leftPosition, maxLeft) || ratio.left * maxLeft;
  };
  restore();
  window.requestAnimationFrame(() => {
    restore();
    window.requestAnimationFrame(restore);
  });
}

function setDocumentDirty(dirty: boolean, options: { preserveStatus?: boolean } = {}): void {
  if (!state.document || state.document.readOnly) return;
  const changed = state.document.dirty !== dirty;
  state.document.dirty = dirty;
  if (!options.preserveStatus || changed) {
    state.status = dirty ? 'Unsaved changes' : `Saved ${state.document.name}`;
  }
  const document = state.document.mounted?.document ?? pendingMountDocument;
  if (document) {
    updateCurrentDocumentSession(document);
  }
  if (dirty) {
    scheduleBackupActiveDocument();
  }
  updateDirtyChrome();
}

function updateDirtyChrome(): void {
  const openDocument = state.document;
  if (!openDocument) return;
  syncDocumentTabs();
  const label = openDocument.readOnly ? 'Read only' : openDocument.dirty ? 'Unsaved' : 'Saved';
  const indicator = document.querySelector<HTMLElement>('.dirty-indicator');
  indicator?.replaceChildren(document.createTextNode(label));
  indicator?.setAttribute('data-state', openDocument.readOnly ? 'read-only' : openDocument.dirty ? 'dirty' : 'clean');
  const activeTab = document.querySelector<HTMLElement>('.document-tab.is-active');
  activeTab?.classList.toggle('is-dirty', openDocument.dirty);
  const fileActions = getFileActionAvailability(state);
  syncToolbarButtonDisabled('save', !fileActions.save);
  syncToolbarButtonDisabled('save-as', !fileActions.saveAs);
  syncToolbarButtonDisabled('import-into-current', !fileActions.importCurrent);
  syncToolbarButtonDisabled('export-pdf', !fileActions.exportPdf);
  document.querySelector('.status-bar')?.replaceChildren(document.createTextNode(state.status));
  syncFileMenuState();
}

function syncToolbarButtonDisabled(action: string, disabled: boolean): void {
  const button = document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
  if (!button) return;
  if (disabled) {
    button.setAttribute('disabled', '');
  } else {
    button.removeAttribute('disabled');
  }
}

function updateModeMetaChrome(): void {
  const openDocument = state.document;
  if (!openDocument) return;
  const advancedButton = document.querySelector<HTMLButtonElement>('.mode-button[data-mode="advanced"]');
  const metaButton = document.querySelector<HTMLButtonElement>('.mode-button-meta');
  const advancedActive = openDocument.mode === 'advanced' && !openDocument.metaOpen;
  advancedButton?.classList.toggle('is-active', advancedActive);
  advancedButton?.setAttribute('aria-pressed', advancedActive ? 'true' : 'false');
  metaButton?.classList.toggle('is-active', openDocument.metaOpen);
  metaButton?.setAttribute('aria-pressed', openDocument.metaOpen ? 'true' : 'false');
}

async function saveCurrentDocument(): Promise<void> {
  const openDocument = state.document;
  const mounted = openDocument?.mounted;
  if (!openDocument || !mounted) return;
  if (openDocument.isNew || !openDocument.path) {
    openSaveAsDialog();
    return;
  }
  if (state.busy) return;
  state.busy = true;
  state.error = null;
  state.status = 'Saving...';
  updateDirtyChrome();
  try {
    if (openDocument.readOnly) {
      state.status = 'The HVY guide is read-only';
      return;
    }
    const bytes = Array.from(serializeMountedDocument(mounted));
    await saveDocumentFile({ path: openDocument.path, bytes });
    markMountedDocumentSaved(mounted);
    openDocument.dirty = false;
    openDocument.recoveryBackupId = null;
    state.status = `Saved ${openDocument.name}`;
    const document = mounted.document;
    updateCurrentDocumentSession(document);
    await refreshOpenWorkspaceForFile(openDocument.path);
    await refreshRecents();
    await clearRecoveryDraftsForDocument(openDocument.path, openDocument.name);
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = 'Ready';
  } finally {
    state.busy = false;
    updateDirtyChrome();
  }
}

function openSaveAsDialog(): void {
  if (!state.document?.mounted || state.document.readOnly) return;
  state.saveAsDialogOpen = true;
  state.saveAsKind = 'document';
  state.saveAsScope = state.workspaces.length > 0 ? 'workspace' : 'anywhere';
  state.error = null;
  state.status = 'Ready';
  rerender({ preserveMountedDocument: true });
}

async function saveCurrentDocumentAsAnywhere(): Promise<void> {
  await runBusy('Saving as...', async () => {
    await performSaveCurrentDocumentAs();
  });
}

async function exportCurrentDocumentPdf(): Promise<void> {
  const openDocument = state.document;
  const mounted = openDocument?.mounted;
  if (!openDocument || !mounted || openDocument.readOnly) return;
  if (openDocument.extension !== '.phvy') {
    state.status = 'PDF export is available for PHVY documents';
    rerender({ preserveMountedDocument: true });
    return;
  }
  if (openDocument.isNew || openDocument.dirty || isMountedDocumentDirty(mounted)) {
    state.exportPdfSavePromptOpen = true;
    state.status = 'Save before exporting PDF';
    rerender({ preserveMountedDocument: true });
    return;
  }
  await runBusy('Exporting PDF...', async () => {
    if (!state.document?.mounted) return;
    const blob = await state.document.mounted.mount.getPdfBlob({ filename: pdfFileName(state.document.name) });
    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
    const savedPath = await savePdfAsDialog({ suggestedName: pdfFileName(state.document.name), bytes });
    state.exportedPdfPath = savedPath;
    state.status = savedPath ? `Exported ${pdfFileName(state.document.name)}` : 'Ready';
  }, { preserveMountedDocument: true });
}

async function saveBeforeExportPdf(): Promise<void> {
  state.exportPdfSavePromptOpen = false;
  await saveCurrentDocument();
  if (state.document && !state.document.dirty && !state.document.isNew) {
    await exportCurrentDocumentPdf();
  }
}

async function performSaveCurrentDocumentAs(): Promise<void> {
  if (!state.document?.mounted) return;
  if (state.document.readOnly) {
    state.status = 'The HVY guide is read-only';
    rerender();
    return;
  }
  const bytes = Array.from(serializeMountedDocument(state.document.mounted));
  const previousPath = state.document.path;
  const previousName = state.document.name;
  const previousMode = state.document.mode;
  const file = await saveDocumentAsDialog({ suggestedName: state.document.name, bytes });
  if (!file) return;
  const document = await deserializeHvy(new Uint8Array(file.bytes), file.extension);
  if (previousPath && previousPath !== file.path) {
    documentSessions.delete(previousPath);
    removeDocumentTabPath(previousPath);
  }
  markDocumentTabOpened(file.path);
  state.document = {
    path: file.path,
    name: file.name,
    extension: file.extension,
    mode: previousMode,
    dirty: false,
    readOnly: false,
    hiddenFromAI: workspaceFileAiAccess(file.path).hiddenFromAI,
    isNew: false,
    metaOpen: false,
    mounted: null,
    recoveryBackupId: null,
  };
  updateCurrentDocumentSession(document);
  state.selectedFilePath = file.path;
  state.status = `Saved ${file.name}`;
  await refreshOpenWorkspaceForFile(file.path);
  await refreshRecents();
  await clearRecoveryDraftsForDocument(previousPath, previousName);
  await clearRecoveryDraftsForDocument(file.path, file.name);
  rerender();
  await mountCurrentDocument(document);
}

async function selectDocumentTab(path: string): Promise<void> {
  state.tabStackOpen = false;
  if (state.document?.path === path) {
    rerender({ preserveMountedDocument: true });
    return;
  }
  const session = documentSessions.get(path);
  if (session?.dirty || session?.isNew) {
    await openDocument({
      path: session.path,
      name: session.name,
      extension: session.extension,
      bytes: [],
      recoveryState: session.recoveryState,
    });
    await refreshRecents();
    return;
  }
  await openDocument(await readDocumentFile(path));
  await refreshRecents();
}

function cycleTabStack(direction: 1 | -1): void {
  syncDocumentTabs();
  if (state.documentTabs.length === 0) return;
  if (!state.tabStackOpen) {
    state.tabStackOpen = true;
    state.tabStackIndex = direction < 0 ? state.documentTabs.length - 1 : 0;
  } else {
    state.tabStackIndex = getTabStackIndex() + direction;
  }
  rerender({ preserveMountedDocument: true });
}

async function commitTabStack(): Promise<void> {
  if (!state.tabStackOpen || state.documentTabs.length === 0) return;
  const tab = state.documentTabs[getTabStackIndex()];
  state.tabStackOpen = false;
  state.tabStackIndex = 0;
  if (tab) {
    await selectDocumentTab(tab.path);
  } else {
    rerender({ preserveMountedDocument: true });
  }
}

async function closeDocumentTab(path: string): Promise<void> {
  if (state.document?.path === path) {
    await closeCurrentDocument();
    return;
  }
  const session = documentSessions.get(path);
  if (session?.dirty && !session.readOnly) {
    state.closeDocumentDialogOpen = true;
    state.closeDocumentTargetPath = path;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
    return;
  }
  documentSessions.delete(path);
  removeDocumentTabPath(path);
  state.status = 'Closed tab';
  rerender({ preserveMountedDocument: true });
}

async function saveAndCloseDocument(): Promise<void> {
  const targetPath = state.closeDocumentTargetPath ?? state.document?.path ?? null;
  if (targetPath === null) return;
  if (state.document?.path === targetPath) {
    state.closeDocumentDialogOpen = false;
    state.closeDocumentDraftDialogOpen = false;
    state.closeDocumentTargetPath = null;
    await saveCurrentDocument();
    if (state.document && !state.document.dirty) {
      await closeCurrentDocument({ discard: true });
    }
    return;
  }
  const session = documentSessions.get(targetPath);
  if (!session) {
    state.closeDocumentDialogOpen = false;
    state.closeDocumentDraftDialogOpen = false;
    state.closeDocumentTargetPath = null;
    rerender({ preserveMountedDocument: true });
    return;
  }
  if (session.isNew || !session.path) {
    state.closeDocumentDialogOpen = false;
    state.closeDocumentDraftDialogOpen = false;
    state.closeDocumentTargetPath = null;
    await selectDocumentTab(targetPath);
    state.closeDocumentDialogOpen = true;
    state.closeDocumentTargetPath = targetPath;
    rerender({ preserveMountedDocument: true });
    return;
  }
  await runBusy('Saving...', async () => {
    const bytes = Array.from(await serializeHvy(session.document));
    await saveDocumentFile({ path: session.path, bytes });
    documentSessions.delete(session.path);
    removeDocumentTabPath(session.path);
    workspaceFilterDocumentCache.delete(session.path);
    backupSnapshots.delete(backupDocumentKey(session.path, session.name));
    await clearRecoveryDraftsForDocument(session.path, session.name);
    await refreshOpenWorkspaceForFile(session.path);
    await refreshRecents();
    state.closeDocumentDialogOpen = false;
    state.closeDocumentTargetPath = null;
    state.status = `Saved ${session.name}`;
  }, { preserveMountedDocument: true });
}

async function promptCloseDocumentDraftChoice(): Promise<void> {
  const targetPath = state.closeDocumentTargetPath ?? state.document?.path ?? null;
  if (targetPath === null) return;
  state.closeDocumentDialogOpen = false;
  await ensureCloseDocumentRecoveryDraft(targetPath);
  state.closeDocumentDraftDialogOpen = true;
  state.status = 'Ready';
  rerender({ preserveMountedDocument: true });
}

async function ensureCloseDocumentRecoveryDraft(targetPath: string): Promise<string | null> {
  if (state.document?.path === targetPath && state.document.mounted) {
    if (state.document.recoveryBackupId) return state.document.recoveryBackupId;
    const bytes = Array.from(serializeMountedDocument(state.document.mounted));
    const backup = await createDocumentBackup({
      documentPath: state.document.path,
      name: state.document.name,
      extension: state.document.extension,
      bytes,
      recoveryState: getMountedRecoveryState(state.document.mounted),
    });
    state.document.recoveryBackupId = backup?.id ?? null;
    return state.document.recoveryBackupId;
  }
  const session = documentSessions.get(targetPath);
  if (!session) return null;
  if (session.recoveryBackupId) return session.recoveryBackupId;
  const bytes = Array.from(await serializeHvy(session.document));
  const backup = await createDocumentBackup({
    documentPath: session.path,
    name: session.name,
    extension: session.extension,
    bytes,
    recoveryState: session.recoveryState,
  });
  session.recoveryBackupId = backup?.id ?? null;
  return session.recoveryBackupId;
}

function getCloseDocumentRecoveryBackupId(targetPath: string): string | null {
  if (state.document?.path === targetPath) {
    return state.document.recoveryBackupId;
  }
  return documentSessions.get(targetPath)?.recoveryBackupId ?? null;
}

async function closeDocumentWithoutSaving(): Promise<void> {
  const targetPath = state.closeDocumentTargetPath ?? state.document?.path ?? null;
  if (targetPath === null) return;
  if (getCloseDocumentRecoveryBackupId(targetPath)) {
    await promptCloseDocumentDraftChoice();
    return;
  }
  await closeTargetDocumentWithoutSaving({ discardDraft: true, createDraft: false });
}

async function closeTargetDocumentWithoutSaving(options: { discardDraft: boolean; createDraft?: boolean }): Promise<void> {
  const targetPath = state.closeDocumentTargetPath ?? state.document?.path ?? null;
  if (targetPath === null) return;
  const backupId = options.createDraft === false
    ? getCloseDocumentRecoveryBackupId(targetPath)
    : await ensureCloseDocumentRecoveryDraft(targetPath);
  if (options.discardDraft && backupId) {
    await discardDocumentBackup(backupId);
  }
  if (state.document?.path === targetPath) {
    await closeActiveDocumentAfterUnsavedChoice({ discardDraft: options.discardDraft });
    return;
  }
  const session = documentSessions.get(targetPath);
  if (options.discardDraft && session) {
    await clearRecoveryDraftsForDocument(session.path, session.name);
    backupSnapshots.delete(backupDocumentKey(session.path, session.name));
  }
  documentSessions.delete(targetPath);
  removeDocumentTabPath(targetPath);
  state.closeDocumentDialogOpen = false;
  state.closeDocumentDraftDialogOpen = false;
  state.closeDocumentTargetPath = null;
  state.status = options.discardDraft ? 'Discarded unsaved edits' : 'Kept recovery draft for later';
  rerender({ preserveMountedDocument: true });
}

async function closeActiveDocumentAfterUnsavedChoice(options: { discardDraft: boolean }): Promise<void> {
  const openDocument = state.document;
  if (!openDocument) return;
  const path = openDocument.path;
  const name = openDocument.name;
  openDocument.mounted?.mount.destroy();
  mountThemeReapplyCleanup?.();
  mountThemeReapplyCleanup = null;
  pendingMountDocument = null;
  pendingMountRecoveryState = null;
  mountGeneration += 1;
  documentSessions.delete(path);
  workspaceFilterDocumentCache.delete(path);
  removeDocumentTabPath(path);
  backupSnapshots.delete(backupDocumentKey(path, name));
  if (options.discardDraft) {
    await clearRecoveryDraftsForDocument(path, name);
  }
  state.closeDocumentDialogOpen = false;
  state.closeDocumentDraftDialogOpen = false;
  state.closeDocumentTargetPath = null;
  state.document = null;
  state.selectedFilePath = null;
  state.status = options.discardDraft ? 'Discarded unsaved edits' : 'Kept recovery draft for later';
  rerender();
}

async function closeCurrentDocument(options: { discard?: boolean } = {}): Promise<void> {
  const openDocument = state.document;
  if (!openDocument) return;
  if (!openDocument.readOnly && openDocument.dirty && !options.discard) {
    state.closeDocumentDialogOpen = true;
    state.closeDocumentTargetPath = openDocument.path;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
    return;
  }
  const path = openDocument.path;
  const name = openDocument.name;
  openDocument.mounted?.mount.destroy();
  mountThemeReapplyCleanup?.();
  mountThemeReapplyCleanup = null;
  pendingMountDocument = null;
  pendingMountRecoveryState = null;
  mountGeneration += 1;
  if (path) {
    documentSessions.delete(path);
    workspaceFilterDocumentCache.delete(path);
  }
  removeDocumentTabPath(path);
  backupSnapshots.delete(backupDocumentKey(path, name));
  await clearRecoveryDraftsForDocument(path, name);
  state.closeDocumentDialogOpen = false;
  state.closeDocumentDraftDialogOpen = false;
  state.closeDocumentTargetPath = null;
  state.document = null;
  state.selectedFilePath = null;
  state.status = 'Closed document';
  rerender();
}

async function handleAppCloseRequest(): Promise<void> {
  if (state.appCloseDialogOpen) return;
  if (!hasUnsavedWritableDocument()) {
    await requestAppClose();
    return;
  }
  try {
    await backupActiveDocument({ force: true });
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  }
  state.appCloseDialogOpen = true;
  state.status = 'Ready';
  rerender({ preserveMountedDocument: true });
}

async function saveAndCloseApp(): Promise<void> {
  state.appCloseDialogOpen = false;
  await saveCurrentDocument();
  if (!hasUnsavedWritableDocument()) {
    await requestAppClose();
  } else {
    state.appCloseDialogOpen = true;
    rerender({ preserveMountedDocument: true });
  }
}

async function closeAppWithoutSaving(): Promise<void> {
  state.appCloseDialogOpen = false;
  try {
    await backupActiveDocument({ force: true });
  } catch {
    // The user chose to close without saving; the normal timed drafts may still exist.
  }
  await requestAppClose();
}

function hasUnsavedWritableDocument(): boolean {
  const openDocument = state.document;
  if (!openDocument?.mounted || openDocument.readOnly) return false;
  return openDocument.dirty || isMountedDocumentDirty(openDocument.mounted);
}

function startBackupTimer(): void {
  if (backupTimer !== null) return;
  backupTimer = window.setInterval(() => {
    scheduleBackupActiveDocument();
  }, BACKUP_INTERVAL_MS);
}

function scheduleBackupActiveDocument(): void {
  if (pendingBackupIdleHandle !== null) return;
  const callback = () => {
    pendingBackupIdleHandle = null;
    void backupActiveDocument();
  };
  pendingBackupIdleHandle = globalThis.setTimeout(callback, BACKUP_DEBOUNCE_MS);
}

function setupRecoveryLifecycle(): void {
  window.addEventListener('pagehide', () => {
    void backupActiveDocument({ force: true }).catch(() => undefined);
  });
  window.addEventListener('beforeunload', () => {
    void backupActiveDocument({ force: true }).catch(() => undefined);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void backupActiveDocument({ force: true }).catch(() => undefined);
    }
  });
}

async function backupActiveDocument(options: { force?: boolean } = {}): Promise<void> {
  if (!state.document?.mounted || state.document.readOnly) return;
  if (!state.document.dirty) return;
  const bytes = Array.from(serializeMountedDocument(state.document.mounted));
  const recoveryState = getMountedRecoveryState(state.document.mounted);
  const documentKey = backupDocumentKey(state.document.path, state.document.name);
  const bytesKey = backupBytesKey(bytes);
  const previousBackup = backupSnapshots.get(documentKey);
  const now = Date.now();
  if (previousBackup?.bytesKey === bytesKey) return;
  if (!options.force && previousBackup && now - previousBackup.createdAtMs < MIN_BACKUP_SPACING_MS) return;
  try {
    const backup = await createDocumentBackup({
      documentPath: state.document.path,
      name: state.document.name,
      extension: state.document.extension,
      bytes,
      recoveryState,
    });
    if (backup) {
      backupSnapshots.set(documentKey, { bytesKey, createdAtMs: Date.parse(backup.createdAt) || now });
    }
  } catch (error) {
    if (options.force) {
      throw error;
    }
    // Keep timed recovery drafts quiet; explicit recovery will surface failures.
  }
}

function backupDocumentKey(path: string, name: string): string {
  return path || `untitled:${name}`;
}

function backupBytesKey(bytes: number[]): string {
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return `${bytes.length}:${hash >>> 0}`;
}

async function clearRecoveryDraftsForDocument(documentPath: string, name: string): Promise<void> {
  backupSnapshots.delete(backupDocumentKey(documentPath, name));
  try {
    await clearDocumentRecoveryDrafts({ documentPath, name });
  } catch {
    // Recovery drafts are best-effort cleanup after an explicit save or discard.
  }
}

async function discardRecoveryStateForBackup(backup: DocumentBackup): Promise<void> {
  const key = backupDocumentKey(backup.documentPath, backup.name);
  backupSnapshots.delete(key);
  if (backup.documentPath) {
    documentSessions.delete(backup.documentPath);
    workspaceFilterDocumentCache.delete(backup.documentPath);
  }
  if (!state.document || state.document.path !== backup.documentPath || state.document.name !== backup.name) {
    return;
  }
  if (!state.document.path) {
    state.document.dirty = false;
    state.document.isNew = false;
    pendingMountDocument = null;
    pendingMountRecoveryState = null;
    return;
  }
  const file = await readDocumentFile(state.document.path);
  const document = await deserializeHvy(new Uint8Array(file.bytes), file.extension);
  const wasMounted = Boolean(state.document.mounted);
  state.document = {
    ...state.document,
    name: file.name,
    extension: file.extension,
    dirty: false,
    isNew: false,
    mounted: null,
    recoveryBackupId: null,
  };
  pendingMountRecoveryState = null;
  if (wasMounted) {
    rerender();
    await mountCurrentDocument(document);
  } else {
    pendingMountDocument = document;
    updateDirtyChrome();
  }
}

async function openRecoveryDialog(): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  state.error = null;
  state.status = 'Loading recoverable edits...';
  try {
    state.recoveryBackups = await listDocumentBackups();
    state.recoveryDialogOpen = true;
    state.status = state.recoveryBackups.length > 0 ? 'Loaded recoverable edits' : 'No recoverable edits available';
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = 'Ready';
  } finally {
    state.busy = false;
    renderAllAroundDocument();
  }
}

async function openRecoveryDialogOnBoot(): Promise<void> {
  try {
    state.recoveryBackups = await listDocumentBackups();
    if (state.recoveryBackups.length === 0) return;
    await restoreBackupsToTabs(state.recoveryBackups);
    state.status = 'Recoverable edits restored as tabs';
    rerender({ preserveMountedDocument: true });
  } catch {
    state.recoveryBackups = [];
  }
}

async function restoreBackupsToTabs(backups: DocumentBackup[]): Promise<void> {
  for (const backup of [...backups].reverse()) {
    const file = await restoreDocumentBackup(backup.id);
    const document = await deserializeHvy(new Uint8Array(file.bytes), file.extension);
    documentSessions.set(file.path, {
      path: file.path,
      name: file.name,
      extension: file.extension,
      mode: defaultDocumentMode(file.extension),
      dirty: true,
      readOnly: false,
      hiddenFromAI: workspaceFileAiAccess(file.path).hiddenFromAI,
      isNew: false,
      metaOpen: false,
      document,
      recoveryState: file.recoveryState ?? null,
      recoveryBackupId: backup.id,
    });
    markDocumentTabOpened(file.path);
    backupSnapshots.delete(backupDocumentKey(file.path, file.name));
  }
}

async function createBlankDocument(): Promise<void> {
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

async function refreshOpenWorkspaceForFile(filePath: string): Promise<void> {
  const workspace = state.workspaces.find((candidate) => filePath.startsWith(candidate.path));
  if (!workspace) return;
  upsertWorkspace(await loadWorkspace(workspace.path));
}

function currentDocumentCanSaveToWorkspace(): boolean {
  return getFileActionAvailability(state).saveToWorkspace;
}

function openWorkspaceTransfer(
  mode: NonNullable<typeof state.workspaceTransfer>['mode'],
  fileName: string,
  sourcePath: string | null,
  excludedWorkspacePath: string | null,
): void {
  const availableWorkspaces = state.workspaces.filter((workspace) => workspace.path !== excludedWorkspacePath);
  if (availableWorkspaces.length === 0) return;
  state.workspaceTransfer = {
    mode,
    sourcePath,
    fileName,
    nameDraft: displayDocumentName(fileName),
    excludedWorkspacePath,
  };
  state.status = 'Ready';
  rerender({ preserveMountedDocument: true });
}

function workspaceTransferBusyLabel(mode: NonNullable<typeof state.workspaceTransfer>['mode']): string {
  if (mode === 'saveCurrent') return 'Saving to workspace';
  if (mode === 'copyFile') return 'Copying file';
  return 'Moving file';
}

async function saveCurrentDocumentToWorkspace(workspacePath: string, name: string): Promise<void> {
  if (!state.document?.mounted) return;
  const previousPath = state.document.path;
  const previousName = state.document.name;
  const bytes = Array.from(serializeMountedDocument(state.document.mounted));
  const file = await saveDocumentToWorkspace({
    workspacePath,
    name: documentFileName(name, documentTypeForExtension(state.document.extension)) ?? name,
    bytes,
  });
  await openDocument(file, { deferMount: true });
  documentSessions.delete(file.path);
  if (state.document?.path === file.path) {
    state.document.dirty = false;
    state.document.isNew = false;
    state.document.recoveryBackupId = null;
    const document = pendingMountDocument ?? state.document.mounted?.document;
    if (document) {
      updateCurrentDocumentSession(document);
    }
  }
  if (previousPath !== file.path) {
    removeDocumentTabPath(previousPath);
  }
  markDocumentTabOpened(file.path);
  upsertWorkspace(await loadWorkspace(workspacePath));
  await refreshRecents();
  await clearRecoveryDraftsForDocument(previousPath, previousName);
  await clearRecoveryDraftsForDocument(file.path, file.name);
  state.status = `Saved to ${file.name}`;
}

async function saveImportedDocumentToWorkspace(
  workspacePath: string,
  fileName: string,
  document: VisualDocument,
): Promise<void> {
  const bytes = Array.from(await serializeHvy(document));
  const file = await saveDocumentToWorkspace({
    workspacePath,
    name: fileName,
    bytes,
  });
  documentSessions.delete(file.path);
  upsertWorkspace(await loadWorkspace(workspacePath));
  await openDocument(file, { deferMount: true });
  await refreshRecents();
  await clearRecoveryDraftsForDocument(file.path, file.name);
  state.status = `Saved to ${file.name}`;
}

async function createTemporaryImportMount(
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
  const mounted = await mountHvyDocument(root, document, mode);
  return {
    mounted,
    cleanup() {
      mounted.mount.destroy();
      root.remove();
    },
  };
}

async function moveOpenWorkspaceFileToWorkspace(path: string, workspacePath: string): Promise<void> {
  const sourceWorkspacePath = workspacePathForFile(path);
  const currentDocument = state.document?.path === path ? state.document : null;
  const mountedDocument = currentDocument?.mounted?.document ?? pendingMountDocument;
  const oldBackupKey = currentDocument ? backupDocumentKey(currentDocument.path, currentDocument.name) : null;
  const file = await moveDocumentToWorkspace({ path, workspacePath });
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
      const backup = backupSnapshots.get(oldBackupKey);
      if (backup) {
        backupSnapshots.delete(oldBackupKey);
        backupSnapshots.set(backupDocumentKey(file.path, file.name), backup);
      }
    }
  }
  if (sourceWorkspacePath) {
    upsertWorkspace(await loadWorkspace(sourceWorkspacePath));
  }
  upsertWorkspace(await loadWorkspace(workspacePath));
  await refreshRecents();
  state.status = `Moved to ${file.name}`;
}

async function finishAddingFilesToWorkspace(result: AddFilesResult, status: string): Promise<void> {
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

async function droppedWorkspaceFilesFrom(files: File[]): Promise<DroppedWorkspaceFile[]> {
  const droppedFiles: DroppedWorkspaceFile[] = [];
  for (const file of files) {
    droppedFiles.push({
      name: file.name,
      bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
    });
  }
  return droppedFiles;
}

function workspacePathForFile(filePath: string): string | null {
  return workspacePathForFileInWorkspaces(state.workspaces, filePath);
}

function loadWorkspace(path: string): Promise<Workspace> {
  return loadWorkspaceBackend(path, { includeTemplates: state.workspaceFileViews[path] === 'templates' });
}

function showWorkspaceDocumentsView(workspacePath: string): void {
  state.workspaceFileViews[workspacePath] = 'documents';
}

async function refreshSavedTemplates(workspacePath?: string | null): Promise<void> {
  state.savedTemplates = await listSavedTemplates(workspacePath ?? workspacePathForFile(state.document?.path ?? '') ?? state.selectedWorkspacePath);
}

function templatesForCurrentWorkspaceDocumentType(workspacePath: string | null | undefined, documentType: DocumentCreationType) {
  const workspace = state.workspaces.find((candidate) => candidate.path === workspacePath) ?? null;
  return templatesForDocumentType(mergeSavedTemplates(state.savedTemplates), documentType, workspaceTemplateVisibility(workspace));
}

function creationTemplate(
  workspacePath: string | null | undefined,
  documentType: DocumentCreationType,
  templateId: string,
  title: string,
): string {
  if (documentType !== 'hvy') {
    return defaultHvyDocument(title);
  }
  const template = getTemplateById(templatesForCurrentWorkspaceDocumentType(workspacePath, documentType), templateId);
  return applyTemplateTitle(template.content, title);
}

function upsertWorkspace(workspace: Awaited<ReturnType<typeof loadWorkspace>>): void {
  const index = state.workspaces.findIndex((candidate) => candidate.path === workspace.path);
  if (index >= 0) {
    state.workspaces[index] = workspace;
  } else {
    state.workspaces.push(workspace);
  }
  sortWorkspaces();
  syncMcpWorkspaces();
}

function sortWorkspaces(): void {
  state.workspaces.sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
}

function syncMcpWorkspaces(): void {
  void updateMcpWorkspaces(state.workspaces.map((workspace) => workspace.path));
}

function syncFileMenuState(options: { force?: boolean } = {}): void {
  const fileMenuState = getFileActionAvailability(state);
  const key = JSON.stringify(fileMenuState);
  if (!options.force && key === lastFileMenuStateKey) return;
  lastFileMenuStateKey = key;
  void updateFileMenuState(fileMenuState).catch(() => {
    // Native menu state is unavailable in browser-only smoke runs.
  });
}

function hasOpenWorkspaceNamed(name: string, exceptPath: string | null = null): boolean {
  const normalized = name.trim().toLowerCase();
  return state.workspaces.some((workspace) => workspace.path !== exceptPath && workspace.manifest.name.trim().toLowerCase() === normalized);
}

function rerender(options: { preserveMountedDocument?: boolean } = {}): void {
  const mountScrollRatio = options.preserveMountedDocument ? captureMountScrollRatio(mountRoot) : null;
  syncDocumentTabs();
  if (!options.preserveMountedDocument) {
    state.document?.mounted?.mount.destroy();
    if (state.document) {
      state.document.mounted = null;
    }
  }
  mountRoot = render(state, handlers);
  syncFileMenuState();
  restoreMountScrollRatio(mountRoot, mountScrollRatio);
}

function renderAllAroundDocument(): void {
  renderUiAroundDocument(state);
  syncFileMenuState();
}

function scheduleWorkspaceFilterProgressRender(): void {
  if (workspaceFilterRenderTimer) {
    workspaceFilterRenderQueued = true;
    return;
  }
  rerender({ preserveMountedDocument: true });
  workspaceFilterRenderTimer = window.setTimeout(() => {
    workspaceFilterRenderTimer = null;
    if (!workspaceFilterRenderQueued) return;
    workspaceFilterRenderQueued = false;
    scheduleWorkspaceFilterProgressRender();
  }, 100);
}

function cancelWorkspaceFilterProgressRender(): void {
  if (workspaceFilterRenderTimer) {
    window.clearTimeout(workspaceFilterRenderTimer);
  }
  workspaceFilterRenderTimer = null;
  workspaceFilterRenderQueued = false;
}

async function runBusy(label: string, task: () => Promise<void>, options: { preserveMountedDocument?: boolean } = {}): Promise<void> {
  if (state.busy) return;
  const document = state.document?.mounted?.document;
  state.busy = true;
  state.error = null;
  state.status = label;
  try {
    await task();
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = 'Ready';
  } finally {
    state.busy = false;
    const documentToMount = pendingMountDocument ?? state.document?.mounted?.document ?? document;
    pendingMountDocument = null;
    if (options.preserveMountedDocument) {
      rerender({ preserveMountedDocument: true });
    } else {
      rerender();
      await mountCurrentDocument(documentToMount);
    }
  }
}

function defaultHvyDocument(title = 'Untitled'): string {
  return `---
hvy_version: 0.1
title: ${JSON.stringify(title)}
---
`;
}

function documentFileName(name: string, documentType: DocumentCreationType = 'hvy'): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const targetExtension = documentType === 'phvy' ? '.phvy' : documentType === 'thvy' ? '.thvy' : '.hvy';
  if (hasDocumentExtension(trimmed)) {
    return trimmed.replace(/\.(hvy|thvy|phvy)$/i, targetExtension);
  }
  return `${trimmed}${targetExtension}`;
}

function workspaceRootDocumentFileName(name: string, documentType: DocumentCreationType = 'hvy'): string | null {
  const trimmed = name.trim();
  if (hasInvalidDocumentNameSyntax(trimmed)) return null;
  return documentFileName(trimmed, documentType);
}

function hasInvalidDocumentNameSyntax(name: string): boolean {
  const trimmed = name.trim();
  return /[<>:"/\\|?*\x00-\x1f]/.test(trimmed) || trimmed.startsWith('.');
}

function documentTypeForExtension(extension: DocumentFile['extension']): DocumentCreationType {
  if (extension === '.phvy') return 'phvy';
  if (extension === '.thvy') return 'thvy';
  return 'hvy';
}

function documentTitle(fileName: string): string {
  return fileName.replace(/\.(t?hvy|phvy|md)$/i, '');
}

function syncRenamedTemplateMetadata(document: VisualDocument, oldName: string, newName: string): boolean {
  const meta = document.meta as Record<string, unknown>;
  let changed = false;
  if (meta.title === oldName) {
    meta.title = newName;
    changed = true;
  }
  changed = renameTemplateDefinitionEntries(meta.component_defs, oldName, newName) || changed;
  changed = renameTemplateDefinitionEntries(meta.section_defs, oldName, newName) || changed;
  return changed;
}

function renameTemplateDefinitionEntries(value: unknown, oldName: string, newName: string): boolean {
  if (!Array.isArray(value)) return false;
  let changed = false;
  value.forEach((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    const definition = entry as Record<string, unknown>;
    if (definition.name === oldName) {
      definition.name = newName;
      changed = true;
    }
    if (definition.key === oldName) {
      definition.key = newName;
      changed = true;
    }
  });
  return changed;
}

function hasDocumentExtension(fileName: string): boolean {
  return /\.(t?hvy|phvy)$/i.test(fileName);
}

function templateFileName(name: string, extension: '.thvy' | '.phvy' = '.thvy'): string {
  const trimmed = name.trim();
  const base = trimmed.replace(/\.(t?hvy|phvy|hvy|md)$/i, '').trim() || 'Untitled';
  return `${base}${extension}`;
}

function pdfFileName(name: string): string {
  const base = name.trim().replace(/\.(hvy|thvy|phvy|md|markdown)$/i, '').trim() || 'document';
  return `${base}.pdf`;
}

function revealStatusLabel(): string {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes('mac')) return 'Shown in Finder';
  if (platform.includes('win')) return 'Opened in Explorer';
  return 'Opened containing folder';
}

function applyTemplateTitle(template: string, title: string): string {
  return template.replace(/^title:.*$/m, `title: ${JSON.stringify(title)}`);
}

function documentStorageKey(identifier: string): string {
  return `hvy-galaxy:document:${identifier}`;
}

function closeUiBeforeAiSettings(): void {
  state.newWorkspaceDialogOpen = false;
  state.newDocumentWorkspacePath = null;
  state.colorThemeDialogOpen = false;
  state.aboutDialogOpen = false;
  state.mcpSettingsDialogOpen = false;
  state.mcpSettingsDraft = null;
  state.mcpSettingsDialogInitialJson = null;
  state.recoveryDialogOpen = false;
  state.recoveryBackups = [];
  state.openWorkspaceActionsPath = null;
  closeMountedTransientUi();
}

function closeUiBeforeAbout(): void {
  state.newWorkspaceDialogOpen = false;
  state.newDocumentWorkspacePath = null;
  state.aiSettingsDialogOpen = false;
  state.aiSettingsDraft = null;
  state.aiSettingsDialogInitialJson = null;
  state.mcpSettingsDialogOpen = false;
  state.mcpSettingsDraft = null;
  state.mcpSettingsDialogInitialJson = null;
  state.colorThemeDialogOpen = false;
  state.recoveryDialogOpen = false;
  state.recoveryBackups = [];
  state.openWorkspaceActionsPath = null;
  closeMountedTransientUi();
}

function closeUiBeforeColorTheme(): void {
  state.newWorkspaceDialogOpen = false;
  state.newDocumentWorkspacePath = null;
  state.aboutDialogOpen = false;
  state.aiSettingsDialogOpen = false;
  state.aiSettingsDraft = null;
  state.aiSettingsDialogInitialJson = null;
  state.mcpSettingsDialogOpen = false;
  state.mcpSettingsDraft = null;
  state.mcpSettingsDialogInitialJson = null;
  state.recoveryDialogOpen = false;
  state.recoveryBackups = [];
  state.openWorkspaceActionsPath = null;
  closeMountedTransientUi();
}

function closeUiBeforeMcpSettings(): void {
  state.newWorkspaceDialogOpen = false;
  state.newDocumentWorkspacePath = null;
  state.aboutDialogOpen = false;
  state.aiSettingsDialogOpen = false;
  state.aiSettingsDraft = null;
  state.aiSettingsDialogInitialJson = null;
  state.colorThemeDialogOpen = false;
  state.recoveryDialogOpen = false;
  state.recoveryBackups = [];
  state.openWorkspaceActionsPath = null;
  closeMountedTransientUi();
}

function closeUiBeforeWorkspaceFilter(): void {
  state.newWorkspaceDialogOpen = false;
  state.newDocumentWorkspacePath = null;
  state.aboutDialogOpen = false;
  state.aiSettingsDialogOpen = false;
  state.aiSettingsDraft = null;
  state.aiSettingsDialogInitialJson = null;
  state.mcpSettingsDialogOpen = false;
  state.mcpSettingsDraft = null;
  state.mcpSettingsDialogInitialJson = null;
  state.colorThemeDialogOpen = false;
  state.recoveryDialogOpen = false;
  state.recoveryBackups = [];
  state.openWorkspaceActionsPath = null;
  closeMountedTransientUi();
}

function persistAndApplyColorTheme(): void {
  saveColorThemeSettings(state.colorTheme);
  applyAppColorTheme();
  state.status = 'Updated colors';
}

function updateThemeRowChrome(name: string, value: string): void {
  const row = document.querySelector<HTMLElement>(`.theme-color-row[data-theme-color-name="${cssEscape(name)}"]`);
  row?.querySelector<HTMLElement>('.theme-color-swatch')?.setAttribute('style', value ? `background: ${value};` : '');
  row?.querySelector<HTMLButtonElement>('[data-action="theme-reset-color"]')?.toggleAttribute('disabled', !value);
}

function currentThemeDisplayName(): string | null {
  const customThemeId = getMatchedSavedThemeId(state.colorTheme.colors, state.colorTheme.savedThemes);
  if (customThemeId) {
    return state.colorTheme.savedThemes.find((theme) => theme.id === customThemeId)?.name ?? null;
  }
  const paletteId = getMatchedPaletteId(state.colorTheme.colors);
  if (paletteId) {
    return getPaletteById(paletteId)?.name ?? null;
  }
  return Object.keys(state.colorTheme.colors).length === 0 ? 'Default' : null;
}

function themeSuggestedFileName(name: string): string {
  const stem = name
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .trim() || 'Untitled Theme';
  return stem.toLowerCase().endsWith('.hvytheme') ? stem : `${stem}.hvytheme`;
}

function cssEscape(value: string): string {
  if ('CSS' in window && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replaceAll('"', '\\"');
}

function closeMountedTransientUi(): void {
  const root = mountRoot;
  if (!root) return;
  root
    .querySelector<HTMLElement>('[data-action="close-search"], [data-action="close-ai-edit"], [data-modal-action="close"]')
    ?.click();
  if (root.querySelector('.workspace-filter-dialog, .workspace-filter-backdrop, .modal-root, .ai-edit-popover')) {
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  }
}

function cloneAiSettings(settings: typeof state.aiSettings): typeof state.aiSettings {
  return JSON.parse(JSON.stringify(settings)) as typeof state.aiSettings;
}

function cloneMcpSettings(settings: McpSettings): McpSettings {
  return JSON.parse(JSON.stringify(settings)) as McpSettings;
}

function confirmDiscardAiSettings(settings: typeof state.aiSettings | undefined): boolean {
  const initial = state.aiSettingsDialogInitialJson;
  if (!initial) return true;
  const current = JSON.stringify(canonicalAiSettings(settings ?? state.aiSettingsDraft ?? state.aiSettings));
  if (current === initial) return true;
  return window.confirm('Discard changes to AI settings?');
}

function confirmDiscardMcpSettings(settings: McpSettings | undefined): boolean {
  const initial = state.mcpSettingsDialogInitialJson;
  if (!initial) return true;
  const current = JSON.stringify(settings ?? state.mcpSettingsDraft ?? state.mcpSettings);
  if (current === initial) return true;
  return window.confirm('Discard changes to MCP server settings?');
}

async function copyMcpConnectionUrl(url: string): Promise<void> {
  await navigator.clipboard.writeText(url);
  state.status = 'Copied MCP server URL';
  rerender({ preserveMountedDocument: true });
}

async function copyMcpBearerToken(token: string): Promise<void> {
  await navigator.clipboard.writeText(token);
  state.status = 'Copied MCP bearer token';
  rerender({ preserveMountedDocument: true });
}

async function copyMcpSetupValue(value: string, label: string): Promise<void> {
  await navigator.clipboard.writeText(value);
  state.status = `Copied ${label}`;
  rerender({ preserveMountedDocument: true });
}

function canonicalAiSettings(settings: typeof state.aiSettings): typeof state.aiSettings {
  return {
    activeProviderId: settings.activeProviderId,
    providers: [...settings.providers].sort((left, right) => left.provider.localeCompare(right.provider)),
    maxContextChars: normalizeAiMaxContextChars(settings.maxContextChars),
    actions: {
      chat: settings.actions.chat,
      edit: settings.actions.edit,
      importPlanning: settings.actions.importPlanning,
      importWriting: settings.actions.importWriting,
      importCleanup: settings.actions.importCleanup,
      semanticFilter: settings.actions.semanticFilter,
      compaction: settings.actions.compaction,
    },
  };
}

function normalizeAiMaxContextChars(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_AI_MAX_CONTEXT_CHARS;
  const stepped = Math.round(parsed / AI_CONTEXT_STEP_CHARS) * AI_CONTEXT_STEP_CHARS;
  return Math.min(AI_MAX_CONTEXT_CHARS, Math.max(AI_MIN_CONTEXT_CHARS, stepped));
}

async function confirmWorkspaceInitialization(path: string, defaultName: string) {
  const shouldInitialize = window.confirm(
    `"${defaultName}" is not a workspace yet. Create .hvyworkspace.json in this folder?`
  );
  return shouldInitialize ? initializeWorkspacePath(path) : null;
}

async function createWorkspaceInChosenFolder() {
  const candidate = await chooseWorkspaceFolder();
  if (!candidate) return null;
  if (candidate.hasManifest) {
    return loadWorkspace(candidate.path);
  }
  return initializeWorkspacePath(candidate.path);
}

function setupErrorSurface(): void {
  window.addEventListener('error', (event) => {
    showStartupError(event.error ?? event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    showStartupError(event.reason);
  });
}

function showStartupError(error: unknown): void {
  state.error = error instanceof Error ? error.message : String(error);
  state.status = 'Startup error';
  mountRoot = render(state, handlers);
}
