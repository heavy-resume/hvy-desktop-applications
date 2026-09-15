import { diffTemplateContent, updateExampleContent } from './templateExampleContent';
import { loadWorkspace, readDocumentFile, saveDocumentFile, type SaveDocumentRequest, type WorkspaceTreeNode } from './backend';
import { deserializeHvy, serializeHvy, type VisualDocument } from './hvy';
import { state } from './state';
import { templateExampleDirectory, workspaceTemplateForExample } from './templateExamples';
import { updateExampleDefinitions } from './templateExampleUpdates';

async function loadExampleTemplateContext(path: string) {
  const workspace = state.workspaces.find((candidate) => path.replaceAll('\\', '/').startsWith(`${candidate.path.replaceAll('\\', '/')}/templates/`));
  if (!workspace) return null;
  const relativePath = path.slice(workspace.path.length + 1).replaceAll('\\', '/');
  // The navigator's cached workspace can omit templates in Documents view.
  const refreshed = await loadWorkspace(workspace.path, { includeTemplates: true });
  const owner = workspaceTemplateForExample(refreshed, relativePath);
  if (!owner) return null;
  return { refreshed, relativePath, owner };
}

export async function updateSavedTemplateExamples(request: SaveDocumentRequest, previousBytes?: number[] | Uint8Array): Promise<void> {
  const context = await loadExampleTemplateContext(request.path);
  if (!context || context.owner.relativePath !== context.relativePath) return;
  const { refreshed, relativePath, owner } = context;
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
  const previous = previousBytes ? await deserializeHvy(new Uint8Array(previousBytes), owner.extension) : null;
  const updatedDocuments = new Set<typeof template>();
  const update = (document: typeof template): void => {
    if (updatedDocuments.has(document)) return;
    updatedDocuments.add(document);
    updateExampleContent(document, previous, template);
    updateExampleDefinitions(document, template);
  };
  const { documentSessions, workspaceFilterDocumentCache, mountCurrentDocument } = await import('./main');
  for (const file of files) {
    const disk = await readDocumentFile(file.path);
    const example = await deserializeHvy(new Uint8Array(disk.bytes), file.extension);
    update(example);
    await saveDocumentFile({ path: file.path, bytes: await serializeHvy(example) });
    workspaceFilterDocumentCache.delete(file.path);
    for (const session of documentSessions.values()) {
      if (session.source.path !== file.path || session.virtual) continue;
      if (session.dirty) update(session.document);
      else session.document = example;
      session.recoveryState = null;
    }
    if (state.document?.source.path === file.path && !state.document.virtual) {
      const current = state.document.mounted?.document ?? example;
      update(current);
      await mountCurrentDocument(current);
    }
  }
}

export async function readPreviousExampleTemplate(path: string): Promise<number[] | Uint8Array | undefined> {
  const context = await loadExampleTemplateContext(path);
  if (!context || context.owner.relativePath !== context.relativePath) return undefined;
  return (await readDocumentFile(path)).bytes;
}

/** Catch up an example before mounting it, including after external/MCP edits. */
export async function updateOpenedTemplateExample(path: string, example: VisualDocument): Promise<boolean> {
  const context = await loadExampleTemplateContext(path);
  if (!context || context.owner.relativePath === context.relativePath) return false;
  const file = await readDocumentFile(context.owner.path);
  const template = await deserializeHvy(new Uint8Array(file.bytes), context.owner.extension);
  const before = structuredClone(example);
  updateExampleContent(example, null, template);
  updateExampleDefinitions(example, template);
  return diffTemplateContent(before, example) !== null;
}
