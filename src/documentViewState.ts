export interface DocumentViewToggleState {
  action: string;
  attributes: Record<string, string>;
  expanded: boolean;
}

export interface DocumentViewState {
  sidebar: 'viewer' | 'editor' | null;
  toggles: DocumentViewToggleState[];
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
  return { sidebar, toggles: Array.from(toggles.values()) };
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
