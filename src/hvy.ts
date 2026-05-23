import type { DocumentExtension } from './backend';
import { chatSemanticFilterProvider } from '../../heavy-file-format/src/search/semantic-provider';
import { buildSemanticFilterInstructionPrompt } from '../../heavy-file-format/src/search/semantic-candidates';
import type {
  HvyDocumentSearchRequest,
  HvyDocumentSearchResponse,
  HvySemanticFilterCandidate,
  HvySemanticFilterCandidateBudget,
  HvySemanticFilterMatch,
  HvySemanticFilterProvider,
  HvySemanticFilterRequest,
} from '../../heavy-file-format/src/search/types';

export type HvyMode = 'viewer' | 'ai' | 'editor' | 'hvy' | 'advanced';
type HvyEmbedModule = typeof import('../../heavy-file-format/src/embed-full');
type HvyEmbedMount = ReturnType<HvyEmbedModule['mountHvy']>;
type HvyMount = Pick<HvyEmbedMount, 'destroy' | 'serializeDocumentBytes' | 'markSaved' | 'isDirty'>;
export type VisualDocument = ReturnType<HvyEmbedModule['deserializeDocumentBytes']>;
type HvyDocumentChangeCallback = NonNullable<Parameters<HvyEmbedModule['mountHvy']>[0]['onDocumentChange']>;

export interface MountedDocument {
  mount: HvyMount;
  document: VisualDocument;
}

export interface MountHvyDocumentOptions {
  onDocumentChange?: HvyDocumentChangeCallback;
  storageKey?: string;
  semanticFilterBatchSize?: number;
}

let hvyEmbedModule: Promise<HvyEmbedModule> | null = null;

function loadHvyEmbed(): Promise<HvyEmbedModule> {
  hvyEmbedModule ??= import('../../heavy-file-format/src/embed-full');
  return hvyEmbedModule;
}

export async function deserializeHvy(bytes: Uint8Array, extension: DocumentExtension): Promise<VisualDocument> {
  const { deserializeDocumentBytes } = await loadHvyEmbed();
  return deserializeDocumentBytes(bytes, extension);
}

export async function mountHvyDocument(
  root: HTMLElement,
  document: VisualDocument,
  mode: HvyMode,
  options: MountHvyDocumentOptions = {},
): Promise<MountedDocument> {
  const { builtInPlugins, mountHvy, mountHvyViewer } = await loadHvyEmbed();
  root.replaceChildren();
  root.classList.add('hvy-document-host');
  void mountHvyViewer;
  if (mode === 'hvy') {
    return mountRawHvyDocument(root, document, options);
  }
  const embedMode = mode === 'advanced' ? 'editor' : mode;
  const mount = mountHvy({
    root,
    document,
    mode: embedMode,
    showAdvancedEditor: mode === 'advanced',
    plugins: builtInPlugins,
    semanticFilterProvider: createBatchedSemanticFilterProvider(options.semanticFilterBatchSize),
    storageKey: mode === 'editor' || mode === 'advanced' ? null : options.storageKey,
    onDocumentChange: options.onDocumentChange,
  });
  return { mount, document };
}

export async function searchHvyDocuments(request: HvyDocumentSearchRequest, options: { semanticFilterBatchSize?: number } = {}): Promise<HvyDocumentSearchResponse> {
  const { searchDocuments } = await loadHvyEmbed();
  return searchDocuments({
    semanticFilterProvider: createBatchedSemanticFilterProvider(options.semanticFilterBatchSize),
    ...request,
  });
}

