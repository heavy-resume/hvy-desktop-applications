import type { DocumentFile, Workspace, WorkspaceFileNode, WorkspaceTreeNode } from './backend';

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

export function findFileInWorkspaces(workspaces: Workspace[], path: string): WorkspaceFileNode | null {
  for (const workspace of workspaces) {
    const file = findFileInWorkspace(workspace, path);
    if (file) return file;
  }
  return null;
}

export function documentFileWithWorkspaceName(file: DocumentFile, workspaces: Workspace[]): DocumentFile {
  const workspaceFile = findFileInWorkspaces(workspaces, file.path);
  return workspaceFile
    ? { ...file, name: workspaceFile.name, extension: workspaceFile.extension }
    : file;
}

export function workspaceRelativeFilePath(
  workspaces: Workspace[],
  workspacePaths: string[],
  path: string,
): string {
  const file = findFileInWorkspaces(workspaces, path);
  if (file) {
    const relativePath = file.relativePath
      ?? (file as WorkspaceFileNode & { relative_path?: string }).relative_path;
    if (relativePath) return relativePath;
  }

  const normalizedPath = path.replaceAll('\\', '/');
  const workspacePath = workspacePaths
    .map((candidate) => candidate.replaceAll('\\', '/').replace(/\/+$/, ''))
    .filter((candidate) => normalizedPath.toLocaleLowerCase().startsWith(`${candidate.toLocaleLowerCase()}/`))
    .sort((left, right) => right.length - left.length)[0];
  if (workspacePath) return normalizedPath.slice(workspacePath.length + 1);
  return normalizedPath.split('/').filter(Boolean).at(-1) ?? path;
}

export function filePathBelongsToWorkspace(path: string, workspacePath: string): boolean {
  const normalizedPath = path.replaceAll('\\', '/').replace(/\/+$/, '').toLocaleLowerCase();
  const normalizedWorkspacePath = workspacePath.replaceAll('\\', '/').replace(/\/+$/, '').toLocaleLowerCase();
  return normalizedPath.startsWith(`${normalizedWorkspacePath}/`);
}

export function workspacePathForFileInWorkspaces(workspaces: Workspace[], path: string): string | null {
  return workspaces.find((workspace) => findFileInWorkspace(workspace, path))?.path ?? null;
}

export function workspaceFileAccessInWorkspaces(
  workspaces: Workspace[],
  path: string,
): { archived: boolean; locked: boolean; hiddenFromAI: boolean; encryptedAIAllowed: boolean; readOnly: boolean } {
  for (const workspace of workspaces) {
    const file = findFileInWorkspace(workspace, path);
    if (file) {
      const archived = file.archived === true;
      const locked = file.locked === true;
      return {
        archived,
        locked,
        hiddenFromAI: file.hiddenFromAI === true,
        encryptedAIAllowed: file.encryptedAIAllowed === true,
        readOnly: archived || locked,
      };
    }
  }
  return { archived: false, locked: false, hiddenFromAI: false, encryptedAIAllowed: false, readOnly: false };
}
