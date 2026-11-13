/**
 * The integration browser's toolbar: the strip above the site, its own page, so nothing Galaxy draws is in the site
 * or can be reached from it. Back, forward, reload, the address and whether it is secure and allowed, the page's menu
 * (Add page command, Define record type), and close; while picking, what picking says and its buttons in place of the
 * address and the menu.
 *
 * The host tells it what to show (`setBrowserState`, `setInspectionState`); what is clicked goes to the host as a
 * message (`send`), over the app's IPC.
 */

/** What the toolbar asks of its host. */
export type IntegrationToolbarMessage =
  | { kind: 'browser'; command: 'back' | 'forward' | 'reload' | 'close' }
  | { kind: 'navigate'; url: string }
  | { kind: 'toolbar-action'; action: string }
  | { kind: 'inspector-control'; id: string };

export interface IntegrationToolbarBrowserState {
  url?: string;
  allowed?: string[];
}

export interface IntegrationToolbarInspectionState {
  active?: boolean;
  status?: string;
  buttons?: Array<{ id: string; label: string; primary?: boolean; disabled?: boolean }>;
  /** A site setup's fields, as pills: filled once picked; one not yet picked is clicked to say which field a pick is. */
  fields?: Array<{ id: string; label: string; picked?: boolean; disabled?: boolean }>;
}

export interface IntegrationToolbar {
  setBrowserState(state?: IntegrationToolbarBrowserState): void;
  setInspectionState(state?: IntegrationToolbarInspectionState): void;
}

const MENU_ACTIONS: Array<[action: string, label: string]> = [
  ['add-page-command', 'Add page command'],
  ['define-record-type', 'Define record type'],
];

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, properties: Partial<HTMLElementTagNameMap[K]> = {}): HTMLElementTagNameMap[K] {
  const created = document.createElement(tag);
  created.className = className;
  Object.assign(created, properties);
  return created;
}

function button(className: string, label: string, title?: string): HTMLButtonElement {
  const created = element('button', `integration-toolbar-button ${className}`.trim(), { type: 'button', textContent: label });
  if (title) {
    created.title = title;
    created.setAttribute('aria-label', title);
  }
  return created;
}

/** An address as typed: with no scheme, https. */
function typedAddress(value: string): string {
  const trimmed = value.trim();
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function mountIntegrationToolbar(root: HTMLElement, send: (message: IntegrationToolbarMessage) => void): IntegrationToolbar {
  const browserCommand = (command: 'back' | 'forward' | 'reload' | 'close', label: string, title: string, className = '') => {
    const created = button(className, label, title);
    created.addEventListener('click', () => send({ kind: 'browser', command }));
    return created;
  };

  const lock = element('span', 'integration-toolbar-lock');
  const host = element('span', 'integration-toolbar-host');
  const security = element('span', 'integration-toolbar-security');
  security.append(lock, host);
  const address = element('input', 'integration-toolbar-url', { ariaLabel: 'Address' });
  address.setAttribute('aria-label', 'Address');
  const addressForm = element('form', 'integration-toolbar-address');
  addressForm.append(security, address);
  addressForm.addEventListener('submit', (event) => {
    event.preventDefault();
    send({ kind: 'navigate', url: typedAddress(address.value) });
  });

  const status = element('span', 'integration-toolbar-status');
  const inspectionFields = element('div', 'integration-toolbar-fields');
  const inspectionButtons = element('div', 'integration-toolbar-inspection-buttons');
  const inspection = element('div', 'integration-toolbar-inspection', { hidden: true });
  inspection.append(status, inspectionFields, inspectionButtons);

  const menu = element('div', 'integration-toolbar-menu', { hidden: true });
  menu.setAttribute('role', 'menu');
  const toggle = button('integration-toolbar-menu-toggle', '…', 'Page actions');
  toggle.setAttribute('aria-expanded', 'false');
  const showMenu = (shown: boolean) => {
    menu.hidden = !shown;
    toggle.setAttribute('aria-expanded', String(shown));
  };
  toggle.addEventListener('click', () => showMenu(menu.hidden));
  for (const [action, label] of MENU_ACTIONS) {
    const item = button('integration-toolbar-menu-item', label);
    item.setAttribute('role', 'menuitem');
    item.addEventListener('click', () => {
      showMenu(false);
      send({ kind: 'toolbar-action', action });
    });
    menu.append(item);
  }
  const dismiss = button('integration-toolbar-menu-item', 'Cancel');
  dismiss.setAttribute('role', 'menuitem');
  dismiss.addEventListener('click', () => showMenu(false));
  menu.append(dismiss);
  const menuWrap = element('div', 'integration-toolbar-menu-wrap');
  menuWrap.append(toggle, menu);
  // A click anywhere else closes the menu.
  root.ownerDocument.addEventListener('click', (event) => {
    if (!menu.hidden && !(event.target instanceof Node && menuWrap.contains(event.target))) showMenu(false);
  });

  const bar = element('div', 'integration-toolbar');
  bar.append(
    browserCommand('back', '←', 'Back'),
    browserCommand('forward', '→', 'Forward'),
    browserCommand('reload', '↻', 'Reload'),
    addressForm,
    inspection,
    menuWrap,
    browserCommand('close', '×', 'Close', 'integration-toolbar-close'),
  );
  root.replaceChildren(bar);

  return {
    setBrowserState({ url = '', allowed = [] } = {}) {
      let parsed: URL | null;
      try {
        parsed = new URL(url);
      } catch {
        parsed = null;
      }
      const secure = parsed?.protocol === 'https:';
      const originAllowed = !allowed.length || Boolean(parsed && allowed.includes(parsed.origin));
      security.dataset.secure = String(secure);
      security.dataset.allowed = String(originAllowed);
      lock.textContent = secure ? '●' : '▲';
      host.textContent = parsed?.hostname || parsed?.protocol || '';
      if (root.ownerDocument.activeElement !== address) address.value = url;
      security.title = `${secure ? 'Encrypted HTTPS connection' : 'Connection is not encrypted'} · ${originAllowed ? 'Allowed page origin' : 'Outside configured page origins'}`;
    },
    // What picking in the page says, and its buttons: each sends its id back to the page's picker.
    setInspectionState({ active = false, status: text = '', buttons = [], fields = [] } = {}) {
      inspection.hidden = !active;
      status.textContent = text;
      status.title = text;
      inspectionFields.hidden = !fields.length;
      inspectionFields.replaceChildren(...fields.map(({ id, label, picked, disabled }) => {
        const created = element('button', `integration-toolbar-field${picked ? ' is-picked' : ''}`, { type: 'button', textContent: label });
        created.setAttribute('aria-pressed', String(Boolean(picked)));
        created.dataset.inspectorControl = id;
        created.disabled = Boolean(disabled);
        created.addEventListener('click', () => send({ kind: 'inspector-control', id }));
        return created;
      }));
      inspectionButtons.replaceChildren(...buttons.map(({ id, label, primary, disabled }) => {
        const created = button(`integration-toolbar-inspection-button${primary ? ' integration-toolbar-primary' : ''}`, label);
        created.dataset.inspectorControl = id;
        created.disabled = Boolean(disabled);
        created.addEventListener('click', () => send({ kind: 'inspector-control', id }));
        return created;
      }));
      addressForm.hidden = active;
      menuWrap.hidden = active;
    },
  };
}
