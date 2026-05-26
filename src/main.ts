import './styles.css';
import { installAiChatClient } from './aiClient';
import type { HvyDocumentSearchDocument } from '../../heavy-file-format/src/search/types';
import {
  addDroppedFilesToWorkspace,
  addFilesToWorkspace,
  archiveWorkspace,
  chooseWorkspaceFolder,
  clearDocumentRecoveryDrafts,
  createDocumentBackup,
  createDocumentFile,
  createWorkspace,
  discardDocumentBackup,
  copyDocumentToWorkspace,
  initializeWorkspacePath,
  isTauriRuntime,
  installMcpClient,
  loadArchivedWorkspaces,
  loadAiSettings,
  loadMcpClientInstallStatus,
  loadDefaultGuide,
  loadMcpServerStatus,
  loadMcpSettings,
  loadMcpStdioLaunchConfig,
  loadWorkspace,
  listSavedTemplates,
  listDocumentBackups,
  loadRecentState,
  onMenuEvent,
  openExternalUrl,
  openColorThemeDialog,
  openFileDialog,
  openImportSourceDialog,
  readDocumentFile,
  removeMcpClient,
  renameDocumentFile,
  renameWorkspace,
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
  moveDocumentToWorkspace,
  pasteSystemFilesToWorkspace,
  startMcpServer,
  stopMcpServer,
  unarchiveWorkspace,
  type AddFilesResult,
  type DocumentBackup,
  type DocumentFile,
  type DroppedWorkspaceFile,
  type ImportSourceFile,
  type McpClientInstallTarget,
  type McpSettings,
  type WorkspaceFileNode,
  type WorkspaceTreeNode,
  updateMcpWorkspaces,
  writeSystemFileClipboard,
} from './backend';
import { applyColorTheme, createColorThemeFile, createSavedThemeId, getMatchedPaletteId, getMatchedSavedThemeId, getPaletteById, isCssVariableName, loadColorThemeSettings, parseColorThemeFile, saveColorThemeSettings, serializeColorThemeFile } from './colorTheme';
import { applyMountedRecoveryState, buildMountedImportPlan, createHvyDocumentFilterSnapshot, deserializeHvy, getMountedDocument, getMountedRecoveryState, importTextIntoMountedDocument, isMountedDocumentDirty, markMountedDocumentSaved, mountHvyDocument, openMountedDocumentMeta, serializeMountedDocument, setMountedSearchSnapshot, type HvyMode, type VisualDocument } from './hvy';
import { state, type WorkspaceFilterConfig } from './state';
import { getTemplateById, mergeSavedTemplates } from './templates';
import { render, type UiHandlers } from './ui';

