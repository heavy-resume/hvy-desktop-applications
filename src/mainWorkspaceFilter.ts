import type { HvyDocumentSearchDocument } from '../../heavy-file-format/src/search/types';
import { readDocumentFile, type Workspace, type WorkspaceFileNode, type WorkspaceTreeNode } from './backend';
import { loadWorkspace } from './mainWorkspaceUtils';
import { createHvyDocumentFilterSnapshot, deserializeHvy, setMountedSearchSnapshot, type VisualDocument } from './hvy';
import { state, workspaceFileAccessInWorkspaces, workspacePathForFileInWorkspaces, type WorkspaceFilterConfig } from './state';
import { applyAppColorTheme, cacheWorkspaceFilterDocuments, cancelWorkspaceFilterProgressRender, clearWorkspaceFilterDocumentCache, documentSessions, mountCurrentDocument, pendingMountDocument, preserveCurrentDocumentSession, rerender, scheduleWorkspaceFilterProgressRender } from './main';

let workspaceFilterAbortController: AbortController | null = null;

export async function submitWorkspaceFilter(): Promise<void> {
  if (state.workspaceFilter.isLoading) {
    workspaceFilterAbortController?.abort();
    state.workspaceFilter.status = 'Stopping filter...';
    state.status = 'Stopping filter...';
    rerender({ preserveMountedDocument: true });
    return;
  }
  const workspacePath = state.workspaceFilter.workspacePath;
  const query = state.workspaceFilter.queryDraft.trim();
  state.workspaceFilter.submittedQuery = query;
  state.workspaceFilter.error = null;
  state.workspaceFilter.status = null;
  if (!workspacePath || !state.workspaces.some((workspace) => workspace.path === workspacePath)) {
    state.workspaceFilter.error = 'Open a workspace before filtering.';
    rerender({ preserveMountedDocument: true });
    return;
  }
  if (!query) {
    delete state.workspaceFilters[workspacePath];
    clearWorkspaceFilterDocumentCache(workspacePath);
    await applyWorkspaceFilterToCurrentDocument();
    rerender({ preserveMountedDocument: true });
    return;
  }

  state.workspaceFilter.isLoading = true;
  const abortController = new AbortController();
  workspaceFilterAbortController = abortController;
  rerender({ preserveMountedDocument: true });
  try {
    preserveCurrentDocumentSession();
    const workspace = state.workspaces.find((candidate) => candidate.path === workspacePath);
    if (!workspace) {
      throw new Error('Open a workspace before filtering.');
    }
    const documents = await buildWorkspaceFilterDocuments(workspace);
    const snapshots = await createWorkspaceFilterSnapshots(documents, {
      query,
      mode: state.workspaceFilter.mode,
      filterMode: state.workspaceFilter.filterMode,
      signal: abortController.signal,
    });
    const config: WorkspaceFilterConfig = {
      query,
      mode: state.workspaceFilter.mode,
      filterMode: state.workspaceFilter.filterMode,
      snapshots,
    };
    state.workspaceFilters[workspacePath] = config;
    cacheWorkspaceFilterDocuments(workspacePath, documents);
    await applyWorkspaceFilterToCurrentDocument();
    state.workspaceFilter.open = false;
    state.workspaceFilter.error = null;
    state.workspaceFilter.status = null;
    state.status = `Filtered ${workspaceNameForPath(workspacePath)}`;
  } catch (error) {
    state.workspaceFilter.error = isAbortError(error) ? null : error instanceof Error ? error.message : String(error);
    state.workspaceFilter.status = null;
    state.status = isAbortError(error) ? 'Filter stopped' : 'Ready';
  } finally {
    if (workspaceFilterAbortController === abortController) {
      workspaceFilterAbortController = null;
    }
    cancelWorkspaceFilterProgressRender();
    state.workspaceFilter.isLoading = false;
    rerender({ preserveMountedDocument: true });
  }
}

