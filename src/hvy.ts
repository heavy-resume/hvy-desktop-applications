import { openExternalUrl, saveBinaryAsDialog, type DocumentExtension } from './backend';
import { bindCarouselInteractions } from '../../heavy-file-format/src/editor/components/carousel/carousel';
import { prepareComponentDefinitionForDocumentPasteWithResult } from '../../heavy-file-format/src/editor-clipboard';
import { openPhvyPasteConfirmationPopover } from '../../heavy-file-format/src/bind/handlers/phvy-paste-confirmation-popover';
import { chatSemanticFilterProvider } from '../../heavy-file-format/src/search/semantic-provider';
import { externalHttpUrlFromHref, mailtoLinkFromHref, shouldOpenExternalLinkForClick, type MailtoLink } from './linkOpening';
import type {
  ComponentDefinition,
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
type ImageAttachmentMaxDimensions = NonNullable<Parameters<HvyEmbedModule['mountHvy']>[0]['imageAttachmentMaxDimensions']>;
type HvyRecoveryStateMount = {
  getRecoveryState?: () => string | null;
  applyRecoveryState?: (recoveryState?: string | null) => void;
};
type HvyMount = Pick<HvyEmbedMount, 'destroy' | 'getDocument' | 'serializeDocumentBytes' | 'serializeDocumentBytesAsync' | 'getPdfBlob' | 'markSaved' | 'isDirty' | 'undo' | 'redo' | 'buildImportPlan' | 'importFromText'> & {
  openDocumentMeta?: HvyEmbedMount['openDocumentMeta'];
  setSearchSnapshot?: HvyEmbedMount['setSearchSnapshot'];
  getSearchSnapshot?: HvyEmbedMount['getSearchSnapshot'];
} & HvyRecoveryStateMount;
export type VisualDocument = ReturnType<HvyEmbedModule['deserializeDocumentBytes']>;
export interface HvySerializationCostProfile {
  totalProfileMs: number;
  sectionCount: number;
  blockCount: number;
  componentTotals: Record<string, { count: number; durationMs: number; textLength: number }>;
  slowestSections: Array<{ title: string; durationMs: number; textLength: number }>;
  slowestBlocks: Array<{ component: string; id: string | null; durationMs: number; textLength: number }>;
}
type ImportTagFilterOptions = {
  excludeTags?: string;
};
export type BuildImportPlanOptions = Parameters<HvyEmbedMount['buildImportPlan']>[0] & ImportTagFilterOptions;
export type BuildImportPlanResult = Awaited<ReturnType<HvyEmbedMount['buildImportPlan']>>;
export type ImportFromTextOptions = Parameters<HvyEmbedMount['importFromText']>[0] & ImportTagFilterOptions;
export type ImportFromTextResult = Awaited<ReturnType<HvyEmbedMount['importFromText']>>;
type HvyDocumentChangeCallback = NonNullable<Parameters<HvyEmbedModule['mountHvy']>[0]['onDocumentChange']>;
type MetaTemplateKind = 'component' | 'section';
type MetaTemplateClipboard =
  | { kind: 'component'; definition: Record<string, unknown> }
  | { kind: 'section'; definition: Record<string, unknown>; componentDefinitions: Record<string, unknown>[] };
type DocumentAttachment = VisualDocument['attachments'][number];

export interface MountedDocument {
  mount: HvyMount;
  document: VisualDocument;
}

export interface MountHvyDocumentOptions {
  onDocumentChange?: HvyDocumentChangeCallback;
  storageKey?: string;
  searchSnapshot?: HvySearchSnapshotInput | null;
  hiddenFromAI?: boolean;
  maxContextChars?: number;
  imageAttachmentMaxDimensions?: ImageAttachmentMaxDimensions;
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
  const { serializeDocumentBytesAsync } = await loadHvyEmbed();
  return serializeDocumentBytesAsync(document);
}

export async function profileHvySerializationCosts(document: VisualDocument): Promise<HvySerializationCostProfile> {
  const { serializeBlockFragment, serializeSectionFragment } = await import('../../heavy-file-format/src/serialization');
  const startedAt = performance.now();
  const componentTotals: HvySerializationCostProfile['componentTotals'] = {};
  const slowestSections: HvySerializationCostProfile['slowestSections'] = [];
  const slowestBlocks: HvySerializationCostProfile['slowestBlocks'] = [];
  let sectionCount = 0;
  let blockCount = 0;
  const recordSlowSection = (entry: HvySerializationCostProfile['slowestSections'][number]) => {
    slowestSections.push(entry);
    slowestSections.sort((left, right) => right.durationMs - left.durationMs);
    slowestSections.length = Math.min(slowestSections.length, 12);
  };
  const recordSlowBlock = (entry: HvySerializationCostProfile['slowestBlocks'][number]) => {
    slowestBlocks.push(entry);
    slowestBlocks.sort((left, right) => right.durationMs - left.durationMs);
    slowestBlocks.length = Math.min(slowestBlocks.length, 20);
  };
  const visitBlock = (block: unknown) => {
    if (!isRecord(block)) return;
    const started = performance.now();
    const text = serializeBlockFragment(block as unknown as Parameters<typeof serializeBlockFragment>[0], document.meta);
    const durationMs = roundProfileDuration(performance.now() - started);
    const schema = isRecord(block.schema) ? block.schema : {};
    const component = typeof schema.component === 'string' ? schema.component : 'unknown';
    const id = typeof block.id === 'string' ? block.id : typeof schema.id === 'string' ? schema.id : null;
    blockCount += 1;
    const total = componentTotals[component] ?? { count: 0, durationMs: 0, textLength: 0 };
    total.count += 1;
    total.durationMs = roundProfileDuration(total.durationMs + durationMs);
    total.textLength += text.length;
    componentTotals[component] = total;
    recordSlowBlock({ component, id, durationMs, textLength: text.length });
    visitNestedBlocks(schema.containerBlocks);
    visitNestedBlocks(schema.componentListBlocks);
    if (Array.isArray(schema.gridItems)) {
      schema.gridItems.forEach((item) => {
        if (isRecord(item)) visitBlock(item.block);
      });
    }
    if (isRecord(schema.expandableStubBlocks)) visitNestedBlocks(schema.expandableStubBlocks.children);
    if (isRecord(schema.expandableContentBlocks)) visitNestedBlocks(schema.expandableContentBlocks.children);
  };
  const visitNestedBlocks = (blocks: unknown) => {
    if (Array.isArray(blocks)) blocks.forEach(visitBlock);
  };
  const visitSection = (section: unknown) => {
    if (!isRecord(section)) return;
    const started = performance.now();
    const text = serializeSectionFragment(section as unknown as Parameters<typeof serializeSectionFragment>[0], document.meta);
    const durationMs = roundProfileDuration(performance.now() - started);
    sectionCount += 1;
    recordSlowSection({
      title: typeof section.title === 'string' ? section.title : '',
      durationMs,
      textLength: text.length,
    });
    visitNestedBlocks(section.blocks);
    if (Array.isArray(section.children)) section.children.forEach(visitSection);
  };
  document.sections.forEach(visitSection);
  return {
    totalProfileMs: roundProfileDuration(performance.now() - startedAt),
    sectionCount,
    blockCount,
    componentTotals,
    slowestSections,
    slowestBlocks,
  };
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
    chatSettings: options.maxContextChars ? { maxContextChars: options.maxContextChars } : null,
    imageAttachmentMaxDimensions: options.imageAttachmentMaxDimensions,
    semanticFilterProvider: options.hiddenFromAI ? null : chatSemanticFilterProvider,
    editorClipboard: editorClipboardHost,
    storageKey: null,
    searchSnapshot: options.searchSnapshot ?? null,
    onDocumentChange: options.onDocumentChange,
  });
  const mounted = withMetaTemplateContextMenu(root, withChatPanelResize(root, mount), options);
  const interactiveMount = mode === 'viewer' ? withViewerCarouselInteractions(root, mounted) : mounted;
  const finalMount = withAttachmentDownload(root, withExternalLinkOpening(root, mode, interactiveMount));
  return {
    mount: finalMount,
    get document() {
      return finalMount.getDocument();
    },
  };
}

