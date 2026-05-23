import type { DocumentExtension } from './backend';
import { chatSemanticFilterProvider } from '../../heavy-file-format/src/search/semantic-provider';
import type {
  HvyDocumentSearchRequest,
  HvyDocumentSearchResponse,
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
    semanticFilterProvider: chatSemanticFilterProvider,
    storageKey: mode === 'editor' || mode === 'advanced' ? null : options.storageKey,
    onDocumentChange: options.onDocumentChange,
  });
  return { mount, document };
}

export async function searchHvyDocuments(request: HvyDocumentSearchRequest): Promise<HvyDocumentSearchResponse> {
  const { searchDocuments } = await loadHvyEmbed();
  return searchDocuments({
    semanticFilterProvider: chatSemanticFilterProvider,
    ...request,
  });
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
