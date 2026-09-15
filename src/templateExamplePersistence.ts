import { loadWorkspace, readDocumentFile, saveDocumentFile, type SaveDocumentRequest, type WorkspaceTreeNode } from './backend';
import { deserializeHvy, serializeHvy } from './hvy';
import { state } from './state';
import { templateExampleDirectory, workspaceTemplateForExample } from './templateExamples';
import { updateExampleDefinitions } from './templateExampleUpdates';

export async function updateSavedTemplateExamples(request: SaveDocumentRequest): Promise<void> {
  const workspace = state.workspaces.find((candidate) => request.path.replaceAll('\\', '/').startsWith(`${candidate.path.replaceAll('\\', '/')}/templates/`));
  if (!workspace) return;
  const relativePath = request.path.slice(workspace.path.length + 1).replaceAll('\\', '/');
  const owner = workspaceTemplateForExample(workspace, relativePath);
  if (!owner || owner.relativePath !== relativePath) return;
  const refreshed = await loadWorkspace(workspace.path);
  const directory = templateExampleDirectory(relativePath);
  const files: Extract<WorkspaceTreeNode, { kind: 'file' }>[] = [];
  const collect = (nodes: WorkspaceTreeNode[]): void => {
    for (const node of nodes) {
      if (node.kind === 'folder') collect(node.children);
      else if (node.relativePath.startsWith(`${directory}/`) && node.extension !== '.md' && !node.archived) files.push(node);
    }
  };
  collect(refreshed.files);
  if (!files.length) return;
  const template = await deserializeHvy(new Uint8Array(request.bytes), owner.extension);
  const { documentSessions, workspaceFilterDocumentCache, mountCurrentDocument } = await import('./main');
  for (const file of files) {
    const disk = await readDocumentFile(file.path);
    const example = await deserializeHvy(new Uint8Array(disk.bytes), file.extension);
    updateExampleDefinitions(example, template);
    await saveDocumentFile({ path: file.path, bytes: await serializeHvy(example) });
    workspaceFilterDocumentCache.delete(file.path);
    for (const session of documentSessions.values()) {
      if (session.source.path !== file.path || session.virtual) continue;
      if (session.dirty) updateExampleDefinitions(session.document, template);
      else session.document = example;
      session.recoveryState = null;
    }
    if (state.document?.source.path === file.path && !state.document.virtual) {
      const current = state.document.mounted?.document ?? example;
      updateExampleDefinitions(current, template);
      await mountCurrentDocument(current);
    }
  }
}