export async function clearWorkspaceFilter(): Promise<void> {
  const workspacePath = state.workspaceFilter.workspacePath;
  if (!workspacePath) return;
  delete state.workspaceFilters[workspacePath];
  clearWorkspaceFilterDocumentCache(workspacePath);
  state.workspaceFilter.submittedQuery = '';
  state.workspaceFilter.error = null;
  state.workspaceFilter.status = null;
  state.workspaceFilter.open = false;
  await applyWorkspaceFilterToCurrentDocument();
  state.status = `Cleared filter for ${workspaceNameForPath(workspacePath)}`;
  rerender({ preserveMountedDocument: true });
}

export async function applyWorkspaceFilterToCurrentDocument(): Promise<void> {
  const openDocument = state.document;
  const document = openDocument?.mounted?.document ?? pendingMountDocument;
  if (!openDocument || !document) return;
  const snapshot = await createWorkspaceFilterSnapshotForDocument(openDocument.path, openDocument.name, document);
  if (openDocument.mounted) {
    setMountedSearchSnapshot(openDocument.mounted, snapshot);
    applyAppColorTheme();
  }
}

export async function createWorkspaceFilterSnapshotForDocument(
  path: string,
  name: string,
  document: VisualDocument,
) {
  void name;
  void document;
  const workspacePath = workspacePathForFileInWorkspaces(state.workspaces, path);
  if (workspaceFileAiAccess(path).hiddenFromAI) {
    return null;
  }
  const filter = workspacePath ? state.workspaceFilters[workspacePath] : null;
  if (!filter || !filter.query.trim()) {
    return null;
  }
  return findWorkspaceFilterSnapshot(filter, path);
}

export function findWorkspaceFilterSnapshot(filter: WorkspaceFilterConfig, path: string) {
  const direct = filter.snapshots[path];
  if (direct) return direct;
  const workspacePath = workspacePathForFileInWorkspaces(state.workspaces, path);
  const candidates = new Set([
    normalizeFilePath(path),
    ...(workspacePath ? [normalizeWorkspaceRelativePath(path, workspacePath)] : []),
  ]);
  const match = Object.entries(filter.snapshots).find(([candidatePath]) => {
    const normalizedCandidate = normalizeFilePath(candidatePath);
    return candidates.has(normalizedCandidate)
      || (workspacePath ? candidates.has(normalizeWorkspaceRelativePath(candidatePath, workspacePath)) : false);
  });
  return match?.[1] ?? null;
}

export function normalizeFilePath(path: string): string {
  return path.replaceAll('\\', '/');
}

export function normalizeWorkspaceRelativePath(path: string, workspacePath: string): string {
  const normalizedPath = normalizeFilePath(path);
  const normalizedWorkspacePath = normalizeFilePath(workspacePath).replace(/\/+$/, '');
  return normalizedPath.startsWith(`${normalizedWorkspacePath}/`)
    ? normalizedPath.slice(normalizedWorkspacePath.length + 1)
    : normalizedPath;
}

export async function createWorkspaceFilterSnapshots(
  documents: HvyDocumentSearchDocument[],
  filter: Pick<WorkspaceFilterConfig, 'query' | 'mode' | 'filterMode'> & { signal?: AbortSignal },
): Promise<WorkspaceFilterConfig['snapshots']> {
  const snapshots: WorkspaceFilterConfig['snapshots'] = {};
  for (const [index, entry] of documents.entries()) {
    const label = `Filtering ${entry.documentTitle ?? displayDocumentName(entry.documentId)} (${index + 1}/${documents.length})`;
    state.workspaceFilter.status = label;
    state.status = label;
    scheduleWorkspaceFilterProgressRender();
    const snapshot = await createHvyDocumentFilterSnapshot({
      document: entry.document,
      query: filter.query,
      mode: filter.mode,
      view: 'viewer',
      filterMode: filter.filterMode,
      traceRunId: `workspace-filter:${Date.now().toString(36)}`,
      signal: filter.signal,
      onSemanticProgress: filter.mode === 'semantic'
        ? (progress) => {
          state.workspaceFilter.error = null;
          state.workspaceFilter.status = `Semantic windows ${progress.completedWindows}/${progress.totalWindows}; ${progress.matchedCandidates} matches in ${entry.documentTitle ?? displayDocumentName(entry.documentId)}`;
          state.status = `Filtering ${entry.documentTitle ?? displayDocumentName(entry.documentId)} (${index + 1}/${documents.length})`;
          scheduleWorkspaceFilterProgressRender();
        }
        : undefined,
    });
    snapshots[entry.documentId] = snapshot;
  }
  return snapshots;
}

