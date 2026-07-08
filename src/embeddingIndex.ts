import { deleteSidecarFile, readDocumentFile, readSidecarFileBytes, writeSidecarFile, type AiSettings, type Workspace, type WorkspaceFileNode, type WorkspaceTreeNode } from './backend';
import { createDesktopEmbeddingProvider } from './aiClient';
import { deserializeHvy, type VisualDocument } from './hvy';
import type { WorkspaceFilterConfig } from './state';
import type { HvyDocumentSearchMode, HvyDocumentSearchResult, HvySearchResult, HvySearchSnapshot } from '../../heavy-file-format/src/search/types';
import type { HvyEmbeddingProvider, HvyEmbeddingVector } from '../../heavy-file-format/src/types';
import {
  planEmbeddingIndexUpdate,
  readEmbeddingIndexFromDocumentBytes,
  type HvyEmbeddingIndexChunk,
  type HvyEmbeddingIndexVector,
  type HvySerializedEmbeddingIndex,
} from '../../heavy-file-format/src/chat/embedding-context';
import { setAttachment } from '../../heavy-file-format/src/attachments';

const SIDECAR_SCHEMA_VERSION = 1;
const SIDECAR_EXTENSION = '.emb';
const EMBEDDING_ATTACHMENT_MEDIA_TYPE = 'application/vnd.hvy.embedding-index';
const EMBEDDING_INDEX_VERSION = 1;
const EMBEDDING_INDEX_MAGIC = 'HVYEIDX1';
const EMBEDDING_INDEX_HEADER_SIZE = 24;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface WorkspaceEmbeddingIndexProgress {
  queued: number;
  active: number;
  completed: number;
  failed: number;
  cancelled: number;
  currentFile: string | null;
  reusedChunks: number;
  rebuiltChunks: number;
}

export interface WorkspaceEmbeddingIndexFile {
  path: string;
  name: string;
  relativePath?: string;
  bytes: Uint8Array;
  sourceHash: string;
  index: HvySerializedEmbeddingIndex;
}

interface EmbeddingSidecarFile {
  schemaVersion: number;
  sourcePath: string;
  sourceHash: string;
  model: string;
  dimensions?: number;
  chunks: HvyEmbeddingIndexChunk[];
  vectors: HvyEmbeddingIndexVector[];
}

type EmbeddingIndexedFile = Omit<WorkspaceEmbeddingIndexFile, 'bytes'>;

export function embeddingSidecarPath(documentPath: string): string {
  return `${documentPath}${SIDECAR_EXTENSION}`;
}

export async function createWorkspaceEmbeddingFilterSnapshots(
  workspace: Workspace,
  filter: Pick<WorkspaceFilterConfig, 'query' | 'filterMode' | 'targetDirectory'> & { signal?: AbortSignal },
  settings: AiSettings,
  options: {
    onProgress?: (progress: WorkspaceEmbeddingIndexProgress) => void;
  } = {},
): Promise<WorkspaceFilterConfig['snapshots']> {
  const provider = createDesktopEmbeddingProvider(settings);
  if (!settings.embeddings.enabled || !provider) {
    throw new Error('Enable embeddings and choose an embedding provider before using embedding search.');
  }
  const files = flattenWorkspaceFiles(workspace.files)
    .filter((file) => !file.hiddenFromAI && file.path.toLowerCase().endsWith('.hvy'))
    .filter((file) => fileMatchesScope(file, workspace.path, filter.targetDirectory));
  const progress: WorkspaceEmbeddingIndexProgress = {
    queued: files.length,
    active: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    currentFile: null,
    reusedChunks: 0,
    rebuiltChunks: 0,
  };
  const indexed: EmbeddingIndexedFile[] = [];
  for (const file of files) {
    throwIfAborted(filter.signal);
    progress.queued -= 1;
    progress.active = 1;
    progress.currentFile = file.name;
    options.onProgress?.({ ...progress });
    try {
      const indexedFile = await readOrBuildEmbeddingIndex(file, settings, provider, filter.signal);
      if (indexedFile) {
        indexed.push(indexedFile);
        progress.reusedChunks += indexedFile.index.vectors.length;
      }
      progress.completed += 1;
    } catch (error) {
      if (isAbortError(error)) {
        progress.cancelled += 1 + progress.queued;
        progress.queued = 0;
        progress.active = 0;
        progress.currentFile = null;
        options.onProgress?.({ ...progress });
        throw error;
      }
      progress.failed += 1;
    } finally {
      progress.active = 0;
      progress.currentFile = null;
      options.onProgress?.({ ...progress });
    }
  }
  const queryVector = await embedQuery(provider, settings, filter.query, filter.signal);
  const results = rankIndexedFiles(indexed, queryVector);
  return snapshotsFromEmbeddingResults(filter.query, filter.filterMode, results);
}