export function restoreRawHvyAttachmentBytes(
  document: VisualDocument,
  previousAttachments: DocumentAttachment[],
): VisualDocument {
  if (previousAttachments.length === 0 || document.attachments.length === 0) {
    return document;
  }
  const previousById = new Map(previousAttachments.map((attachment) => [attachment.id, attachment]));
  let restored = false;
  const nextAttachments = document.attachments.map((attachment) => {
    if (attachment.bytes.length > 0) {
      return attachment;
    }
    const previous = previousById.get(attachment.id);
    if (!previous || previous.bytes.length === 0) {
      return attachment;
    }
    restored = true;
    return {
      ...attachment,
      bytes: Uint8Array.from(previous.bytes),
    };
  });
  if (restored) {
    document.attachments = nextAttachments;
  }
  return document;
}

function withAttachmentDownload(root: HTMLElement, mount: HvyMount): HvyMount {
  const cleanup = new AbortController();
  root.addEventListener('hvy:download-attachment', (event) => {
    if (!(event instanceof CustomEvent)) return;
    const detail = event.detail as { filename?: unknown; bytes?: unknown };
    if (typeof detail.filename !== 'string' || !(detail.bytes instanceof Uint8Array)) return;
    event.preventDefault();
    void saveBinaryAsDialog({ suggestedName: detail.filename, bytes: detail.bytes }).catch((error) => {
      console.error('[hvy:download] Failed to save attachment.', error);
    });
  }, { signal: cleanup.signal });
  const destroy = mount.destroy;
  return {
    ...mount,
    destroy() {
      cleanup.abort();
      destroy.call(mount);
    },
  };
}