let mountRoot: HTMLElement | null = null;
let mountGeneration = 0;
let pendingMountDocument: VisualDocument | null = null;
let pendingMountRecoveryState: string | null = null;
let backupTimer: number | null = null;
let pendingBackupIdleHandle: ReturnType<typeof setTimeout> | number | null = null;
let mountThemeReapplyCleanup: (() => void) | null = null;
let workspaceFilterAbortController: AbortController | null = null;
const BACKUP_INTERVAL_MS = 5 * 60 * 1000;
const BACKUP_DEBOUNCE_MS = 1500;
const MIN_BACKUP_SPACING_MS = 60 * 1000;
interface DocumentSession {
  path: string;
  name: string;
  extension: DocumentFile['extension'];
  mode: HvyMode;
  dirty: boolean;
  readOnly: boolean;
  isNew: boolean;
  metaOpen: boolean;
  document: VisualDocument;
  recoveryState: string | null;
}
const documentSessions = new Map<string, DocumentSession>();
const workspaceFilterDocumentCache = new Map<string, VisualDocument>();
const backupSnapshots = new Map<string, { bytesKey: string; createdAtMs: number }>();

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
  createDocumentInWorkspace: (name, templateId) => void runBusy('Creating HVY document...', async () => {
    const workspacePath = state.newDocumentWorkspacePath;
    const template = getTemplateById(mergeSavedTemplates(state.savedTemplates), templateId);
    const fileName = documentFileName(name);
    if (!workspacePath) return;
    if (!fileName) {
      state.status = 'Document name is required';
      return;
    }
    state.newDocumentWorkspacePath = null;
    const file = await createDocumentFile({
      workspacePath,
      relativePath: fileName,
      template: applyTemplateTitle(template.content, documentTitle(fileName)),
    });
    upsertWorkspace(await loadWorkspace(workspacePath));
    state.selectedWorkspacePath = workspacePath;
    await openDocument(file, { isNew: true, deferMount: true });
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
    state.importIntoCurrentDialogOpen = false;
    state.importSource = null;
    state.status = 'Ready';
    void refreshSavedTemplates(workspacePath).then(() => rerender({ preserveMountedDocument: true }));
    rerender({ preserveMountedDocument: true });
    requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>('input[name="documentName"]')?.focus();
    });
  },
  openImportIntoCurrent: () => {
    if (!state.document?.mounted || state.document.readOnly) return;
    state.newDocumentWorkspacePath = null;
    state.importWorkspacePath = null;
    state.importIntoCurrentDialogOpen = true;
    state.importSource = null;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  chooseImportSource: () => void runBusy('Choosing import source...', async () => {
    const source = await openImportSourceDialog();
    if (!source) {
      state.status = 'Ready';
      return;
    }
    state.importSource = source;
    state.status = `Selected ${source.name}`;
  }),
  createImportedDocument: (name, templateId, instructions, pastedSourceText) => void runBusy('Importing document...', async () => {
    const workspacePath = state.importWorkspacePath;
    const source = importSourceFrom(pastedSourceText);
    const fileName = documentFileName(name);
    if (!workspacePath) return;
    if (!source) {
      state.status = 'Import source is required';
      return;
    }
    if (!fileName) {
      state.status = 'Document name is required';
      return;
    }
    const template = getTemplateById(mergeSavedTemplates(state.savedTemplates), templateId);
    state.importWorkspacePath = null;
    state.importSource = null;
    const file = await createDocumentFile({
      workspacePath,
      relativePath: fileName,
      template: applyTemplateTitle(template.content, documentTitle(fileName)),
    });
    upsertWorkspace(await loadWorkspace(workspacePath));
    state.selectedWorkspacePath = workspacePath;
    await openDocument(file, { isNew: true, deferMount: true });
    rerender();
    await mountCurrentDocument(pendingMountDocument ?? undefined);
    if (!state.document?.mounted) return;
    const plan = await buildMountedImportPlan(state.document.mounted, {
      sourceName: source.name,
      sourceText: source.text,
      instructions,
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
  }),
  importIntoCurrent: (instructions, pastedSourceText) => void runBusy('Importing into current document...', async () => {
    const source = importSourceFrom(pastedSourceText);
    if (!state.document?.mounted || state.document.readOnly) return;
    if (!source) {
      state.status = 'Import source is required';
      return;
    }
    state.importIntoCurrentDialogOpen = false;
    state.importSource = null;
    const plan = await buildMountedImportPlan(state.document.mounted, {
      sourceName: source.name,
      sourceText: source.text,
      instructions,
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
      onProgress: (event) => {
        if (event.message) state.status = event.message;
        rerender({ preserveMountedDocument: true });
      },
    });
    if (result.status !== 'complete') {
      throw new Error(result.message ?? 'Import failed.');
    }
    setDocumentDirty(true);
    updateCurrentDocumentSession(getMountedDocument(state.document.mounted));
    state.status = result.message ?? `Imported ${source.name}`;
  }),
  cancelImport: () => {
    state.importWorkspacePath = null;
    state.importIntoCurrentDialogOpen = false;
    state.importSource = null;
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
    await openDocument(file, { recovered: true, deferMount: true });
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
  confirmCloseDocument: () => void closeCurrentDocument({ discard: true }),
  cancelCloseDocument: () => {
    state.closeDocumentDialogOpen = false;
    state.status = 'Ready';
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
    await openDocument(await readDocumentFile(path), { deferMount: true });
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
      documentSessions.delete(path);
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
    openWorkspaceTransfer('saveCurrent', state.document!.name, null, null);
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
      state.status = 'The HVY guide is read-only';
      rerender();
      void mountCurrentDocument();
      return;
    }
    const document = state.document.mounted?.document;
    state.document.mode = mode;
    state.document.metaOpen = false;
    if (document) {
      updateCurrentDocumentSession(document);
    }
    rerender();
    void mountCurrentDocument(document);
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
        updateModeMetaChrome();
        return;
      }
    }
    if (state.document.mode === 'advanced') {
      if (state.document.mounted) {
        state.document.metaOpen = openMountedDocumentMeta(state.document.mounted);
        updateCurrentDocumentSession(state.document.mounted.document);
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
        updateModeMetaChrome();
      }
    });
  },
  save: () => void saveCurrentDocument(),
  saveAs: () => void saveCurrentDocumentAs(),
  openSaveTemplate: () => {
    if (!state.document?.mounted || state.document.readOnly) return;
    state.saveTemplateDialogOpen = true;
    state.saveTemplateScope = workspacePathForFile(state.document.path) ? 'workspace' : 'app';
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  setSaveTemplateScope: (scope) => {
    if (scope === 'workspace' && !workspacePathForFile(state.document?.path ?? '')) return;
    state.saveTemplateScope = scope;
    rerender({ preserveMountedDocument: true });
  },
  saveAsTemplate: (name, scope) => void runBusy('Saving template...', async () => {
    if (!state.document?.mounted || state.document.readOnly) return;
    const workspacePath = scope === 'workspace' ? workspacePathForFile(state.document.path) : null;
    if (scope === 'workspace' && !workspacePath) {
      throw new Error('Workspace template requires a document in an open workspace.');
    }
    const bytes = Array.from(serializeMountedDocument(state.document.mounted));
    await saveDocumentTemplate({ scope, workspacePath, name, bytes });
    state.saveTemplateDialogOpen = false;
    await refreshSavedTemplates(workspacePath);
    state.status = `Saved template ${templateFileName(name)}`;
  }),
  cancelSaveTemplate: () => {
    state.saveTemplateDialogOpen = false;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  createFile: () => void createBlankDocument(),
  closeDocument: () => void closeCurrentDocument(),
};

void boot();

async function boot(): Promise<void> {
  setupErrorSurface();
  try {
    mountRoot = render(state, handlers);
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
    await openDefaultGuide();
    await openRecoveryDialogOnBoot();
    startBackupTimer();
    setupRecoveryLifecycle();
    await onMenuEvent((event) => {
      if (event === 'new-workspace') handlers.newWorkspace();
      if (event === 'manage-workspaces') handlers.openWorkspaceManager();
      if (event === 'open-workspace') handlers.openWorkspace();
      if (event === 'open-file') handlers.openFile();
      if (event === 'open-guide') void openDefaultGuide({ force: true });
      if (event === 'about') handlers.openAbout();
      if (event === 'ai-settings') handlers.openAiSettings();
      if (event === 'mcp-settings') handlers.openMcpSettings();
      if (event === 'mcp-toggle') {
        if (state.mcpServerStatus.running) handlers.stopMcpServer();
        else handlers.startMcpServer();
      }
      if (event === 'colors') handlers.openColorTheme();
      if (event === 'recover-backup') void openRecoveryDialog();
      if (event === 'close-document') handlers.closeDocument();
      if (event === 'save') handlers.save();
      if (event === 'save-as') handlers.saveAs();
      if (event === 'save-to-workspace') handlers.saveCurrentToWorkspace();
      if (event === 'import-current') handlers.openImportIntoCurrent();
      if (event === 'export-document') handlers.openSaveTemplate();
      if (event.startsWith('recent-workspace:')) handlers.openRecentWorkspace(event.slice('recent-workspace:'.length));
      if (event.startsWith('recent-file:')) handlers.openRecentFile(event.slice('recent-file:'.length));
    });
  } catch (error) {
    showStartupError(error);
  }
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
  if (!isTauriRuntime()) return;
  if (!options.force && (state.document || state.selectedFilePath)) return;
  try {
    await openDocument(await loadDefaultGuide(), { defaultDocument: true });
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = 'Could not load HVY guide';
    mountRoot = render(state, handlers);
  }
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
    rerender({ preserveMountedDocument: true });
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
          rerender({ preserveMountedDocument: true });
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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function workspaceNameForPath(path: string): string {
  return state.workspaces.find((workspace) => workspace.path === path)?.manifest.name ?? 'workspace';
}

function displayDocumentName(name: string): string {
  return name.replace(/\.(t?hvy|md)$/i, '');
}

function importSourceFrom(pastedSourceText: string): ImportSourceFile | null {
  const pasted = pastedSourceText.trim();
  if (pasted.length >= 50) {
    return { path: '', name: 'Pasted text', text: pasted };
  }
  return state.importSource;
}

async function openDocument(file: DocumentFile, options: { defaultDocument?: boolean; isNew?: boolean; recovered?: boolean; deferMount?: boolean } = {}): Promise<void> {
  preserveCurrentDocumentSession();
  state.document?.mounted?.mount.destroy();
  const storedSession = options.defaultDocument || options.recovered || options.isNew ? null : documentSessions.get(file.path);
  const session = storedSession?.dirty || storedSession?.isNew ? storedSession : null;
  const bytes = new Uint8Array(file.bytes);
  const cachedFilterDocument = options.defaultDocument || options.recovered || options.isNew ? null : workspaceFilterDocumentCache.get(file.path) ?? null;
  const document = session?.document ?? cachedFilterDocument ?? await deserializeHvy(bytes, file.extension);
  const recoveryState = options.recovered ? file.recoveryState ?? null : session?.recoveryState ?? null;
  state.document = {
    path: session?.path ?? file.path,
    name: session?.name ?? file.name,
    extension: session?.extension ?? file.extension,
    mode: session?.mode ?? (options.isNew ? 'editor' : 'viewer'),
    dirty: session?.dirty ?? (options.isNew === true || options.recovered === true),
    readOnly: session?.readOnly ?? options.defaultDocument === true,
    isNew: session?.isNew ?? options.isNew === true,
    metaOpen: session?.metaOpen ?? false,
    mounted: null,
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
    isNew: openDocument.isNew,
    metaOpen: openDocument.metaOpen,
    document,
    recoveryState: openDocument.mounted ? getMountedRecoveryState(openDocument.mounted) : null,
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
    isNew: openDocument.isNew,
    metaOpen: openDocument.metaOpen,
    document,
    recoveryState: openDocument.mounted ? getMountedRecoveryState(openDocument.mounted) : null,
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

function bindMountThemeReapply(root: HTMLElement): () => void {
  const controller = new AbortController();
  const overlayObserver = new MutationObserver(() => updateDocumentStageOverlayState(root));
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
  const label = openDocument.readOnly ? 'Read only' : openDocument.dirty ? 'Unsaved' : 'Saved';
  const indicator = document.querySelector<HTMLElement>('.dirty-indicator');
  indicator?.replaceChildren(document.createTextNode(label));
  indicator?.setAttribute('data-state', openDocument.readOnly ? 'read-only' : openDocument.dirty ? 'dirty' : 'clean');
  const saveButton = document.querySelector<HTMLButtonElement>('[data-action="save"]');
  if (openDocument.dirty && !openDocument.readOnly) {
    saveButton?.removeAttribute('disabled');
  } else {
    saveButton?.setAttribute('disabled', '');
  }
  document.querySelector('.status-bar')?.replaceChildren(document.createTextNode(state.status));
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
    await saveCurrentDocumentAs();
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

async function saveCurrentDocumentAs(): Promise<void> {
  await runBusy('Saving as...', async () => {
    await performSaveCurrentDocumentAs();
  });
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
  }
  state.document = {
    path: file.path,
    name: file.name,
    extension: file.extension,
    mode: previousMode,
    dirty: false,
    readOnly: false,
    isNew: false,
    metaOpen: false,
    mounted: null,
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

async function closeCurrentDocument(options: { discard?: boolean } = {}): Promise<void> {
  const openDocument = state.document;
  if (!openDocument) return;
  if (!openDocument.readOnly && openDocument.dirty && !options.discard) {
    state.closeDocumentDialogOpen = true;
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
  backupSnapshots.delete(backupDocumentKey(path, name));
  await clearRecoveryDraftsForDocument(path, name);
  state.closeDocumentDialogOpen = false;
  state.document = null;
  state.selectedFilePath = null;
  state.status = 'Closed document';
  rerender();
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
  const document = state.document?.mounted?.document;
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
    rerender();
    await mountCurrentDocument(document);
  }
}

async function openRecoveryDialogOnBoot(): Promise<void> {
  try {
    state.recoveryBackups = await listDocumentBackups();
    if (state.recoveryBackups.length === 0) return;
    state.recoveryDialogOpen = true;
    state.status = 'Recoverable edits found';
    rerender({ preserveMountedDocument: true });
  } catch {
    state.recoveryBackups = [];
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
  return Boolean(state.document && !state.document.readOnly && state.workspaces.length > 0 && !workspacePathForFile(state.document.path));
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
    name,
    bytes,
  });
  await openDocument(file, { deferMount: true });
  upsertWorkspace(await loadWorkspace(workspacePath));
  await refreshRecents();
  await clearRecoveryDraftsForDocument(previousPath, previousName);
  await clearRecoveryDraftsForDocument(file.path, file.name);
  state.status = `Saved to ${file.name}`;
}

async function moveOpenWorkspaceFileToWorkspace(path: string, workspacePath: string): Promise<void> {
  const sourceWorkspacePath = workspacePathForFile(path);
  const currentDocument = state.document?.path === path ? state.document : null;
  const mountedDocument = currentDocument?.mounted?.document ?? pendingMountDocument;
  const oldBackupKey = currentDocument ? backupDocumentKey(currentDocument.path, currentDocument.name) : null;
  const file = await moveDocumentToWorkspace({ path, workspacePath });
  documentSessions.delete(path);
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
  return state.workspaces.find((workspace) => filePath.startsWith(workspace.path))?.path ?? null;
}

async function refreshSavedTemplates(workspacePath?: string | null): Promise<void> {
  state.savedTemplates = await listSavedTemplates(workspacePath ?? workspacePathForFile(state.document?.path ?? '') ?? state.selectedWorkspacePath);
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

function hasOpenWorkspaceNamed(name: string, exceptPath: string | null = null): boolean {
  const normalized = name.trim().toLowerCase();
  return state.workspaces.some((workspace) => workspace.path !== exceptPath && workspace.manifest.name.trim().toLowerCase() === normalized);
}

function rerender(options: { preserveMountedDocument?: boolean } = {}): void {
  const preserveMount = options.preserveMountedDocument ? mountRoot : null;
  if (!options.preserveMountedDocument) {
    state.document?.mounted?.mount.destroy();
    if (state.document) {
      state.document.mounted = null;
    }
  }
  mountRoot = render(state, handlers, { preserveMount });
  applyAppColorTheme();
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

function documentFileName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (/\.thvy$/i.test(trimmed)) return trimmed.replace(/\.thvy$/i, '.hvy');
  return hasDocumentExtension(trimmed) ? trimmed : `${trimmed}.hvy`;
}

function documentTitle(fileName: string): string {
  return fileName.replace(/\.(t?hvy|md)$/i, '');
}

function hasDocumentExtension(fileName: string): boolean {
  return /\.(t?hvy)$/i.test(fileName);
}

function templateFileName(name: string): string {
  const trimmed = name.trim();
  const base = trimmed.replace(/\.(t?hvy|hvy|md)$/i, '').trim() || 'Untitled';
  return `${base}.thvy`;
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