export async function createWorkspaceEmbeddingCandidatePaths(
  workspace: Workspace,
  filter: Pick<WorkspaceFilterConfig, 'query' | 'targetDirectory'> & { signal?: AbortSignal },
  settings: AiSettings,
  options: {
    onProgress?: (progress: WorkspaceEmbeddingIndexProgress) => void;
    maxCandidateDocuments?: number;
  } = {},
): Promise<string[]> {
  const provider = createDesktopEmbeddingProvider(settings);
  if (!settings.embeddings.enabled || !provider) {
    throw new Error('Enable embeddings and choose an embedding provider before using embedding search.');
  }
  const files = flattenWorkspaceFiles(workspace.files)
    .filter((file) => !file.hiddenFromAI && file.path.toLowerCase().endsWith('.hvy'))
    .filter((file) => fileMatchesScope(file, workspace.path, filter.targetDirectory));
  const progress: WorkspaceEmbeddingIndexProgress = {
    queued: files.length,
    active: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    currentFile: null,
    reusedChunks: 0,
    rebuiltChunks: 0,
  };
  const indexed: EmbeddingIndexedFile[] = [];
  for (const file of files) {
    throwIfAborted(filter.signal);
    progress.queued -= 1;
    progress.active = 1;
    progress.currentFile = file.name;
    options.onProgress?.({ ...progress });
    try {
      const indexedFile = await readOrBuildEmbeddingIndex(file, settings, provider, filter.signal);
      if (indexedFile) {
        indexed.push(indexedFile);
        progress.reusedChunks += indexedFile.index.vectors.length;
      }
      progress.completed += 1;
    } catch (error) {
      if (isAbortError(error)) {
        progress.cancelled += 1 + progress.queued;
        progress.queued = 0;
        progress.active = 0;
        progress.currentFile = null;
        options.onProgress?.({ ...progress });
        throw error;
      }
      progress.failed += 1;
    } finally {
      progress.active = 0;
      progress.currentFile = null;
      options.onProgress?.({ ...progress });
    }
  }
  const queryVector = await embedQuery(provider, settings, filter.query, filter.signal);
  return candidatePathsFromEmbeddingResults(
    rankIndexedFiles(indexed, queryVector),
    options.maxCandidateDocuments ?? defaultMaxCandidateDocuments(files.length)
  );
}

async function readOrBuildEmbeddingIndex(
  file: WorkspaceFileNode,
  settings: AiSettings,
  provider: HvyEmbeddingProvider,
  signal?: AbortSignal,
): Promise<EmbeddingIndexedFile | null> {
  const documentFile = await readDocumentFile(file.path);
  const bytes = new Uint8Array(documentFile.bytes);
  const sourceHash = hashBytes(bytes);
  const embedded = readMatchingEmbeddedIndex(bytes, settings);
  if (embedded) {
    await deleteSidecarFile(embeddingSidecarPath(file.path)).catch(() => undefined);
    return indexedFile(file, sourceHash, embedded);
  }
  const sidecar = await readEmbeddingSidecar(file.path);
  if (sidecar && sidecar.sourceHash === sourceHash && sidecarMatchesSettings(sidecar, settings) && sidecar.chunks.length === sidecar.vectors.length) {
    return indexedFile(file, sourceHash, sidecarToIndex(sidecar));
  }
  const document = await deserializeHvy(bytes, documentFile.extension);
  const plan = planEmbeddingIndexUpdate({
    document,
    embeddingModel: settings.embeddings.model,
    ...(settings.embeddings.dimensions ? { embeddingDimensions: settings.embeddings.dimensions } : {}),
    existingVectors: sidecar?.vectors ?? [],
  });
  const embeddedVectors = await embedPlanInputs(provider, settings, plan.inputsToEmbed, signal);
  const embeddedById = new Map(embeddedVectors.map((entry) => [entry.id, entry.vector]));
  const vectors: HvyEmbeddingIndexVector[] = [
    ...plan.reused,
    ...plan.inputsToEmbed.flatMap((input): HvyEmbeddingIndexVector[] => {
      const vector = embeddedById.get(input.id);
      return vector ? [{
        id: input.id,
        textHash: input.textHash,
        vector,
        model: plan.model,
        ...(plan.dimensions !== undefined ? { dimensions: plan.dimensions } : {}),
      }] : [];
    }),
  ];
  const sidecarFile: EmbeddingSidecarFile = {
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    sourcePath: file.path,
    sourceHash,
    model: plan.model,
    ...(plan.dimensions !== undefined ? { dimensions: plan.dimensions } : {}),
    chunks: plan.chunks,
    vectors,
  };
  await writeEmbeddingSidecar(file.path, sidecarFile);
  return indexedFile(file, sourceHash, sidecarToIndex(sidecarFile));
}