export async function buildWorkspaceFilterDocuments(workspace: Awaited<ReturnType<typeof loadWorkspace>>): Promise<HvyDocumentSearchDocument[]> {
  const documents: HvyDocumentSearchDocument[] = [];
  for (const file of flattenWorkspaceFiles(workspace.files)) {
    if (file.hiddenFromAI) continue;
    const session = documentSessions.get(file.path);
    const openDocument = state.document?.path === file.path ? state.document : null;
    const liveDocument = openDocument?.mounted?.document ?? (openDocument ? pendingMountDocument : null) ?? session?.document ?? null;
    if (liveDocument) {
      documents.push({
        documentId: file.path,
        documentTitle: displayDocumentName(file.name),
        document: liveDocument,
      });
      continue;
    }
    try {
      const documentFile = await readDocumentFile(file.path);
      documents.push({
        documentId: file.path,
        documentTitle: displayDocumentName(documentFile.name),
        document: await deserializeHvy(new Uint8Array(documentFile.bytes), documentFile.extension),
      });
    } catch {
      // Keep workspace filtering resilient if one file was moved, deleted, or cannot be parsed.
    }
  }
  return documents;
}

export function flattenWorkspaceFiles(nodes: WorkspaceTreeNode[]): WorkspaceFileNode[] {
  return nodes.flatMap((node) => node.kind === 'file' ? [node] : flattenWorkspaceFiles(node.children));
}

export function workspaceFileAiAccess(path: string): { archived: boolean; locked: boolean; hiddenFromAI: boolean; readOnly: boolean } {
  return workspaceFileAccessInWorkspaces(state.workspaces, path);
}

export function ensureWorkspaceFileAiAccess(workspace: Workspace, path: string, access: { locked?: boolean; hiddenFromAI?: boolean }): void {
  const file = flattenWorkspaceFiles(workspace.files).find((candidate) => candidate.path === path);
  if (!file) {
    throw new Error('Updated file was not found in the workspace.');
  }
  if (typeof access.locked === 'boolean' && file.locked !== access.locked) {
    throw new Error(`Workspace did not ${access.locked ? 'lock' : 'unlock'} the file.`);
  }
  if (typeof access.hiddenFromAI === 'boolean' && file.hiddenFromAI !== access.hiddenFromAI) {
    throw new Error(`Workspace did not ${access.hiddenFromAI ? 'hide the file from AI' : 'make the file visible to AI'}.`);
  }
}

export function syncOpenDocumentAiAccess(path: string, access: { locked?: boolean; hiddenFromAI?: boolean }): void {
  syncOpenDocumentWorkspaceAccess(path, access);
}

export function syncOpenDocumentWorkspaceAccess(path: string, access: { locked?: boolean; hiddenFromAI?: boolean } = {}): void {
  const workspaceAccess = workspaceFileAiAccess(path);
  const readOnly = typeof access.locked === 'boolean'
    ? access.locked || workspaceAccess.archived
    : workspaceAccess.readOnly;
  const hiddenFromAI = typeof access.hiddenFromAI === 'boolean'
    ? access.hiddenFromAI
    : workspaceAccess.hiddenFromAI;
  const session = documentSessions.get(path);
  if (session) {
    session.readOnly = readOnly;
    session.hiddenFromAI = hiddenFromAI;
    if (session.hiddenFromAI && session.mode === 'ai') session.mode = 'viewer';
  }
  if (state.document?.path !== path) return;
  state.document.readOnly = readOnly;
  state.document.hiddenFromAI = hiddenFromAI;
  if (state.document.readOnly || (state.document.hiddenFromAI && state.document.mode === 'ai')) {
    state.document.mode = 'viewer';
    void mountCurrentDocument(state.document.mounted?.document ?? pendingMountDocument ?? undefined);
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function workspaceNameForPath(path: string): string {
  return state.workspaces.find((workspace) => workspace.path === path)?.manifest.name ?? 'workspace';
}

export function displayDocumentName(name: string): string {
  return name.replace(/\.([tp]?hvy|md)$/i, '');
}

