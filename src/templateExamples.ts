import type { Workspace, WorkspaceTreeNode } from './backend';

export function templateExampleDirectory(relativePath: string): string {
  return relativePath.replace(/\.(thvy|phvy)$/i, '');
}

export function workspaceTemplateForExample(workspace: Workspace, relativePath: string): Extract<WorkspaceTreeNode, { kind: 'file' }> | null {
  const normalized = relativePath.replaceAll('\\', '/');
  const visit = (nodes: WorkspaceTreeNode[]): Extract<WorkspaceTreeNode, { kind: 'file' }> | null => {
    for (const node of nodes) {
      if (node.kind === 'folder') {
        const found = visit(node.children);
        if (found) return found;
      } else if (/\.(thvy|phvy)$/i.test(node.name) && node.relativePath.startsWith('templates/')) {
        if (node.relativePath === normalized || normalized.startsWith(`${templateExampleDirectory(node.relativePath)}/`)) return node;
      }
    }
    return null;
  };
  return visit(workspace.files);
}

export type ExampleTreeNode = WorkspaceTreeNode & { examples?: WorkspaceTreeNode[] };

export function groupTemplateExamples(nodes: WorkspaceTreeNode[]): ExampleTreeNode[] {
  const owners = new Map(nodes.filter((node) => node.kind === 'file' && /\.(thvy|phvy)$/i.test(node.name))
    .map((node) => [templateExampleDirectory(node.relativePath), node]));
  return nodes.flatMap((node): ExampleTreeNode[] => {
    if (node.kind === 'folder') {
      if (owners.has(node.relativePath)) return [];
      return [{ ...node, children: groupTemplateExamples(node.children) }];
    }
    const folder = nodes.find((candidate) => candidate.kind === 'folder' && candidate.relativePath === templateExampleDirectory(node.relativePath));
    return [{ ...node, ...(folder?.kind === 'folder' ? { examples: folder.children } : {}) }];
  });
}
