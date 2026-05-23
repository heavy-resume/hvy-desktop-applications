import { defaultAiSettings, defaultMcpServerStatus, defaultMcpSettings, defaultMcpStdioLaunchConfig, type AiSettings, type DocumentBackup, type DocumentExtension, type McpServerStatus, type McpSettings, type McpStdioLaunchConfig, type Workspace, type WorkspaceFileNode, type WorkspaceTreeNode, type RecentState } from './backend';
import { defaultColorThemeSettings, type ColorThemeSettings } from './colorTheme';
import type { HvyMode, MountedDocument } from './hvy';
import type { HvyDocumentSearchMode, HvyDocumentSearchResult } from '../../heavy-file-format/src/search/types';

export interface OpenDocument {
  path: string;
  name: string;
  extension: DocumentExtension;
  mode: HvyMode;
  dirty: boolean;
  readOnly: boolean;
  isNew: boolean;
  mounted: MountedDocument | null;
}

export interface AppState {
  workspaces: Workspace[];
  selectedWorkspacePath: string | null;
  selectedFilePath: string | null;
  recent: RecentState;
  aiSettings: AiSettings;
  mcpSettings: McpSettings;
  mcpServerStatus: McpServerStatus;
  mcpStdioLaunchConfig: McpStdioLaunchConfig;
  colorTheme: ColorThemeSettings;
  document: OpenDocument | null;
  status: string;
  error: string | null;
  busy: boolean;
  newWorkspaceDialogOpen: boolean;
  openWorkspaceActionsPath: string | null;
  newWorkspaceLocation: 'managed' | 'choose';
  newDocumentWorkspacePath: string | null;
  aiSettingsDialogOpen: boolean;
  aiSettingsDraft: AiSettings | null;
  aiSettingsDialogInitialJson: string | null;
  mcpSettingsDialogOpen: boolean;
  mcpSettingsDraft: McpSettings | null;
  mcpSettingsDialogInitialJson: string | null;
  colorThemeDialogOpen: boolean;
  aboutDialogOpen: boolean;
  recoveryDialogOpen: boolean;
  recoveryBackups: DocumentBackup[];
  workspaceSearch: WorkspaceSearchState;
}

export interface WorkspaceSearchState {
  open: boolean;
  workspacePath: string | null;
  queryDraft: string;
  submittedQuery: string;
  mode: HvyDocumentSearchMode;
  isLoading: boolean;
  error: string | null;
  results: HvyDocumentSearchResult[];
  activeResultId: string | null;
}

export const state: AppState = {
  workspaces: [],
  selectedWorkspacePath: null,
  selectedFilePath: null,
  recent: { workspaces: [], files: [] },
  aiSettings: defaultAiSettings(),
  mcpSettings: defaultMcpSettings(),
  mcpServerStatus: defaultMcpServerStatus(),
  mcpStdioLaunchConfig: defaultMcpStdioLaunchConfig(),
  colorTheme: defaultColorThemeSettings(),
  document: null,
  status: 'Ready',
  error: null,
  busy: false,
  newWorkspaceDialogOpen: false,
  openWorkspaceActionsPath: null,
  newWorkspaceLocation: 'managed',
  newDocumentWorkspacePath: null,
  aiSettingsDialogOpen: false,
  aiSettingsDraft: null,
  aiSettingsDialogInitialJson: null,
  mcpSettingsDialogOpen: false,
  mcpSettingsDraft: null,
  mcpSettingsDialogInitialJson: null,
  colorThemeDialogOpen: false,
  aboutDialogOpen: false,
  recoveryDialogOpen: false,
  recoveryBackups: [],
  workspaceSearch: {
    open: false,
    workspacePath: null,
    queryDraft: '',
    submittedQuery: '',
    mode: 'keyword',
    isLoading: false,
    error: null,
    results: [],
    activeResultId: null,
  },
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
