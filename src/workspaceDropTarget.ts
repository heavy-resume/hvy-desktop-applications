export interface WorkspaceDropTarget {
  element: HTMLElement;
  workspacePath: string;
  targetDirectory: string;
}

export function parentDirectoryForRelativePath(relativePath: string): string {
  const segments = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
  segments.pop();
  return segments.join('/');
}

export function workspaceDropTargetFromElement(target: Element | null): WorkspaceDropTarget | null {
  if (!target) return null;

  const directFolderTarget = target.closest<HTMLElement>('.tree [data-workspace-folder-target="true"]');
  let folderContents = target.closest<HTMLElement>('.tree');
  let contentsFolderTarget: HTMLElement | null = null;
  while (folderContents && !contentsFolderTarget) {
    contentsFolderTarget = folderContents.parentElement?.querySelector<HTMLElement>(
      ':scope > [data-workspace-folder-target="true"]',
    ) ?? null;
    folderContents = folderContents.parentElement?.closest<HTMLElement>('.tree') ?? null;
  }
  const folderTarget = directFolderTarget ?? contentsFolderTarget;
  if (folderTarget?.dataset.workspacePath) {
    return {
      element: folderTarget,
      workspacePath: folderTarget.dataset.workspacePath,
      targetDirectory: folderTarget.dataset.targetDirectory ?? '',
    };
  }

  const workspaceRoot = target.closest<HTMLElement>('.workspace-root');
  const workspacePath = workspaceRoot?.dataset.workspacePath;
  return workspaceRoot && workspacePath
    ? { element: workspaceRoot, workspacePath, targetDirectory: workspaceRoot.dataset.targetDirectory ?? '' }
    : null;
}
