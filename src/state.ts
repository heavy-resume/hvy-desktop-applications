import type { DocumentExtension, Galaxy, GalaxyFileNode, GalaxyTreeNode, RecentState } from './backend';
import type { HvyMode, MountedDocument } from './hvy';

export interface OpenDocument {
  path: string;
  name: string;
  extension: DocumentExtension;
  mode: HvyMode;
  dirty: boolean;
  mounted: MountedDocument | null;
}

export interface AppState {
  galaxies: Galaxy[];
  selectedGalaxyPath: string | null;
  selectedFilePath: string | null;
  recent: RecentState;
  document: OpenDocument | null;
  status: string;
  error: string | null;
  busy: boolean;
}

export const state: AppState = {
  galaxies: [],
  selectedGalaxyPath: null,
  selectedFilePath: null,
  recent: { galaxies: [], files: [] },
  document: null,
  status: 'Ready',
  error: null,
  busy: false,
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
