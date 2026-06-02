import { defaultAiSettings, defaultMcpClientInstallStatus, defaultMcpServerStatus, defaultMcpSettings, defaultMcpStdioLaunchConfig, type AiSettings, type ArchivedWorkspace, type DocumentBackup, type DocumentCreationType, type DocumentExtension, type ImportSourceFile, type McpClientInstallStatus, type McpServerStatus, type McpSettings, type McpStdioLaunchConfig, type SavedTemplate, type TemplateScope, type Workspace, type WorkspaceFileNode, type WorkspaceTreeNode, type RecentState } from './backend';
import { defaultColorThemeSettings, type ColorThemeSettings } from './colorTheme';
import type { HvyMode, MountedDocument } from './hvy';
import type { HvyDocumentSearchMode, HvySearchSnapshot, SearchFilterMode } from '../../heavy-file-format/src/search/types';

export interface OpenDocument {
  path: string;
  name: string;
  extension: DocumentExtension;
  mode: HvyMode;
  dirty: boolean;
  readOnly: boolean;
  hiddenFromAI: boolean;
  isNew: boolean;
  metaOpen: boolean;
  mounted: MountedDocument | null;
  recoveryBackupId: string | null;
}

export interface OpenDocumentTab {
  path: string;
  name: string;
  dirty: boolean;
  readOnly: boolean;
  hiddenFromAI: boolean;
  active: boolean;
}

export interface AppState {
  workspaces: Workspace[];
  archivedWorkspaces: ArchivedWorkspace[];
  selectedWorkspacePath: string | null;
  selectedFilePath: string | null;
  recent: RecentState;
  aiSettings: AiSettings;
  mcpSettings: McpSettings;
  mcpServerStatus: McpServerStatus;
  mcpStdioLaunchConfig: McpStdioLaunchConfig;
  mcpClientInstallStatus: McpClientInstallStatus[];
  colorTheme: ColorThemeSettings;
  savedTemplates: SavedTemplate[];
  document: OpenDocument | null;
  documentTabs: OpenDocumentTab[];
  status: string;
  error: string | null;
  busy: boolean;
  newWorkspaceDialogOpen: boolean;
  workspaceInitializationDialogOpen: boolean;
  workspaceInitializationPath: string | null;
  workspaceInitializationName: string | null;
  workspaceManagerOpen: boolean;
  openWorkspaceActionsPath: string | null;
  workspaceExpanded: Record<string, boolean>;
  newWorkspaceLocation: 'managed' | 'choose';
  newDocumentWorkspacePath: string | null;
  newDocumentType: DocumentCreationType;
  importWorkspacePath: string | null;
  importDocumentType: DocumentCreationType;
  importIntoCurrentDialogOpen: boolean;
  importSourceTab: 'workspace' | 'anywhere';
  importSource: ImportSourceFile | null;
  importOutputMode: 'current' | 'workspace';
  importExcludeTags: string;
  importProgressDialogOpen: boolean;
  saveTemplateScope: TemplateScope;
  saveAsDialogOpen: boolean;
  saveAsKind: 'document' | 'template';
  saveAsScope: 'workspace' | 'anywhere';
  exportPdfSavePromptOpen: boolean;
  exportedPdfPath: string | null;
  workspaceTemplateVisibilityPath: string | null;
  aiSettingsDialogOpen: boolean;
  aiSettingsDraft: AiSettings | null;
  aiSettingsDialogInitialJson: string | null;
  aiSettingsDiscardDialogOpen: boolean;
  aiSettingsSelectedProviderId: string | null;
  mcpSettingsDialogOpen: boolean;
  mcpSettingsDraft: McpSettings | null;
  mcpSettingsDialogInitialJson: string | null;
  mcpSettingsDiscardDialogOpen: boolean;
  colorThemeDialogOpen: boolean;
  aboutDialogOpen: boolean;
  recoveryDialogOpen: boolean;
  closeDocumentDialogOpen: boolean;
  closeDocumentTargetPath: string | null;
  closeDocumentDraftDialogOpen: boolean;
  tabStackOpen: boolean;
  tabStackIndex: number;
  appCloseDialogOpen: boolean;
  recoveryBackups: DocumentBackup[];
  workspaceClipboard: WorkspaceClipboardState | null;
  renameFilePath: string | null;
  renameFileCurrentName: string | null;
  deleteFilePath: string | null;
  deleteFileName: string | null;
  workspaceTransfer: WorkspaceTransferState | null;
  workspaceFilter: WorkspaceFilterState;
  workspaceFilters: Record<string, WorkspaceFilterConfig>;
  workspaceFileViews: Record<string, WorkspaceFileView>;
}

export type WorkspaceFileView = 'documents' | 'templates';

export interface WorkspaceFilterConfig {
  query: string;
  mode: HvyDocumentSearchMode;
  filterMode: SearchFilterMode;
  snapshots: Record<string, HvySearchSnapshot>;
}

