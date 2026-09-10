export interface DocumentViewToggleState {
  action: string;
  attributes: Record<string, string>;
  expanded: boolean;
}

export type DocumentFocusSelection =
  | { kind: 'text-control'; start: number; end: number; direction: 'forward' | 'backward' | 'none' }
  | { kind: 'contenteditable'; anchorPath: number[]; anchorOffset: number; focusPath: number[]; focusOffset: number };

export interface DocumentFocusState {
  tagName: string;
  attributes: Record<string, string>;
  path: number[];
  selection: DocumentFocusSelection | null;
}

export interface DocumentViewState {
  sidebar: 'viewer' | 'editor' | null;
  toggles: DocumentViewToggleState[];
  focus: DocumentFocusState | null;
}

const TOGGLE_SELECTOR = [
  '[data-reader-action="toggle-expand"]',
  '[data-reader-action="toggle-view-collapse"]',
  '[data-reader-action="toggle-expandable"]',
  '[data-reader-action="toggle-container"]',
  '[data-action="toggle-editor-expandable"]',
].join(',');

const IDENTITY_ATTRIBUTES = [
  'data-section-key',
  'data-block-id',
  'data-container-key',
  'data-reader-view-target',
  'data-reader-view-collapse-key',
];

export function captureDocumentViewState(root: HTMLElement | null): DocumentViewState | null {
  if (!root) return null;
  const sidebar = root.querySelector('.viewer-shell.is-sidebar-open')
    ? 'viewer'
    : root.querySelector('.editor-shell.is-sidebar-open')
      ? 'editor'
      : null;
  const toggles = new Map<string, DocumentViewToggleState>();
  root.querySelectorAll<HTMLElement>(TOGGLE_SELECTOR).forEach((element) => {
    const expanded = element.getAttribute('aria-expanded');
    if (expanded !== 'true' && expanded !== 'false') return;
    const action = element.dataset.readerAction ?? element.dataset.action ?? '';
    const attributes = Object.fromEntries(
      IDENTITY_ATTRIBUTES
        .map((name) => [name, element.getAttribute(name)] as const)
        .filter((entry): entry is readonly [string, string] => entry[1] !== null),
    );
    const key = `${action}:${JSON.stringify(attributes)}`;
    toggles.set(key, { action, attributes, expanded: expanded === 'true' });
  });
  return { sidebar, toggles: Array.from(toggles.values()), focus: captureFocusState(root) };
}

export async function restoreDocumentViewState(root: HTMLElement | null, state: DocumentViewState | null): Promise<void> {
  if (!root || !state) return;
  const openSidebar = root.querySelector('.viewer-shell.is-sidebar-open')
    ? 'viewer'
    : root.querySelector('.editor-shell.is-sidebar-open')
      ? 'editor'
      : null;
  if (openSidebar !== state.sidebar) {
    const action = state.sidebar === 'editor' || openSidebar === 'editor'
      ? 'toggle-editor-sidebar'
      : 'toggle-viewer-sidebar';
    root.querySelector<HTMLElement>(`[data-action="${action}"]`)?.click();
    await nextFrame();
  }
  for (const toggle of state.toggles) {
    const selector = toggleSelector(toggle);
    const element = root.querySelector<HTMLElement>(selector);
    if (element && (element.getAttribute('aria-expanded') === 'true') !== toggle.expanded) {
      element.click();
      await nextFrame();
    }
  }
  if (state.focus) {
    await nextFrame();
    restoreFocusState(root, state.focus);
  }
}

function captureFocusState(root: HTMLElement): DocumentFocusState | null {
  const activeElement = document.activeElement;
  const focusedElement = activeElement instanceof HTMLElement && root.contains(activeElement)
    ? activeElement
    : editableElementForSelection(root);
  if (!focusedElement) return null;
  return {
    tagName: focusedElement.tagName.toLowerCase(),
    attributes: focusIdentityAttributes(focusedElement),
    path: nodePathWithin(root, focusedElement) ?? [],
    selection: captureFocusSelection(focusedElement),
  };
}

function editableElementForSelection(root: HTMLElement): HTMLElement | null {
  const anchorNode = window.getSelection()?.anchorNode;
  const anchorElement = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement;
  const editable = anchorElement?.closest<HTMLElement>('[contenteditable="true"]') ?? null;
  return editable && root.contains(editable) ? editable : null;
}