function withExternalLinkOpening(root: HTMLElement, mode: HvyMode, mount: HvyMount): HvyMount {
  const cleanup = new AbortController();
  const closeEmailPopover = () => {
    root.querySelector('.hvy-email-link-popover')?.remove();
    root.querySelector('.hvy-email-link-popover-backdrop')?.remove();
  };
  root.addEventListener('click', (event) => {
    const target = event.target;
    const actionButton = target instanceof Element
      ? target.closest<HTMLButtonElement>('.hvy-email-link-popover button[data-email-link-action]')
      : null;
    if (actionButton && root.contains(actionButton)) {
      event.preventDefault();
      event.stopPropagation();
      const action = actionButton.dataset.emailLinkAction;
      const emailAddress = actionButton.dataset.emailAddress ?? '';
      const url = actionButton.dataset.emailUrl ?? '';
      closeEmailPopover();
      if (action === 'copy') {
        void navigator.clipboard.writeText(emailAddress);
      }
      if (action === 'open') {
        void openExternalUrl(url);
      }
      return;
    }
    const emailPopover = root.querySelector('.hvy-email-link-popover');
    if (emailPopover && target instanceof Element && !target.closest('.hvy-email-link-popover')) {
      closeEmailPopover();
    }
    if (!(target instanceof Element) || !shouldOpenExternalLinkForClick(mode, event)) {
      return;
    }
    const anchor = target.closest<HTMLAnchorElement>('a[href]');
    if (!anchor || !root.contains(anchor)) {
      return;
    }
    const mailtoLink = mailtoLinkFromHref(anchor.getAttribute('href'));
    if (mailtoLink) {
      event.preventDefault();
      event.stopPropagation();
      showEmailLinkPopover(root, mailtoLink, event);
      return;
    }
    const url = externalHttpUrlFromHref(anchor.getAttribute('href'));
    if (!url) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void openExternalUrl(url);
  }, { capture: true, signal: cleanup.signal });
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closeEmailPopover();
  }, { signal: cleanup.signal });

  return {
    ...mount,
    destroy() {
      cleanup.abort();
      closeEmailPopover();
      mount.destroy();
    },
  };
}

