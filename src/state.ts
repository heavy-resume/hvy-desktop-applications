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
  isNew: boolean;
  metaOpen: boolean;
  mounted: MountedDocument | null;
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
  status: string;
  error: string | null;
  busy: boolean;
  newWorkspaceDialogOpen: boolean;
  workspaceManagerOpen: boolean;
  openWorkspaceActionsPath: string | null;
  newWorkspaceLocation: 'managed' | 'choose';
  newDocumentWorkspacePath: string | null;
  newDocumentType: DocumentCreationType;
  importWorkspacePath: string | null;
  importDocumentType: DocumentCreationType;
  importIntoCurrentDialogOpen: boolean;
  importSource: ImportSourceFile | null;
  saveTemplateDialogOpen: boolean;
  saveTemplateScope: TemplateScope;
  exportPdfSavePromptOpen: boolean;
  workspaceTemplateVisibilityPath: string | null;
  aiSettingsDialogOpen: boolean;
  aiSettingsDraft: AiSettings | null;
  aiSettingsDialogInitialJson: string | null;
  mcpSettingsDialogOpen: boolean;
  mcpSettingsDraft: McpSettings | null;
  mcpSettingsDialogInitialJson: string | null;
  colorThemeDialogOpen: boolean;
  aboutDialogOpen: boolean;
  recoveryDialogOpen: boolean;
  closeDocumentDialogOpen: boolean;
  appCloseDialogOpen: boolean;
  recoveryBackups: DocumentBackup[];
  workspaceClipboard: WorkspaceClipboardState | null;
  renameFilePath: string | null;
  renameFileCurrentName: string | null;
  workspaceTransfer: WorkspaceTransferState | null;
  workspaceFilter: WorkspaceFilterState;
  workspaceFilters: Record<string, WorkspaceFilterConfig>;
}

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
  status: 'Ready',
  error: null,
  busy: false,
  newWorkspaceDialogOpen: false,
  workspaceManagerOpen: false,
  openWorkspaceActionsPath: null,
  newWorkspaceLocation: 'managed',
  newDocumentWorkspacePath: null,
  newDocumentType: 'hvy',
  importWorkspacePath: null,
  importDocumentType: 'hvy',
  importIntoCurrentDialogOpen: false,
  importSource: null,
  saveTemplateDialogOpen: false,
  saveTemplateScope: 'app',
  exportPdfSavePromptOpen: false,
  workspaceTemplateVisibilityPath: null,
  aiSettingsDialogOpen: false,
  aiSettingsDraft: null,
  aiSettingsDialogInitialJson: null,
  mcpSettingsDialogOpen: false,
  mcpSettingsDraft: null,
  mcpSettingsDialogInitialJson: null,
  colorThemeDialogOpen: false,
  aboutDialogOpen: false,
  recoveryDialogOpen: false,
  closeDocumentDialogOpen: false,
  appCloseDialogOpen: false,
  recoveryBackups: [],
  workspaceClipboard: null,
  renameFilePath: null,
  renameFileCurrentName: null,
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
