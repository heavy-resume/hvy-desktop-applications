import { defaultAiSettings, type AiSettings, type DocumentBackup, type DocumentExtension, type Workspace, type WorkspaceFileNode, type WorkspaceTreeNode, type RecentState } from './backend';
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
  colorThemeDialogOpen: boolean;
  aboutDialogOpen: boolean;
  recoveryDialogOpen: boolean;
  recoveryBackups: DocumentBackup[];
  workspaceSearch: WorkspaceSearchState;
}

export interface WorkspaceSearchState {
  open: boolean;
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
  colorThemeDialogOpen: false,
  aboutDialogOpen: false,
  recoveryDialogOpen: false,
  recoveryBackups: [],
  workspaceSearch: {
    open: false,
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
