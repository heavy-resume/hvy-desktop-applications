import type { DocumentExtension } from './backend';
import { bindCarouselInteractions } from '../../heavy-file-format/src/editor/components/carousel/carousel';
import { isPdfAllowedComponent } from '../../heavy-file-format/src/pdf-document-capabilities';
import { chatSemanticFilterProvider } from '../../heavy-file-format/src/search/semantic-provider';
import type {
  HvyEditorClipboardHost,
  HvyEditorClipboardPayload,
} from '../../heavy-file-format/src/types';
import type {
  HvyDocumentSearchRequest,
  HvyDocumentSearchResponse,
  HvySearchSnapshotInput,
} from '../../heavy-file-format/src/search/types';

export type HvyMode = 'viewer' | 'ai' | 'editor' | 'hvy' | 'advanced';
type HvyEmbedModule = typeof import('../../heavy-file-format/src/embed-full');
type HvyEmbedMount = ReturnType<HvyEmbedModule['mountHvy']>;
type HvyRecoveryStateMount = {
  getRecoveryState?: () => string | null;
  applyRecoveryState?: (recoveryState?: string | null) => void;
};
type HvyMount = Pick<HvyEmbedMount, 'destroy' | 'getDocument' | 'serializeDocumentBytes' | 'getPdfBlob' | 'markSaved' | 'isDirty' | 'buildImportPlan' | 'importFromText'> & {
  openDocumentMeta?: HvyEmbedMount['openDocumentMeta'];
  setSearchSnapshot?: HvyEmbedMount['setSearchSnapshot'];
  getSearchSnapshot?: HvyEmbedMount['getSearchSnapshot'];
} & HvyRecoveryStateMount;
export type VisualDocument = ReturnType<HvyEmbedModule['deserializeDocumentBytes']>;
export type BuildImportPlanOptions = Parameters<HvyEmbedMount['buildImportPlan']>[0];
export type BuildImportPlanResult = Awaited<ReturnType<HvyEmbedMount['buildImportPlan']>>;
export type ImportFromTextOptions = Parameters<HvyEmbedMount['importFromText']>[0];
export type ImportFromTextResult = Awaited<ReturnType<HvyEmbedMount['importFromText']>>;
type HvyDocumentChangeCallback = NonNullable<Parameters<HvyEmbedModule['mountHvy']>[0]['onDocumentChange']>;
type MetaTemplateKind = 'component' | 'section';
type MetaTemplateClipboard =
  | { kind: 'component'; definition: Record<string, unknown> }
  | { kind: 'section'; definition: Record<string, unknown> };

export interface MountedDocument {
  mount: HvyMount;
  document: VisualDocument;
}

export interface MountHvyDocumentOptions {
  onDocumentChange?: HvyDocumentChangeCallback;
  storageKey?: string;
  searchSnapshot?: HvySearchSnapshotInput | null;
}

let hvyEmbedModule: Promise<HvyEmbedModule> | null = null;
let editorClipboardPayload: HvyEditorClipboardPayload | null = null;
let metaTemplateClipboard: MetaTemplateClipboard | null = null;

const editorClipboardHost: HvyEditorClipboardHost = {
  read() {
    return editorClipboardPayload;
  },
  write(payload) {
    editorClipboardPayload = payload;
  },
};

function loadHvyEmbed(): Promise<HvyEmbedModule> {
  hvyEmbedModule ??= import('../../heavy-file-format/src/embed-full');
  return hvyEmbedModule;
}

export async function deserializeHvy(bytes: Uint8Array, extension: DocumentExtension): Promise<VisualDocument> {
  const { deserializeDocumentBytes } = await loadHvyEmbed();
  return deserializeDocumentBytes(bytes, extension);
}

export async function exportHvySourceMarkdown(document: VisualDocument): Promise<string> {
  const { exportDocumentSourceMarkdown } = await import('../../heavy-file-format/src/document-source-markdown');
  return exportDocumentSourceMarkdown(document);
}

export async function serializeHvy(document: VisualDocument): Promise<Uint8Array> {
  const { serializeDocumentBytes } = await loadHvyEmbed();
  return serializeDocumentBytes(document);
}