function showEmailLinkPopover(root: HTMLElement, link: MailtoLink, event: MouseEvent): void {
  root.querySelector('.hvy-email-link-popover')?.remove();
  root.querySelector('.hvy-email-link-popover-backdrop')?.remove();

  const backdrop = documentOwner().createElement('div');
  backdrop.className = 'hvy-context-popover-backdrop hvy-email-link-popover-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');

  const popover = documentOwner().createElement('section');
  popover.className = 'hvy-context-popover hvy-email-link-popover';
  popover.setAttribute('aria-label', 'Email link options');
  popover.style.position = 'fixed';
  popover.style.left = `${Math.max(8, event.clientX)}px`;
  popover.style.top = `${Math.max(8, event.clientY)}px`;

  const address = documentOwner().createElement('div');
  address.className = 'hvy-email-link-popover-address';
  address.textContent = link.emailAddress;
  popover.append(
    address,
    createEmailLinkButton('Copy email address', 'copy', link),
    createEmailLinkButton('Open email app', 'open', link),
  );

  root.append(backdrop, popover);
  placeMetaTemplateMenu(popover);
  popover.querySelector<HTMLButtonElement>('button')?.focus();
}

function createEmailLinkButton(label: string, action: string, link: MailtoLink): HTMLButtonElement {
  const button = documentOwner().createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.dataset.emailLinkAction = action;
  button.dataset.emailAddress = link.emailAddress;
  button.dataset.emailUrl = link.url;
  return button;
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
  const searchBar = documentOwner().createElement('form');
  searchBar.className = 'raw-hvy-search-bar';
  searchBar.hidden = true;
  const searchInput = documentOwner().createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'search-input';
  searchInput.dataset.field = 'raw-hvy-search-query';
  searchInput.placeholder = 'Find in HVY source...';
  searchInput.autocomplete = 'off';
  searchInput.spellcheck = false;
  const searchStatus = documentOwner().createElement('span');
  searchStatus.className = 'raw-hvy-search-status';
  const previousButton = documentOwner().createElement('button');
  previousButton.type = 'button';
  previousButton.className = 'tiny';
  previousButton.textContent = 'Prev';
  const nextButton = documentOwner().createElement('button');
  nextButton.type = 'submit';
  nextButton.className = 'tiny';
  nextButton.textContent = 'Next';
  const closeButton = documentOwner().createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'tiny';
  closeButton.dataset.action = 'close-search';
  closeButton.textContent = 'Close';
  searchBar.append(searchInput, searchStatus, previousButton, nextButton, closeButton);
  const textarea = documentOwner().createElement('textarea');
  textarea.className = 'raw-hvy-textarea';
  textarea.spellcheck = false;
  textarea.value = lastSavedText;
  shell.append(searchBar, textarea);
  root.replaceChildren(shell);
  const searchCleanup = new AbortController();
  let rawSearchQuery = '';
  let rawSearchMatches: number[] = [];
  let rawSearchIndex = -1;
  const scrollTextareaSelectionIntoView = (index: number) => {
    const beforeMatch = textarea.value.slice(0, index);
    const lineIndex = beforeMatch.split('\n').length - 1;
    const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 20;
    const targetTop = lineIndex * lineHeight;
    textarea.scrollTop = Math.max(0, targetTop - textarea.clientHeight / 2);
  };

  const refreshRawSearchMatches = () => {
    const query = searchInput.value;
    if (!query) {
      rawSearchQuery = '';
      rawSearchMatches = [];
      rawSearchIndex = -1;
      searchStatus.textContent = '';
      return;
    }
    if (query === rawSearchQuery) {
      return;
    }
    rawSearchQuery = query;
    const source = textarea.value;
    const normalizedSource = source.toLowerCase();
    const normalizedQuery = query.toLowerCase();
    rawSearchMatches = [];
    let index = normalizedSource.indexOf(normalizedQuery);
    while (index >= 0) {
      rawSearchMatches.push(index);
      index = normalizedSource.indexOf(normalizedQuery, index + normalizedQuery.length);
    }
    rawSearchIndex = rawSearchMatches.length > 0 ? 0 : -1;
  };

  const showRawSearchMatch = (options: { focusSource?: boolean } = {}) => {
    const query = searchInput.value;
    if (!query || rawSearchIndex < 0 || rawSearchMatches.length === 0) {
      searchStatus.textContent = query ? 'No results' : '';
      return;
    }
    const index = rawSearchMatches[rawSearchIndex] ?? -1;
    if (index < 0) {
      searchStatus.textContent = 'No results';
      return;
    }
    textarea.setSelectionRange(index, index + query.length);
    scrollTextareaSelectionIntoView(index);
    if (options.focusSource) {
      textarea.focus();
    }
    searchStatus.textContent = `${rawSearchIndex + 1} of ${rawSearchMatches.length}`;
  };

  const findInSource = (direction: 1 | -1 = 1, options: { advance?: boolean; focusSource?: boolean } = {}) => {
    refreshRawSearchMatches();
    if (options.advance && rawSearchMatches.length > 0) {
      rawSearchIndex = (rawSearchIndex + direction + rawSearchMatches.length) % rawSearchMatches.length;
    }
    showRawSearchMatch({ focusSource: options.focusSource });
  };

  const notifyDirty = (nextDirty: boolean) => {
    dirty = nextDirty;
    options.onDocumentChange?.({ dirty, source: 'editor', reason: 'raw-hvy-input' });
  };

  const replaceTextareaSelection = (nextValue: string, selectionStart: number, selectionEnd: number) => {
    textarea.value = nextValue;
    textarea.setSelectionRange(selectionStart, selectionEnd);
    rawSearchQuery = '';
    notifyDirty(textarea.value !== lastSavedText);
    try {
      parseRawDraft();
    } catch {
      // Invalid raw drafts stay editable; Save will surface the parse error.
    }
  };

  const toggleMarkdownInlineSelection = (marker: string) => {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (start === end) {
      return false;
    }
    const value = textarea.value;
    const selected = value.slice(start, end);
    const markerLength = marker.length;
    const hasOuterMarkers = selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= markerLength * 2;
    const hasSurroundingMarkers = value.slice(start - markerLength, start) === marker && value.slice(end, end + markerLength) === marker;
    if (hasOuterMarkers) {
      replaceTextareaSelection(
        `${value.slice(0, start)}${selected.slice(markerLength, -markerLength)}${value.slice(end)}`,
        start,
        end - markerLength * 2
      );
      return true;
    }
    if (hasSurroundingMarkers) {
      replaceTextareaSelection(
        `${value.slice(0, start - markerLength)}${selected}${value.slice(end + markerLength)}`,
        start - markerLength,
        end - markerLength
      );
      return true;
    }
    replaceTextareaSelection(
      `${value.slice(0, start)}${marker}${selected}${marker}${value.slice(end)}`,
      start + markerLength,
      end + markerLength
    );
    return true;
  };

  const toggleMarkdownBoldSelection = () => toggleMarkdownInlineSelection('**');
  const toggleMarkdownItalicSelection = () => toggleMarkdownInlineSelection('_');
  const toggleMarkdownUnderlineSelection = () => toggleMarkdownInlineSelection('___');
  const toggleMarkdownStrikethroughSelection = () => toggleMarkdownInlineSelection('~~');

  const openSourceSearch = () => {
    searchBar.hidden = false;
    searchInput.focus();
    searchInput.setSelectionRange(0, searchInput.value.length);
  };

  const closeSourceSearch = (options: { focusSource?: boolean } = {}) => {
    searchBar.hidden = true;
    searchStatus.textContent = '';
    if (options.focusSource) {
      textarea.focus();
    }
  };

  shell.addEventListener('hvy:open-raw-search', openSourceSearch);
  shell.addEventListener('hvy:toggle-raw-bold', () => {
    textarea.focus();
    toggleMarkdownBoldSelection();
  });
  shell.addEventListener('hvy:toggle-raw-italic', () => {
    textarea.focus();
    toggleMarkdownItalicSelection();
  });
  shell.addEventListener('hvy:toggle-raw-underline', () => {
    textarea.focus();
    toggleMarkdownUnderlineSelection();
  });
  shell.addEventListener('hvy:toggle-raw-strikethrough', () => {
    textarea.focus();
    toggleMarkdownStrikethroughSelection();
  });
  closeButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeSourceSearch({ focusSource: true });
  });
  previousButton.addEventListener('click', () => findInSource(-1, { advance: true, focusSource: true }));
  searchBar.addEventListener('submit', (event) => {
    event.preventDefault();
    findInSource(1, { advance: true, focusSource: true });
  });
  searchInput.addEventListener('beforeinput', (event) => event.stopPropagation());
  searchInput.addEventListener('input', (event) => {
    event.stopPropagation();
    findInSource(1);
  });
  searchInput.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSourceSearch({ focusSource: true });
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      findInSource(event.shiftKey ? -1 : 1, { advance: true, focusSource: true });
    }
  });
  documentOwner().addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) {
      return;
    }
    const key = event.key.toLowerCase();
    if (!event.shiftKey && key === 'f') {
      event.preventDefault();
      event.stopImmediatePropagation();
      openSourceSearch();
      return;
    }
    if (!event.shiftKey && key === 'b' && toggleMarkdownBoldSelection()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (!event.shiftKey && key === 'i' && toggleMarkdownItalicSelection()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (!event.shiftKey && key === 'u' && toggleMarkdownUnderlineSelection()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (event.shiftKey && key === 'x' && toggleMarkdownStrikethroughSelection()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, { capture: true, signal: searchCleanup.signal });
  textarea.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      const handled = !event.shiftKey && key === 'b'
        ? toggleMarkdownBoldSelection()
        : !event.shiftKey && key === 'i'
        ? toggleMarkdownItalicSelection()
        : !event.shiftKey && key === 'u'
        ? toggleMarkdownUnderlineSelection()
        : event.shiftKey && key === 'x'
        ? toggleMarkdownStrikethroughSelection()
        : false;
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (searchBar.hidden || event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    findInSource(event.shiftKey ? -1 : 1, { advance: true, focusSource: true });
  });
  documentOwner().addEventListener('pointerdown', (event) => {
    if (searchBar.hidden || (event.target instanceof Node && shell.contains(event.target))) {
      return;
    }
    closeSourceSearch();
  }, { capture: true, signal: searchCleanup.signal });
  documentOwner().addEventListener('focusin', (event) => {
    if (searchBar.hidden || (event.target instanceof Node && shell.contains(event.target))) {
      return;
    }
    closeSourceSearch();
  }, { signal: searchCleanup.signal });

  textarea.addEventListener('input', () => {
    rawSearchQuery = '';
    notifyDirty(textarea.value !== lastSavedText);
    try {
      parseRawDraft();
    } catch {
      // Invalid raw drafts stay editable; Save will surface the parse error.
    }
  });
  const parseDraft = () => {
    return parseRawDraft();
  };
  const parseRawDraft = () => {
    const previousAttachments = currentDocument.attachments;
    currentDocument = deserializeDocumentBytes(new TextEncoder().encode(textarea.value), currentDocument.extension);
    restoreRawHvyAttachmentBytes(currentDocument, previousAttachments);
    return currentDocument;
  };
  const syncDraftFromDocument = () => {
    textarea.value = serializeDocument(currentDocument);
    notifyDirty(textarea.value !== lastSavedText);
  };
  const rawImportLlm = async () => {
    const { loadChatSettings } = await import('../../heavy-file-format/src/chat/chat');
    return {
      settings: {
        ...loadChatSettings(),
        ...(options.maxContextChars ? { maxContextChars: options.maxContextChars } : {}),
      },
      client: window.HVY_CHAT_CLIENT ?? null,
    };
  };

  const mount: HvyMount = {
    destroy() {
      searchCleanup.abort();
      root.replaceChildren();
    },
    getDocument() {
      return currentDocument;
    },
    serializeDocumentBytes() {
      parseRawDraft();
      return serializeDocumentBytes(currentDocument);
    },
    async serializeDocumentBytesAsync() {
      return mount.serializeDocumentBytes();
    },
    async getPdfBlob() {
      const { getHvyPdfBlob } = await import('../../heavy-file-format/src/pdf-export/export');
      parseRawDraft();
      return getHvyPdfBlob(currentDocument);
    },
    markSaved() {
      parseRawDraft();
      lastSavedText = serializeDocument(currentDocument);
      textarea.value = lastSavedText;
      notifyDirty(false);
    },
    isDirty() {
      return dirty || textarea.value !== lastSavedText;
    },
    undo() {
      textarea.focus();
      documentOwner().execCommand('undo');
    },
    redo() {
      textarea.focus();
      documentOwner().execCommand('redo');
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
      pasteMetaTemplate(root, mount, kind, onDocumentChange);
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
  if (kind === 'section') {
    const document = mount.getDocument();
    const componentDefs = getMetaTemplateDefinitions(document, 'component');
    const referencedNames = collectReferencedComponentNames(definition);
    collectTransitiveComponentDefinitionNames(referencedNames, componentDefs);
    metaTemplateClipboard = {
      kind,
      definition: cloneJsonObject(definition),
      componentDefinitions: componentDefs
        .filter((def) => referencedNames.has(readTemplateName(def)))
        .map((def) => cloneJsonObject(def)),
    };
    return;
  }
  metaTemplateClipboard = { kind, definition: cloneJsonObject(definition) };
}

function collectTransitiveComponentDefinitionNames(names: Set<string>, componentDefs: Record<string, unknown>[]): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const def of componentDefs) {
      const name = readTemplateName(def);
      if (!names.has(name)) continue;
      for (const referencedName of collectReferencedComponentNames(def)) {
        if (names.has(referencedName)) continue;
        names.add(referencedName);
        changed = true;
      }
    }
  }
}

