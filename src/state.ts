import { defaultAiSettings, type AiSettings, type DocumentBackup, type DocumentExtension, type Galaxy, type GalaxyFileNode, type GalaxyTreeNode, type RecentState } from './backend';
import type { HvyMode, MountedDocument } from './hvy';

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
  galaxies: Galaxy[];
  selectedGalaxyPath: string | null;
  selectedFilePath: string | null;
  recent: RecentState;
  aiSettings: AiSettings;
  document: OpenDocument | null;
  status: string;
  error: string | null;
  busy: boolean;
  newGalaxyDialogOpen: boolean;
  openGalaxyActionsPath: string | null;
  newGalaxyLocation: 'managed' | 'choose';
  newDocumentGalaxyPath: string | null;
  aiSettingsDialogOpen: boolean;
  aiSettingsDraft: AiSettings | null;
  aiSettingsDialogInitialJson: string | null;
  recoveryDialogOpen: boolean;
  recoveryBackups: DocumentBackup[];
}

export const state: AppState = {
  galaxies: [],
  selectedGalaxyPath: null,
  selectedFilePath: null,
  recent: { galaxies: [], files: [] },
  aiSettings: defaultAiSettings(),
  document: null,
  status: 'Ready',
  error: null,
  busy: false,
  newGalaxyDialogOpen: false,
  openGalaxyActionsPath: null,
  newGalaxyLocation: 'managed',
  newDocumentGalaxyPath: null,
  aiSettingsDialogOpen: false,
  aiSettingsDraft: null,
  aiSettingsDialogInitialJson: null,
  recoveryDialogOpen: false,
  recoveryBackups: [],
};

export function findFileInGalaxy(galaxy: Galaxy, path: string): GalaxyFileNode | null {
  const visit = (nodes: GalaxyTreeNode[]): GalaxyFileNode | null => {
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
  return visit(galaxy.files);
}