export async function getPhvyCompatibilityErrors(document: VisualDocument): Promise<string[]> {
  const { serializeDocument } = await loadHvyEmbed();
  const { deserializeDocumentWithDiagnostics } = await import('../../heavy-file-format/src/serialization');
  const phvySource = serializeDocument({ ...document, extension: '.phvy' });
  return deserializeDocumentWithDiagnostics(phvySource, '.phvy')
    .diagnostics
    .filter((diagnostic) =>
      diagnostic.severity === 'error'
      && (diagnostic.code === 'phvy_component_not_supported' || diagnostic.code === 'phvy_sidebar_not_supported')
    )
    .map((diagnostic) => diagnostic.message);
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
    editorClipboard: editorClipboardHost,
    storageKey: mode === 'editor' || mode === 'advanced' ? null : options.storageKey,
    searchSnapshot: options.searchSnapshot ?? null,
    onDocumentChange: options.onDocumentChange,
  });
  const mounted = withMetaTemplateContextMenu(root, withChatPanelResize(root, mount), options);
  return { mount: mode === 'viewer' ? withViewerCarouselInteractions(root, mounted) : mounted, document };
}

export async function searchHvyDocuments(request: HvyDocumentSearchRequest): Promise<HvyDocumentSearchResponse> {
  const { searchDocuments } = await loadHvyEmbed();
  return searchDocuments({
    semanticFilterProvider: chatSemanticFilterProvider,
    ...request,
  });
}