function captureFocusSelection(element: HTMLElement): DocumentFocusSelection | null {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    if (element.selectionStart === null || element.selectionEnd === null) return null;
    return {
      kind: 'text-control',
      start: element.selectionStart,
      end: element.selectionEnd,
      direction: element.selectionDirection ?? 'none',
    };
  }
  if (!element.isContentEditable) return null;
  const selection = window.getSelection();
  if (!selection?.anchorNode || !selection.focusNode) return null;
  const anchorPath = nodePathWithin(element, selection.anchorNode);
  const focusPath = nodePathWithin(element, selection.focusNode);
  if (!anchorPath || !focusPath) return null;
  return {
    kind: 'contenteditable',
    anchorPath,
    anchorOffset: selection.anchorOffset,
    focusPath,
    focusOffset: selection.focusOffset,
  };
}

function restoreFocusState(root: HTMLElement, state: DocumentFocusState): void {
  const element = findFocusElement(root, state);
  if (!element) return;
  element.focus({ preventScroll: true });
  if (!state.selection) return;
  if (state.selection.kind === 'text-control') {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.setSelectionRange(state.selection.start, state.selection.end, state.selection.direction);
    }
    return;
  }
  const anchorNode = nodeAtPath(element, state.selection.anchorPath);
  const focusNode = nodeAtPath(element, state.selection.focusPath);
  if (!anchorNode || !focusNode) return;
  const selection = window.getSelection();
  if (!selection) return;
  const anchorOffset = validNodeOffset(anchorNode, state.selection.anchorOffset);
  const focusOffset = validNodeOffset(focusNode, state.selection.focusOffset);
  selection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
}

function focusIdentityAttributes(element: HTMLElement): Record<string, string> {
  return Object.fromEntries(
    Array.from(element.attributes)
      .filter((attribute) => attribute.name === 'id' || attribute.name === 'name' || attribute.name.startsWith('data-'))
      .map((attribute) => [attribute.name, attribute.value]),
  );
}

function findFocusElement(root: HTMLElement, state: DocumentFocusState): HTMLElement | null {
  const attributes = Object.entries(state.attributes);
  if (attributes.length > 0) {
    const candidates = Array.from(root.querySelectorAll<HTMLElement>(cssEscape(state.tagName)));
    let best: HTMLElement | null = null;
    let bestScore = 0;
    let tied = false;
    for (const candidate of candidates) {
      const score = attributes.reduce(
        (total, [name, value]) => total + (candidate.getAttribute(name) === value ? 1 : 0),
        0,
      );
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
        tied = false;
      } else if (score === bestScore && score > 0) {
        tied = true;
      }
    }
    if (best && !tied) return best;
  }
  const pathMatch = nodeAtPath(root, state.path);
  return pathMatch instanceof HTMLElement && pathMatch.tagName.toLowerCase() === state.tagName
    ? pathMatch
    : null;
}

function nodePathWithin(root: Node, node: Node): number[] | null {
  const path: number[] = [];
  let current: Node | null = node;
  while (current && current !== root) {
    const parent: Node | null = current.parentNode;
    if (!parent) return null;
    const index = Array.prototype.indexOf.call(parent.childNodes, current) as number;
    if (index < 0) return null;
    path.unshift(index);
    current = parent;
  }
  return current === root ? path : null;
}

function nodeAtPath(root: Node, path: number[]): Node | null {
  let current = root;
  for (const index of path) {
    const child = current.childNodes[index];
    if (!child) return null;
    current = child;
  }
  return current;
}

function validNodeOffset(node: Node, offset: number): number {
  const maximum = node.nodeType === Node.TEXT_NODE ? node.textContent?.length ?? 0 : node.childNodes.length;
  return Math.max(0, Math.min(offset, maximum));
}

function toggleSelector(toggle: DocumentViewToggleState): string {
  const actionAttribute = toggle.action.startsWith('toggle-editor-') ? 'data-action' : 'data-reader-action';
  return `[${actionAttribute}="${cssEscape(toggle.action)}"]${Object.entries(toggle.attributes)
    .map(([name, value]) => `[${name}="${cssEscape(value)}"]`)
    .join('')}`;
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}
