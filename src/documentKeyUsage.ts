import { readDocumentFileBytes, type Workspace, type WorkspaceFileNode, type WorkspaceTreeNode } from './backend';
import { extractEncryptionKeyIds } from './documentKeys';

export interface DocumentKeyUsage {
  documents: string[];
  folders: string[];
}

function collectWorkspaceUsage(
  workspaceName: string,
  nodes: WorkspaceTreeNode[],
  documents: Array<{ file: WorkspaceFileNode; label: string }>,
  folders: Map<string, Set<string>>,
  logicalParent: string[] = [],
  inheritedFolderKeyId?: string,
): void {
  for (const node of nodes) {
    const logicalPath = [...logicalParent, node.name];
    const label = [workspaceName, ...logicalPath].join(' / ');
    if (node.kind === 'file') {
      documents.push({ file: node, label });
      continue;
    }
    if (node.encryptedFolderKeyId && node.encryptedFolderKeyId !== inheritedFolderKeyId) {
      const labels = folders.get(node.encryptedFolderKeyId) ?? new Set<string>();
      labels.add(label);
      folders.set(node.encryptedFolderKeyId, labels);
    }
    collectWorkspaceUsage(
      workspaceName,
      node.children,
      documents,
      folders,
      logicalPath,
      node.encryptedFolderKeyId ?? inheritedFolderKeyId,
    );
  }
}

export async function workspaceDocumentKeyUsage(workspaces: Workspace[]): Promise<Record<string, DocumentKeyUsage>> {
  const documents: Array<{ file: WorkspaceFileNode; label: string }> = [];
  const folders = new Map<string, Set<string>>();
  for (const workspace of workspaces) {
    collectWorkspaceUsage(workspace.manifest.name, workspace.files, documents, folders);
  }
  const inspected = await Promise.all(documents.map(async ({ file, label }) => ({
    keyIds: extractEncryptionKeyIds(await readDocumentFileBytes(file.path))
      .filter((keyId) => keyId !== file.encryptedFolderKeyId),
    label,
  })));
  const documentUsage = new Map<string, Set<string>>();
  for (const document of inspected) {
    for (const keyId of document.keyIds) {
      const labels = documentUsage.get(keyId) ?? new Set<string>();
      labels.add(document.label);
      documentUsage.set(keyId, labels);
    }
  }
  const keyIds = new Set([...documentUsage.keys(), ...folders.keys()]);
  return Object.fromEntries([...keyIds].map((keyId) => [keyId, {
    documents: [...(documentUsage.get(keyId) ?? [])].sort(),
    folders: [...(folders.get(keyId) ?? [])].sort(),
  }]));
}
