import type { Workspace, WorkspaceFileNode, WorkspaceTreeNode } from './backend';

export function findFileInWorkspace(workspace: Workspace, path: string): WorkspaceFileNode | null {
  const visit = (nodes: WorkspaceTreeNode[]): WorkspaceFileNode | null => {
    for (const node of nodes) {
      if (node.kind === 'file' && node.path === path) return node;
      if (node.kind === 'folder') {
        const match = visit(node.children);
        if (match) return match;
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