function createBatchedSemanticFilterProvider(batchSizeInput: number | undefined): HvySemanticFilterProvider {
  const batchSize = normalizeSemanticFilterBatchSize(batchSizeInput);
  return async (request) => {
    if (request.candidates.length <= batchSize) {
      return chatSemanticFilterProvider(request);
    }
    const matches: HvySemanticFilterMatch[] = [];
    const seen = new Set<string>();
    for (const candidates of chunkCandidates(request.candidates, batchSize)) {
      throwIfAborted(request.signal);
      const batchRequest = buildSemanticBatchRequest(request, candidates);
      const batchMatches = await chatSemanticFilterProvider(batchRequest);
      for (const match of batchMatches) {
        if (!seen.has(match.candidateId)) {
          seen.add(match.candidateId);
          matches.push(match);
        }
      }
    }
    throwIfAborted(request.signal);
    return matches;
  };
}

function buildSemanticBatchRequest(
  request: HvySemanticFilterRequest,
  candidates: HvySemanticFilterCandidate[],
): HvySemanticFilterRequest {
  return {
    ...request,
    instructionPrompt: buildSemanticFilterInstructionPrompt(request.prompt, candidates),
    candidates,
    candidateBudget: {
      ...request.candidateBudget,
      usedTotalCandidateChars: candidates.reduce((total, candidate) => total + JSON.stringify(candidate).length, 0),
      includedCandidates: candidates.length,
      totalCandidates: request.candidateBudget.totalCandidates,
      truncated: request.candidateBudget.truncated,
    } satisfies HvySemanticFilterCandidateBudget,
  };
}

function chunkCandidates(candidates: HvySemanticFilterCandidate[], batchSize: number): HvySemanticFilterCandidate[][] {
  const chunks: HvySemanticFilterCandidate[][] = [];
  for (let index = 0; index < candidates.length; index += batchSize) {
    chunks.push(candidates.slice(index, index + batchSize));
  }
  return chunks;
}

function normalizeSemanticFilterBatchSize(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
}

async function mountRawHvyDocument(
  root: HTMLElement,
  document: VisualDocument,
  options: MountHvyDocumentOptions,
): Promise<MountedDocument> {
  const { deserializeDocumentBytes, serializeDocument, serializeDocumentBytes } = await loadHvyEmbed();
  let currentDocument = document;
  let lastSavedText = serializeDocument(document);
  let dirty = false;
  const shell = documentOwner().createElement('div');
  shell.className = 'raw-hvy-shell';
  const textarea = documentOwner().createElement('textarea');
  textarea.className = 'raw-hvy-textarea';
  textarea.spellcheck = false;
  textarea.value = lastSavedText;
  shell.append(textarea);
  root.replaceChildren(shell);

  const notifyDirty = (nextDirty: boolean) => {
    dirty = nextDirty;
    options.onDocumentChange?.({ dirty, source: 'editor', reason: 'raw-hvy-input' });
  };
  textarea.addEventListener('input', () => {
    notifyDirty(textarea.value !== lastSavedText);
    try {
      currentDocument = deserializeDocumentBytes(new TextEncoder().encode(textarea.value), currentDocument.extension);
    } catch {
      // Invalid raw drafts stay editable; Save will surface the parse error.
    }
  });

  const mount: HvyMount = {
    destroy() {
      root.replaceChildren();
    },
    serializeDocumentBytes() {
      currentDocument = deserializeDocumentBytes(new TextEncoder().encode(textarea.value), currentDocument.extension);
      return serializeDocumentBytes(currentDocument);
    },
    markSaved() {
      currentDocument = deserializeDocumentBytes(new TextEncoder().encode(textarea.value), currentDocument.extension);
      lastSavedText = serializeDocument(currentDocument);
      textarea.value = lastSavedText;
      notifyDirty(false);
    },
    isDirty() {
      return dirty || textarea.value !== lastSavedText;
    },
  };
  return { mount, get document() { return currentDocument; } };
}

function documentOwner(): Document {
  return globalThis.document;
}

export function serializeMountedDocument(mounted: MountedDocument): Uint8Array {
  return mounted.mount.serializeDocumentBytes();
}

export function markMountedDocumentSaved(mounted: MountedDocument): void {
  mounted.mount.markSaved();
}

export function isMountedDocumentDirty(mounted: MountedDocument): boolean {
  return mounted.mount.isDirty();
}