function readMatchingEmbeddedIndex(bytes: Uint8Array, settings: AiSettings): HvySerializedEmbeddingIndex | null {
  const indexes = readEmbeddingIndexFromDocumentBytes(bytes, '.hvy', {
    embeddingModel: settings.embeddings.model,
    ...(settings.embeddings.dimensions ? { embeddingDimensions: settings.embeddings.dimensions } : {}),
  });
  return indexes.find((index) => index.chunks.length === index.vectors.length) ?? null;
}

async function readEmbeddingSidecar(documentPath: string): Promise<EmbeddingSidecarFile | null> {
  const bytes = await readSidecarFileBytes(embeddingSidecarPath(documentPath)).catch(() => null);
  if (!bytes) return null;
  try {
    const parsed = JSON.parse(decoder.decode(bytes)) as EmbeddingSidecarFile;
    if (
      parsed.schemaVersion !== SIDECAR_SCHEMA_VERSION
      || typeof parsed.sourceHash !== 'string'
      || typeof parsed.model !== 'string'
      || !Array.isArray(parsed.chunks)
      || !Array.isArray(parsed.vectors)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeEmbeddingSidecar(documentPath: string, sidecar: EmbeddingSidecarFile): Promise<void> {
  await writeSidecarFile(embeddingSidecarPath(documentPath), encoder.encode(`${JSON.stringify(sidecar, null, 2)}\n`));
}

function sidecarMatchesSettings(sidecar: EmbeddingSidecarFile, settings: AiSettings): boolean {
  return sidecar.model === settings.embeddings.model
    && (sidecar.dimensions ?? null) === (settings.embeddings.dimensions ?? null);
}

function sidecarToIndex(sidecar: EmbeddingSidecarFile): HvySerializedEmbeddingIndex {
  return {
    attachmentId: embeddingAttachmentId(sidecar.model, sidecar.dimensions),
    model: sidecar.model,
    ...(sidecar.dimensions !== undefined ? { dimensions: sidecar.dimensions } : {}),
    chunks: sidecar.chunks,
    vectors: sidecar.vectors,
  };
}

function indexedFile(file: WorkspaceFileNode, sourceHash: string, index: HvySerializedEmbeddingIndex): EmbeddingIndexedFile {
  return {
    path: file.path,
    name: file.name,
    ...(file.relativePath ? { relativePath: file.relativePath } : {}),
    sourceHash,
    index,
  };
}

async function embedPlanInputs(
  provider: HvyEmbeddingProvider,
  settings: AiSettings,
  inputs: Array<{ id: string; text: string; textHash: string }>,
  signal?: AbortSignal,
): Promise<HvyEmbeddingVector[]> {
  const batchSize = normalizeEmbeddingBatchSize(settings.embeddings.batchSize);
  const output: HvyEmbeddingVector[] = [];
  for (let index = 0; index < inputs.length; index += batchSize) {
    throwIfAborted(signal);
    const batch = inputs.slice(index, index + batchSize);
    output.push(...await provider({
      model: settings.embeddings.model,
      inputs: batch.map((input) => ({ id: input.id, text: input.text })),
      ...(settings.embeddings.dimensions ? { dimensions: settings.embeddings.dimensions } : {}),
      ...(signal ? { signal } : {}),
    }));
  }
  return output;
}

async function embedQuery(provider: HvyEmbeddingProvider, settings: AiSettings, query: string, signal?: AbortSignal): Promise<number[]> {
  const response = await provider({
    model: settings.embeddings.model,
    inputs: [{ id: 'query', text: query }],
    ...(settings.embeddings.dimensions ? { dimensions: settings.embeddings.dimensions } : {}),
    ...(signal ? { signal } : {}),
  });
  const vector = response.find((entry) => entry.id === 'query')?.vector ?? response[0]?.vector;
  if (!vector?.length) throw new Error('Embedding provider did not return a vector for the query.');
  return vector;
}

function rankIndexedFiles(files: EmbeddingIndexedFile[], queryVector: number[]): HvyDocumentSearchResult[] {
  return files.flatMap((file) => file.index.vectors.map((vector, index): HvyDocumentSearchResult | null => {
    const chunk = file.index.chunks[index];
    if (!chunk || vector.vector.length !== queryVector.length) return null;
    const score = cosineSimilarity(queryVector, vector.vector);
    return {
      id: `document:${file.path}:${chunk.id}`,
      documentId: file.path,
      documentTitle: displayDocumentName(file.name),
      category: 'semantic',
      targetKind: chunk.targetKind,
      sectionKey: chunk.sectionKey,
      ...(chunk.blockId ? { blockId: chunk.blockId } : {}),
      targetId: chunk.targetId,
      ...(chunk.targetRef ? { targetRef: chunk.targetRef } : {}),
      ...(chunk.targetPath ? { targetPath: chunk.targetPath } : {}),
      label: chunk.label,
      preview: chunk.text,
      matchedText: chunk.text,
      sourceField: 'embedding',
      ...(chunk.contextLabel ? { contextLabel: chunk.contextLabel } : {}),
      documentOrder: chunk.documentOrder,
      sourceFile: file.relativePath ?? file.path,
      score,
    };
  }).filter((result): result is HvyDocumentSearchResult => Boolean(result)))
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
}

function snapshotsFromEmbeddingResults(
  query: string,
  filterMode: WorkspaceFilterConfig['filterMode'],
  results: HvyDocumentSearchResult[],
): WorkspaceFilterConfig['snapshots'] {
  const snapshots: WorkspaceFilterConfig['snapshots'] = {};
  const byDocument = new Map<string, HvySearchResult[]>();
  for (const result of results) {
    const documentResults = byDocument.get(result.documentId) ?? [];
    documentResults.push(stripDocumentResult(result));
    byDocument.set(result.documentId, documentResults);
  }
  for (const [documentId, documentResults] of byDocument.entries()) {
    snapshots[documentId] = {
      query,
      mode: 'embedding' as HvyDocumentSearchMode,
      caseSensitive: false,
      categories: ['contents'],
      filterEnabled: true,
      filterMode,
      excludeTags: '',
      results: documentResults,
      activeResultId: documentResults[0]?.id ?? null,
    } satisfies HvySearchSnapshot;
  }
  return snapshots;
}

function stripDocumentResult(result: HvyDocumentSearchResult): HvySearchResult {
  const { documentId, documentTitle, ...searchResult } = result;
  void documentId;
  void documentTitle;
  return searchResult;
}

function candidatePathsFromEmbeddingResults(results: HvyDocumentSearchResult[], maxDocuments: number): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const result of results) {
    if (seen.has(result.documentId)) continue;
    seen.add(result.documentId);
    paths.push(result.documentId);
    if (paths.length >= maxDocuments) break;
  }
  return paths;
}

function defaultMaxCandidateDocuments(fileCount: number): number {
  return Math.min(fileCount, Math.max(8, Math.ceil(fileCount * 0.25)));
}

export async function attachMatchingSidecarEmbeddingIndex(documentPath: string, document: VisualDocument, settings: AiSettings): Promise<boolean> {
  const sidecar = await readEmbeddingSidecar(documentPath);
  if (!sidecar || !sidecarMatchesSettings(sidecar, settings)) return false;
  const plan = planEmbeddingIndexUpdate({
    document,
    embeddingModel: settings.embeddings.model,
    ...(settings.embeddings.dimensions ? { embeddingDimensions: settings.embeddings.dimensions } : {}),
    existingVectors: sidecar.vectors,
  });
  if (plan.inputsToEmbed.length > 0 || plan.removed.length > 0 || plan.stale.length > 0) return false;
  const chunksById = new Map(plan.chunks.map((chunk) => [chunk.id, chunk]));
  const vectors = plan.reused.filter((vector) => chunksById.has(vector.id));
  if (vectors.length !== plan.chunks.length) return false;
  const attachmentId = embeddingAttachmentId(plan.model, plan.dimensions);
  const bytes = serializeEmbeddingIndex({
    model: plan.model,
    ...(plan.dimensions !== undefined ? { dimensions: plan.dimensions } : {}),
    chunks: plan.chunks,
    vectors,
  });
  setAttachment(document, attachmentId, {
    mediaType: EMBEDDING_ATTACHMENT_MEDIA_TYPE,
    model: plan.model,
    ...(plan.dimensions !== undefined ? { dimensions: plan.dimensions } : {}),
    derived: true,
  }, bytes);
  return true;
}

export async function deleteSidecarIfSavedDocumentContainsMatchingIndex(documentPath: string, bytes: Uint8Array, settings: AiSettings): Promise<void> {
  if (!readMatchingEmbeddedIndex(bytes, settings)) return;
  await deleteSidecarFile(embeddingSidecarPath(documentPath)).catch(() => undefined);
}

function serializeEmbeddingIndex(index: { model: string; dimensions?: number; chunks: HvyEmbeddingIndexChunk[]; vectors: HvyEmbeddingIndexVector[] }): Uint8Array {
  const dimensionCount = index.vectors[0]?.vector.length ?? 0;
  const metadata = encoder.encode(JSON.stringify({
    version: EMBEDDING_INDEX_VERSION,
    model: index.model,
    ...(index.dimensions !== undefined ? { dimensions: index.dimensions } : {}),
    fingerprint: hashString(index.chunks.map((chunk) => `${chunk.id}:${chunk.textHash}`).join('|')),
    recordsHash: hashString(index.chunks.map((chunk) => [chunk.id, chunk.textHash, chunk.targetKind, chunk.targetId, chunk.targetRef ?? '', chunk.targetPath ?? ''].join(':')).join('|')),
    ids: index.vectors.map((entry) => entry.id),
    hashes: index.vectors.map((entry) => entry.textHash),
    chunks: index.vectors.map((entry) => index.chunks.find((chunk) => chunk.id === entry.id) ?? null),
  }));
  const vectorBytes = index.vectors.length * dimensionCount * Float32Array.BYTES_PER_ELEMENT;
  const bytes = new Uint8Array(EMBEDDING_INDEX_HEADER_SIZE + metadata.length + vectorBytes);
  bytes.set(encoder.encode(EMBEDDING_INDEX_MAGIC), 0);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(8, EMBEDDING_INDEX_VERSION, true);
  view.setUint32(12, metadata.length, true);
  view.setUint32(16, index.vectors.length, true);
  view.setUint32(20, dimensionCount, true);
  bytes.set(metadata, EMBEDDING_INDEX_HEADER_SIZE);
  let offset = EMBEDDING_INDEX_HEADER_SIZE + metadata.length;
  for (const entry of index.vectors) {
    if (entry.vector.length !== dimensionCount) {
      throw new Error('Embedding vectors must have consistent dimensions before caching.');
    }
    for (const value of entry.vector) {
      view.setFloat32(offset, value, true);
      offset += Float32Array.BYTES_PER_ELEMENT;
    }
  }
  return bytes;
}

function embeddingAttachmentId(model: string, dimensions?: number): string {
  return `embedding-index:${hashString(`${model}|${dimensions ?? ''}|semantic-retrieval-chunks-v1`)}`;
}

function cosineSimilarity(left: number[], right: number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function hashBytes(bytes: Uint8Array): string {
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function hashString(value: string): string {
  return hashBytes(encoder.encode(value));
}

function normalizeEmbeddingBatchSize(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 8;
  return Math.min(256, Math.max(1, Math.floor(parsed)));
}

function flattenWorkspaceFiles(nodes: WorkspaceTreeNode[]): WorkspaceFileNode[] {
  return nodes.flatMap((node) => node.kind === 'file' ? [node] : flattenWorkspaceFiles(node.children));
}

function fileMatchesScope(file: WorkspaceFileNode, workspacePath: string, targetDirectory: string): boolean {
  const scope = normalizeFolderScope(targetDirectory);
  if (!scope) return true;
  return normalizeFolderScope(file.relativePath ?? normalizeWorkspaceRelativePath(file.path, workspacePath)).startsWith(`${scope}/`);
}

function normalizeWorkspaceRelativePath(path: string, workspacePath: string): string {
  const normalizedPath = path.replaceAll('\\', '/');
  const normalizedWorkspacePath = workspacePath.replaceAll('\\', '/').replace(/\/+$/, '');
  return normalizedPath.startsWith(`${normalizedWorkspacePath}/`)
    ? normalizedPath.slice(normalizedWorkspacePath.length + 1)
    : normalizedPath;
}

function normalizeFolderScope(targetDirectory: string | null | undefined): string {
  return (targetDirectory ?? '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
}

function displayDocumentName(name: string): string {
  return name.replace(/\.([tp]?hvy|md)$/i, '');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