function pasteMetaTemplate(
  root: HTMLElement,
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
  const commitPaste = (nextDefs: Record<string, unknown>[]): void => {
    if (kind === 'component') {
      meta.component_defs = nextDefs;
    } else {
      meta.section_defs = nextDefs;
    }
    onDocumentChange?.({ dirty: true, reason: `${kind}-template-paste`, source: 'editor' });
    mount.openDocumentMeta?.();
  };
  if (kind === 'component') {
    const nextDefs = [...defs, nextDefinition];
    if (document.extension === '.phvy') {
      const nextMeta = { ...meta, component_defs: nextDefs };
      const prepared = prepareComponentDefinitionForDocumentPasteWithResult(
        document,
        nextDefinition as unknown as ComponentDefinition,
        nextMeta
      );
      if (!prepared.definition) return;
      const compatibleDefs = [...defs, prepared.definition as unknown as Record<string, unknown>];
      if (prepared.removedCount > 0) {
        openPhvyPasteConfirmationPopover(
          () => commitPaste(compatibleDefs),
          () => undefined,
          root
        );
        return;
      }
      commitPaste(compatibleDefs);
      return;
    }
    commitPaste(nextDefs);
  } else {
    if (metaTemplateClipboard.kind === 'section') {
      const componentDefs = getMetaTemplateDefinitions(document, 'component');
      const existingComponentNames = new Set(componentDefs.map(readTemplateName));
      const dependencyDefs = metaTemplateClipboard.componentDefinitions.filter((def) => !existingComponentNames.has(readTemplateName(def)));
      if (dependencyDefs.length > 0) {
        const prepared = prepareComponentDependenciesForPaste(document, meta, componentDefs, dependencyDefs);
        const compatibleSectionDefs = [...defs, nextDefinition];
        if (prepared.removedCount > 0) {
          openPhvyPasteConfirmationPopover(
            () => {
              meta.component_defs = prepared.definitions;
              commitPaste(compatibleSectionDefs);
            },
            () => undefined,
            root
          );
          return;
        }
        meta.component_defs = prepared.definitions;
      }
    }
    commitPaste([...defs, nextDefinition]);
  }
}

