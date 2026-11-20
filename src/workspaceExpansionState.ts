import type { WorkspaceTreeNode } from './backend';

const WORKSPACE_EXPANSION_STORAGE_KEY = 'hvy-galaxy:workspace-expansion';

export function loadWorkspaceExpansionState(): Record<string, boolean> {
  const stored = JSON.parse(localStorage.getItem(WORKSPACE_EXPANSION_STORAGE_KEY) ?? '{}') as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(stored).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'),
  );
}

export function saveWorkspaceExpansionState(expandedByPath: Record<string, boolean>): void {
  localStorage.setItem(WORKSPACE_EXPANSION_STORAGE_KEY, JSON.stringify(expandedByPath));
}

const WORKSPACE_FOLDER_EXPANSION_STORAGE_KEY = 'hvy-galaxy:workspace-folder-expansion';

export function loadWorkspaceFolderExpansionState(): Record<string, Record<string, boolean>> {
  const stored = JSON.parse(localStorage.getItem(WORKSPACE_FOLDER_EXPANSION_STORAGE_KEY) ?? '{}') as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(stored)
      .filter((entry): entry is [string, Record<string, unknown>] => typeof entry[1] === 'object' && entry[1] !== null)
      .map(([workspacePath, folders]) => [
        workspacePath,
        Object.fromEntries(
          Object.entries(folders).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'),
        ),
      ]),
  );
}

export function saveWorkspaceFolderExpansionState(expandedByWorkspace: Record<string, Record<string, boolean>>): void {
  localStorage.setItem(WORKSPACE_FOLDER_EXPANSION_STORAGE_KEY, JSON.stringify(expandedByWorkspace));
}

export function normalizeFolderPath(relativePath: string): string {
  return relativePath.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
}

// Keeps entries for folders still in the tree. Entries inside a folder whose contents aren't loaded (a locked encrypted folder) are kept, since those folders can't be seen yet.
export function prunedFolderExpansion(
  expanded: Record<string, boolean>,
  files: WorkspaceTreeNode[],
): Record<string, boolean> {
  const existing = new Set<string>();
  const unloaded: string[] = [];
  const visit = (nodes: WorkspaceTreeNode[]) => {
    for (const node of nodes) {
      if (node.kind !== 'folder') continue;
      const path = normalizeFolderPath(node.relativePath);
      existing.add(path);
      if (node.encryptionState && node.encryptionState !== 'unlocked') unloaded.push(`${path}/`);
      visit(node.children);
    }
  };
  visit(files);
  return Object.fromEntries(
    Object.entries(expanded).filter(([path]) => existing.has(path) || unloaded.some((prefix) => path.startsWith(prefix))),
  );
}

// Moves the entries for a renamed folder, and the folders inside it, to its new path.
export function relocatedFolderExpansion(
  expanded: Record<string, boolean>,
  previousDirectory: string,
  nextDirectory: string,
): Record<string, boolean> {
  const previous = normalizeFolderPath(previousDirectory);
  const next = normalizeFolderPath(nextDirectory);
  return Object.fromEntries(Object.entries(expanded).map(([path, open]) => [
    path === previous ? next : path.startsWith(`${previous}/`) ? `${next}${path.slice(previous.length)}` : path,
    open,
  ]));
}