export async function createHvyDocumentFilterSnapshot(
  request: Parameters<HvyEmbedModule['createDocumentFilterSnapshot']>[0],
): Promise<Awaited<ReturnType<HvyEmbedModule['createDocumentFilterSnapshot']>>> {
  const { createDocumentFilterSnapshot } = await loadHvyEmbed();
  return createDocumentFilterSnapshot({
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
  const parseDraft = () => {
    currentDocument = deserializeDocumentBytes(new TextEncoder().encode(textarea.value), currentDocument.extension);
    return currentDocument;
  };
  const syncDraftFromDocument = () => {
    textarea.value = serializeDocument(currentDocument);
    notifyDirty(textarea.value !== lastSavedText);
  };
  const rawImportLlm = async () => {
    const { loadChatSettings } = await import('../../heavy-file-format/src/chat/chat');
    return {
      settings: loadChatSettings(),
      client: window.HVY_CHAT_CLIENT ?? null,
    };
  };

  const mount: HvyMount = {
    destroy() {
      root.replaceChildren();
    },
    getDocument() {
      return currentDocument;
    },
    serializeDocumentBytes() {
      currentDocument = deserializeDocumentBytes(new TextEncoder().encode(textarea.value), currentDocument.extension);
      return serializeDocumentBytes(currentDocument);
    },
    async getPdfBlob() {
      const { getHvyPdfBlob } = await import('../../heavy-file-format/src/pdf-export/export');
      currentDocument = deserializeDocumentBytes(new TextEncoder().encode(textarea.value), currentDocument.extension);
      return getHvyPdfBlob(currentDocument);
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
    async buildImportPlan(importOptions) {
      const { buildImportPlanForDocument } = await import('../../heavy-file-format/src/ai-document-import');
      return buildImportPlanForDocument(parseDraft(), {
        ...importOptions,
        llm: importOptions.llm ?? await rawImportLlm(),
      });
    },
    async importFromText(importOptions) {
      const { importTextIntoDocument } = await import('../../heavy-file-format/src/ai-document-import');
      const result = await importTextIntoDocument(parseDraft(), {
        ...importOptions,
        llm: importOptions.llm ?? await rawImportLlm(),
        onProgress: (event) => {
          if (event.phase !== 'complete') {
            importOptions.onProgress?.(event);
          }
        },
        onSectionApplied: syncDraftFromDocument,
        onImportFillInsApplied: syncDraftFromDocument,
        onImportXrefsApplied: syncDraftFromDocument,
        onImportPrepared: syncDraftFromDocument,
        onImportFinalized: syncDraftFromDocument,
      });
      if (result.status === 'complete') {
        syncDraftFromDocument();
        importOptions.onProgress?.({ phase: 'complete', message: result.message ?? 'Import complete.' });
      }
      return result;
    },
  };
  return { mount, get document() { return currentDocument; } };
}

function documentOwner(): Document {
  return globalThis.document;
}

function withChatPanelResize(root: HTMLElement, mount: HvyMount): HvyMount {
  const cleanup = installChatPanelResize(root);
  return {
    ...mount,
    destroy() {
      cleanup();
      mount.destroy();
    },
  };
}

function withViewerCarouselInteractions(root: HTMLElement, mount: HvyMount): HvyMount {
  const cleanup = installViewerCarouselInteractions(root);
  return {
    ...mount,
    destroy() {
      cleanup();
      mount.destroy();
    },
  };
}

function withMetaTemplateContextMenu(
  root: HTMLElement,
  mount: HvyMount,
  options: MountHvyDocumentOptions,
): HvyMount {
  const cleanup = installMetaTemplateContextMenu(root, mount, options.onDocumentChange);
  return {
    ...mount,
    destroy() {
      cleanup();
      mount.destroy();
    },
  };
}

function installMetaTemplateContextMenu(
  root: HTMLElement,
  mount: HvyMount,
  onDocumentChange?: HvyDocumentChangeCallback,
): () => void {
  const controller = new AbortController();
  const closeMenu = () => root.querySelector('.hvy-meta-template-context-menu')?.remove();

  root.addEventListener('contextmenu', (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const hit = target ? getMetaTemplateHit(target) : null;
    if (!hit) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showMetaTemplateContextMenu(root, hit, event);
  }, { signal: controller.signal, capture: true });

  root.addEventListener('click', (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const button = target?.closest<HTMLButtonElement>('.hvy-meta-template-context-menu button[data-meta-template-action]');
    if (!button) {
      closeMenu();
      return;
    }
    event.preventDefault();
    const action = button.dataset.metaTemplateAction;
    const kind = button.dataset.metaTemplateKind === 'section' ? 'section' : 'component';
    const index = Number.parseInt(button.dataset.metaTemplateIndex ?? '', 10);
    if (action === 'copy' && Number.isInteger(index)) {
      copyMetaTemplate(mount, kind, index);
    }
    if (action === 'paste') {
      pasteMetaTemplate(root, button, mount, kind, onDocumentChange);
    }
    closeMenu();
  }, { signal: controller.signal });

  return () => {
    controller.abort();
    closeMenu();
  };
}

function showMetaTemplateContextMenu(
  root: HTMLElement,
  hit: MetaTemplateHit,
  event: MouseEvent,
): void {
  root.querySelector('.hvy-meta-template-context-menu')?.remove();
  const menu = documentOwner().createElement('section');
  menu.className = 'hvy-context-popover hvy-meta-template-context-menu';
  menu.setAttribute('aria-label', 'Template options');
  menu.style.position = 'fixed';
  menu.style.left = `${Math.max(8, event.clientX)}px`;
  menu.style.top = `${Math.max(8, event.clientY)}px`;

  if (hit.index !== null) {
    menu.append(createMetaTemplateMenuButton('Copy', 'copy', hit.kind, hit.index));
  }
  if (metaTemplateClipboard?.kind === hit.kind) {
    menu.append(createMetaTemplateMenuButton('Paste', 'paste', hit.kind, -1));
  }
  if (!menu.childElementCount) {
    const disabled = createMetaTemplateMenuButton('Nothing to paste', 'none', hit.kind, -1);
    disabled.disabled = true;
    menu.append(disabled);
  }
  root.append(menu);
  placeMetaTemplateMenu(menu);
}

function createMetaTemplateMenuButton(label: string, action: string, kind: MetaTemplateKind, index: number): HTMLButtonElement {
  const button = documentOwner().createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.dataset.metaTemplateAction = action;
  button.dataset.metaTemplateKind = kind;
  button.dataset.metaTemplateIndex = String(index);
  return button;
}

interface MetaTemplateHit {
  kind: MetaTemplateKind;
  index: number | null;
}

function getMetaTemplateHit(target: HTMLElement): MetaTemplateHit | null {
  const metaPanel = target.closest<HTMLElement>('.document-meta-view .meta-panel');
  if (!metaPanel) return null;
  const container = target.closest<HTMLElement>('.component-defs');
  if (!container || !metaPanel.contains(container)) return null;
  const templateContainers = Array.from(metaPanel.querySelectorAll<HTMLElement>(':scope > .component-defs'));
  const containerIndex = templateContainers.indexOf(container);
  if (containerIndex < 0 || containerIndex > 1) return null;
  const details = target.closest<HTMLElement>('.template-def-details');
  const templateDetails = Array.from(container.querySelectorAll<HTMLElement>(':scope > .template-def-details'));
  return {
    kind: containerIndex === 0 ? 'component' : 'section',
    index: details && container.contains(details) ? templateDetails.indexOf(details) : null,
  };
}

function copyMetaTemplate(mount: HvyMount, kind: MetaTemplateKind, index: number): void {
  const defs = getMetaTemplateDefinitions(mount.getDocument(), kind);
  const definition = defs[index];
  if (!definition) return;
  metaTemplateClipboard = { kind, definition: cloneJsonObject(definition) };
}

function pasteMetaTemplate(
  root: HTMLElement,
  source: HTMLElement,
  mount: HvyMount,
  kind: MetaTemplateKind,
  onDocumentChange?: HvyDocumentChangeCallback,
): void {
  if (metaTemplateClipboard?.kind !== kind) return;
  const document = mount.getDocument();
  const defs = getMetaTemplateDefinitions(document, kind);
  const nextDefinition = cloneJsonObject(metaTemplateClipboard.definition);
  nextDefinition.name = uniqueTemplateName(readTemplateName(nextDefinition), defs);
  if (kind === 'section' && typeof nextDefinition.key === 'string') {
    nextDefinition.key = uniqueTemplateKey(nextDefinition.key, defs, String(nextDefinition.name));
  }
  const meta = document.meta as Record<string, unknown>;
  if (kind === 'component') {
    const nextMeta = { ...meta, component_defs: [...defs, nextDefinition] };
    if (document.extension === '.phvy' && !isPdfAllowedComponent(readTemplateName(nextDefinition), nextMeta)) {
      showMetaTemplateNotice(root, source, 'Copied component is incompatible with PHVY.');
      return;
    }
    meta.component_defs = [...defs, nextDefinition];
  } else {
    meta.section_defs = [...defs, nextDefinition];
  }
  onDocumentChange?.({ dirty: true, reason: `${kind}-template-paste`, source: 'editor' });
  mount.openDocumentMeta?.();
}

function getMetaTemplateDefinitions(document: VisualDocument, kind: MetaTemplateKind): Record<string, unknown>[] {
  const raw = (document.meta as Record<string, unknown>)[kind === 'component' ? 'component_defs' : 'section_defs'];
  return Array.isArray(raw)
    ? raw.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function readTemplateName(definition: Record<string, unknown>): string {
  const name = typeof definition.name === 'string' ? definition.name.trim() : '';
  return name || 'template';
}

function uniqueTemplateName(name: string, defs: Record<string, unknown>[]): string {
  const names = new Set(defs.map(readTemplateName));
  if (!names.has(name)) return name;
  let index = 2;
  let candidate = `${name}-copy`;
  while (names.has(candidate)) {
    candidate = `${name}-copy-${index}`;
    index += 1;
  }
  return candidate;
}

function uniqueTemplateKey(key: string, defs: Record<string, unknown>[], fallbackName: string): string {
  const keys = new Set(defs.map((def) => typeof def.key === 'string' && def.key.trim() ? def.key.trim() : readTemplateName(def)));
  const base = key.trim() || fallbackName;
  if (!keys.has(base)) return base;
  let index = 2;
  let candidate = `${base}-copy`;
  while (keys.has(candidate)) {
    candidate = `${base}-copy-${index}`;
    index += 1;
  }
  return candidate;
}

function cloneJsonObject(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function placeMetaTemplateMenu(menu: HTMLElement): void {
  const rect = menu.getBoundingClientRect();
  const margin = 8;
  const left = Math.min(Math.max(margin, rect.left), Math.max(margin, window.innerWidth - rect.width - margin));
  const top = Math.min(Math.max(margin, rect.top), Math.max(margin, window.innerHeight - rect.height - margin));
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

function showMetaTemplateNotice(root: HTMLElement, source: HTMLElement, message: string): void {
  root.querySelector('.hvy-meta-template-notice')?.remove();
  const notice = documentOwner().createElement('section');
  notice.className = 'hvy-context-popover hvy-meta-template-notice';
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  notice.textContent = message;
  notice.style.position = 'fixed';
  const rect = source.getBoundingClientRect();
  notice.style.left = `${Math.max(8, rect.left)}px`;
  notice.style.top = `${Math.max(8, rect.bottom + 6)}px`;
  root.append(notice);
  placeMetaTemplateMenu(notice);
  window.setTimeout(() => notice.remove(), 3200);
}

function installViewerCarouselInteractions(root: HTMLElement): () => void {
  let frame = 0;
  const bind = () => {
    frame = 0;
    bindCarouselInteractions(root);
  };
  const scheduleBind = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(bind);
  };
  const observer = new MutationObserver(scheduleBind);
  bindCarouselInteractions(root);
  observer.observe(root, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    if (frame) {
      window.cancelAnimationFrame(frame);
    }
  };
}

function installChatPanelResize(root: HTMLElement): () => void {
  const controller = new AbortController();
  const cornerSize = 24;
  const minWidth = 320;
  const minHeight = 360;
  const maxInset = 32;
  let resizedSize: { width: number; height: number } | null = null;
  let suppressNextClick = false;

  const applySize = () => {
    if (!resizedSize) return;
    root.style.setProperty('--hvy-chat-panel-width', `${resizedSize.width}px`);
    root.style.setProperty('--hvy-chat-panel-height', `${resizedSize.height}px`);
    root.querySelector<HTMLElement>('.chat-dock')?.style.setProperty('width', `${resizedSize.width}px`);
    root.querySelector<HTMLElement>('.chat-panel.is-question-answer')?.style.setProperty('flex-basis', `${resizedSize.height}px`);
  };

  const observer = new MutationObserver(() => applySize());
  observer.observe(root, { childList: true, subtree: true });

  root.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const panel = (event.target as Element | null)?.closest<HTMLElement>('.chat-panel');
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    if (event.clientX - rect.left > cornerSize || event.clientY - rect.top > cornerSize) return;

    event.preventDefault();
    event.stopPropagation();
    panel.setPointerCapture(event.pointerId);
    panel.classList.add('is-resizing');

    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = rect.width;
    const startHeight = rect.height;
    const hostRect = root.getBoundingClientRect();
    const maxWidth = Math.max(minWidth, hostRect.width - maxInset * 2);
    const maxHeight = Math.max(minHeight, hostRect.height - maxInset * 2);

    const onMove = (moveEvent: PointerEvent) => {
      const width = Math.min(maxWidth, Math.max(minWidth, startWidth + startX - moveEvent.clientX));
      const height = Math.min(maxHeight, Math.max(minHeight, startHeight + startY - moveEvent.clientY));
      resizedSize = { width: Math.round(width), height: Math.round(height) };
      applySize();
    };
    const onEnd = () => {
      suppressNextClick = true;
      panel.classList.remove('is-resizing');
      panel.releasePointerCapture(event.pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      requestAnimationFrame(applySize);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd, { once: true });
    window.addEventListener('pointercancel', onEnd, { once: true });
  }, { signal: controller.signal, capture: true });

  root.addEventListener('click', (event) => {
    if (!suppressNextClick) return;
    suppressNextClick = false;
    event.preventDefault();
    event.stopPropagation();
  }, { signal: controller.signal, capture: true });

  return () => {
    observer.disconnect();
    controller.abort();
  };
}

export function serializeMountedDocument(mounted: MountedDocument): Uint8Array {
  return mounted.mount.serializeDocumentBytes();
}

export function getMountedRecoveryState(mounted: MountedDocument): string | null {
  return mounted.mount.getRecoveryState?.() ?? null;
}

export function applyMountedRecoveryState(mounted: MountedDocument, recoveryState?: string | null): void {
  mounted.mount.applyRecoveryState?.(recoveryState);
}

export function getMountedDocument(mounted: MountedDocument): VisualDocument {
  return mounted.mount.getDocument();
}

export function importTextIntoMountedDocument(mounted: MountedDocument, options: ImportFromTextOptions): Promise<ImportFromTextResult> {
  return mounted.mount.importFromText(options);
}

export function buildMountedImportPlan(mounted: MountedDocument, options: BuildImportPlanOptions): Promise<BuildImportPlanResult> {
  return mounted.mount.buildImportPlan(options);
}

export function markMountedDocumentSaved(mounted: MountedDocument): void {
  mounted.mount.markSaved();
}

export function isMountedDocumentDirty(mounted: MountedDocument): boolean {
  return mounted.mount.isDirty();
}

export function openMountedDocumentMeta(mounted: MountedDocument): boolean {
  return mounted.mount.openDocumentMeta?.() ?? false;
}

export function setMountedSearchSnapshot(mounted: MountedDocument, snapshot: HvySearchSnapshotInput | null): void {
  mounted.mount.setSearchSnapshot?.(snapshot);
}