function prepareComponentDependenciesForPaste(
  document: VisualDocument,
  meta: Record<string, unknown>,
  existingDefs: Record<string, unknown>[],
  dependencyDefs: Record<string, unknown>[],
): { definitions: Record<string, unknown>[]; removedCount: number } {
  if (document.extension !== '.phvy') {
    return {
      definitions: [...existingDefs, ...dependencyDefs.map((def) => cloneJsonObject(def))],
      removedCount: 0,
    };
  }
  const mergedMeta = {
    ...meta,
    component_defs: [...existingDefs, ...dependencyDefs],
  };
  let removedCount = 0;
  const preparedDefs: Record<string, unknown>[] = [];
  for (const dependencyDef of dependencyDefs) {
    const prepared = prepareComponentDefinitionForDocumentPasteWithResult(
      document,
      dependencyDef as unknown as ComponentDefinition,
      mergedMeta
    );
    removedCount += prepared.removedCount;
    if (prepared.definition) {
      preparedDefs.push(prepared.definition as unknown as Record<string, unknown>);
    }
  }
  return {
    definitions: [...existingDefs, ...preparedDefs],
    removedCount,
  };
}

function collectReferencedComponentNames(definition: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.component === 'string' && !isBuiltinComponentName(record.component)) {
      names.add(record.component);
    }
    for (const componentField of ['componentListComponent', 'expandableStubComponent', 'expandableContentComponent']) {
      const componentName = record[componentField];
      if (typeof componentName === 'string' && !isBuiltinComponentName(componentName)) {
        names.add(componentName);
      }
    }
    Object.values(record).forEach(visit);
  };
  visit(definition);
  return names;
}

function isBuiltinComponentName(componentName: string): boolean {
  return [
    'text',
    'code',
    'container',
    'component-list',
    'grid',
    'expandable',
    'table',
    'image',
    'carousel',
    'button',
    'plugin',
    'xref-card',
  ].includes(componentName);
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

export function serializeMountedDocumentAsync(mounted: MountedDocument): Promise<Uint8Array> {
  return mounted.mount.serializeDocumentBytesAsync();
}

export function getMountedRecoveryState(mounted: MountedDocument): string | null {
  return mounted.mount.getRecoveryState?.() ?? null;
}

export function applyMountedRecoveryState(mounted: MountedDocument, recoveryState?: string | null): void {
  mounted.mount.applyRecoveryState?.(recoveryState);
}

export function undoMountedDocument(mounted: MountedDocument): void {
  mounted.mount.undo();
}

export function redoMountedDocument(mounted: MountedDocument): void {
  mounted.mount.redo();
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

function roundProfileDuration(value: number): number {
  return Math.round(value * 10) / 10;
}
