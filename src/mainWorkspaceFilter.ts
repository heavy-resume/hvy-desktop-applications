import type { HvyDocumentSearchDocument } from '../../heavy-file-format/src/search/types';
import { getSemanticResponseDebug } from './aiClient';
import { readDocumentFile, type Workspace, type WorkspaceFileNode, type WorkspaceTreeNode } from './backend';
import { logDebugEvent } from './debugLog';
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
  const targetDirectory = normalizeFolderScope(state.workspaceFilter.targetDirectory);
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
    const documents = await buildWorkspaceFilterDocuments(workspace, targetDirectory);
    const snapshots = await createWorkspaceFilterSnapshots(documents, {
      query,
      mode: state.workspaceFilter.mode,
      filterMode: state.workspaceFilter.filterMode,
      signal: abortController.signal,
    });
    if (state.workspaceFilter.mode === 'semantic' && !workspaceFilterSnapshotsHaveMatches(snapshots)) {
      state.workspaceFilter.error = 'No semantic matches. Try a more specific prompt.';
      state.workspaceFilter.status = null;
      state.status = 'Ready';
      return;
    }
    const config: WorkspaceFilterConfig = {
      query,
      mode: state.workspaceFilter.mode,
      filterMode: state.workspaceFilter.filterMode,
      targetDirectory,
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
  if (!workspacePath) {
    return null;
  }
  const filter = state.workspaceFilters[workspacePath];
  if (!filter || !filter.query.trim()) {
    return null;
  }
  if (!fileMatchesWorkspaceFilterScope(path, workspacePath, filter)) {
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

export function normalizeFolderScope(targetDirectory: string | null | undefined): string {
  return normalizeFilePath(targetDirectory ?? '').replace(/^\/+|\/+$/g, '');
}

export function fileMatchesWorkspaceFilterScope(
  path: string,
  workspacePath: string,
  filter: Pick<WorkspaceFilterConfig, 'targetDirectory'> | { targetDirectory?: string },
): boolean {
  const scope = normalizeFolderScope(filter.targetDirectory);
  if (!scope) return true;
  const relativePath = normalizeWorkspaceRelativePath(path, workspacePath);
  return relativePath.startsWith(`${scope}/`);
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
    const snapshot = await createWorkspaceFilterSnapshotForSearchDocument(entry, filter, index, documents.length);
    snapshots[entry.documentId] = snapshot;
  }
  return snapshots;
}

function workspaceFilterSnapshotsHaveMatches(snapshots: WorkspaceFilterConfig['snapshots']): boolean {
  return Object.values(snapshots).some((snapshot) => snapshot.results.length > 0);
}

async function createWorkspaceFilterSnapshotForSearchDocument(
  entry: HvyDocumentSearchDocument,
  filter: Pick<WorkspaceFilterConfig, 'query' | 'mode' | 'filterMode'> & { signal?: AbortSignal },
  index: number,
  total: number,
) {
  const traceRunId = `workspace-filter:${Date.now().toString(36)}`;
  try {
    return await createHvyDocumentFilterSnapshot({
      document: entry.document,
      query: filter.query,
      mode: filter.mode,
      view: 'viewer',
      filterMode: filter.filterMode,
      traceRunId,
      signal: filter.signal,
      onSemanticProgress: filter.mode === 'semantic'
        ? (progress) => {
          state.workspaceFilter.error = null;
          state.workspaceFilter.status = `Semantic windows ${progress.completedWindows}/${progress.totalWindows}; ${progress.matchedCandidates} matches in ${entry.documentTitle ?? displayDocumentName(entry.documentId)}`;
          if (progress.completedWindows === progress.totalWindows) {
            logDebugEvent('llm', 'workspace-filter:semantic-progress', {
              traceRunId,
              documentId: entry.documentId,
              documentTitle: entry.documentTitle,
              documentIndex: index + 1,
              documentCount: total,
              query: filter.query,
              ...progress,
            });
          }
          scheduleWorkspaceFilterProgressRender();
        }
        : undefined,
    });
  } catch (error) {
    if (filter.mode === 'semantic' && isInvalidSemanticCandidateIdError(error)) {
      logDebugEvent('llm', 'workspace-filter:semantic-invalid-candidate-ids', {
        traceRunId,
        documentId: entry.documentId,
        documentTitle: entry.documentTitle,
        documentIndex: index + 1,
        documentCount: total,
        query: filter.query,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (filter.mode === 'semantic') {
      const responseDebug = getSemanticResponseDebug(traceRunId);
      logDebugEvent('llm', 'workspace-filter:semantic-error', {
        task: 'semanticFilter',
        traceRunId,
        documentId: entry.documentId,
        documentTitle: entry.documentTitle,
        documentIndex: index + 1,
        documentCount: total,
        query: filter.query,
        error: error instanceof Error ? error.message : String(error),
        ...(responseDebug
          ? {
              provider: responseDebug.provider,
              model: responseDebug.model,
              ok: responseDebug.ok,
              status: responseDebug.status,
              durationMs: responseDebug.durationMs,
              ...(responseDebug.body ? { body: responseDebug.body } : {}),
              ...(typeof responseDebug.output === 'string' ? { output: responseDebug.output } : {}),
              ...(responseDebug.payload !== undefined ? { payload: responseDebug.payload } : {}),
            }
          : { responseDebug: 'missing' }),
      });
    }
    throw error;
  }
}

function isInvalidSemanticCandidateIdError(error: unknown): boolean {
  return error instanceof Error
    && error.message === 'Semantic filtering response did not include any valid candidate IDs.';
}

export async function buildWorkspaceFilterDocuments(
  workspace: Awaited<ReturnType<typeof loadWorkspace>>,
  targetDirectory = '',
): Promise<HvyDocumentSearchDocument[]> {
  const documents: HvyDocumentSearchDocument[] = [];
  const scope = normalizeFolderScope(targetDirectory);
  for (const file of flattenWorkspaceFiles(workspace.files)) {
    if (file.hiddenFromAI) continue;
    if (scope && !workspaceFilterFileRelativePath(file, workspace.path).startsWith(`${scope}/`)) continue;
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

function workspaceFilterFileRelativePath(file: WorkspaceFileNode, workspacePath: string): string {
  return normalizeFolderScope(file.relativePath ?? normalizeWorkspaceRelativePath(file.path, workspacePath));
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
