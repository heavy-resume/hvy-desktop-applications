import type { AiSettings, DocumentExtension, Galaxy, GalaxyFileNode, GalaxyTreeNode, RecentState } from './backend';
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
  newDocumentGalaxyPath: string | null;
  aiSettingsDialogOpen: boolean;
}

export const state: AppState = {
  galaxies: [],
  selectedGalaxyPath: null,
  selectedFilePath: null,
  recent: { galaxies: [], files: [] },
  aiSettings: {
    provider: 'ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKey: '',
    model: '',
  },
  document: null,
  status: 'Ready',
  error: null,
  busy: false,
  newGalaxyDialogOpen: false,
  newDocumentGalaxyPath: null,
  aiSettingsDialogOpen: false,
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