export interface WorkspaceFilterState {
  open: boolean;
  workspacePath: string | null;
  queryDraft: string;
  submittedQuery: string;
  mode: HvyDocumentSearchMode;
  filterMode: SearchFilterMode;
  isLoading: boolean;
  status: string | null;
  error: string | null;
}

export interface WorkspaceTransferState {
  mode: 'saveCurrent' | 'copyFile' | 'moveFile';
  sourcePath: string | null;
  fileName: string;
  nameDraft: string;
  excludedWorkspacePath: string | null;
}

export interface WorkspaceClipboardState {
  mode: 'copy' | 'cut';
  path: string;
  name: string;
}

export const state: AppState = {
  workspaces: [],
  archivedWorkspaces: [],
  selectedWorkspacePath: null,
  selectedFilePath: null,
  recent: { workspaces: [], files: [] },
  aiSettings: defaultAiSettings(),
  mcpSettings: defaultMcpSettings(),
  mcpServerStatus: defaultMcpServerStatus(),
  mcpStdioLaunchConfig: defaultMcpStdioLaunchConfig(),
  mcpClientInstallStatus: defaultMcpClientInstallStatus(),
  colorTheme: defaultColorThemeSettings(),
  savedTemplates: [],
  document: null,
  documentTabs: [],
  status: 'Ready',
  error: null,
  busy: false,
  newWorkspaceDialogOpen: false,
  workspaceInitializationDialogOpen: false,
  workspaceInitializationPath: null,
  workspaceInitializationName: null,
  workspaceManagerOpen: false,
  openWorkspaceActionsPath: null,
  workspaceExpanded: {},
  newWorkspaceLocation: 'managed',
  newDocumentWorkspacePath: null,
  newDocumentType: 'hvy',
  importWorkspacePath: null,
  importDocumentType: 'hvy',
  importIntoCurrentDialogOpen: false,
  importSourceTab: 'workspace',
  importSource: null,
  importOutputMode: 'current',
  importExcludeTags: '',
  importProgressDialogOpen: false,
  saveTemplateScope: 'app',
  saveAsDialogOpen: false,
  saveAsKind: 'document',
  saveAsScope: 'workspace',
  exportPdfSavePromptOpen: false,
  exportedPdfPath: null,
  workspaceTemplateVisibilityPath: null,
  aiSettingsDialogOpen: false,
  aiSettingsDraft: null,
  aiSettingsDialogInitialJson: null,
  aiSettingsDiscardDialogOpen: false,
  aiSettingsSelectedProviderId: null,
  mcpSettingsDialogOpen: false,
  mcpSettingsDraft: null,
  mcpSettingsDialogInitialJson: null,
  mcpSettingsDiscardDialogOpen: false,
  colorThemeDialogOpen: false,
  aboutDialogOpen: false,
  recoveryDialogOpen: false,
  closeDocumentDialogOpen: false,
  closeDocumentTargetPath: null,
  closeDocumentDraftDialogOpen: false,
  tabStackOpen: false,
  tabStackIndex: 0,
  appCloseDialogOpen: false,
  recoveryBackups: [],
  workspaceClipboard: null,
  renameFilePath: null,
  renameFileCurrentName: null,
  deleteFilePath: null,
  deleteFileName: null,
  workspaceTransfer: null,
  workspaceFilter: {
    open: false,
    workspacePath: null,
    queryDraft: '',
    submittedQuery: '',
    mode: 'keyword',
    filterMode: 'deprioritize',
    isLoading: false,
    status: null,
    error: null,
  },
  workspaceFilters: {},
  workspaceFileViews: {},
};

export function findFileInWorkspace(workspace: Workspace, path: string): WorkspaceFileNode | null {
  const visit = (nodes: WorkspaceTreeNode[]): WorkspaceFileNode | null => {
    for (const node of nodes) {
      if (node.kind === 'file' && node.path === path) {
        return node;
      }
      if (node.kind === 'folder') {
        const match = visit(node.children);
        if (match) {
          return match;
        }
      }
    }
    return null;
  };
  return visit(workspace.files);
}

export function workspacePathForFileInWorkspaces(workspaces: Workspace[], path: string): string | null {
  return workspaces.find((workspace) => findFileInWorkspace(workspace, path))?.path ?? null;
}

export function workspaceFileAccessInWorkspaces(
  workspaces: Workspace[],
  path: string,
): { archived: boolean; locked: boolean; hiddenFromAI: boolean; readOnly: boolean } {
  for (const workspace of workspaces) {
    const file = findFileInWorkspace(workspace, path);
    if (file) {
      const archived = file.archived === true;
      const locked = file.locked === true;
      return {
        archived,
        locked,
        hiddenFromAI: file.hiddenFromAI === true,
        readOnly: archived || locked,
      };
    }
  }
  return { archived: false, locked: false, hiddenFromAI: false, readOnly: false };
}
