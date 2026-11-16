/**
 * The integration browser's toolbar: the strip above the site, its own page, so nothing Galaxy draws is in the site
 * or can be reached from it. Back, forward, reload, the address and whether it is secure and allowed, the page's menu
 * (Add page command, Define record type), and close; while picking, what picking says and its buttons in place of the
 * address and the menu.
 *
 * The host tells it what to show (`setBrowserState`, `setInspectionState`, `setSiteInfo`); what is clicked goes to the
 * host as a message (`send`), over the app's IPC. The page's security (its lock and host) stays in view while picking;
 * clicked, it asks the host for the site's information, which the host shows by making the toolbar taller over the page.
 */

/** What the toolbar asks of its host. */
export type IntegrationToolbarMessage =
  | { kind: 'browser'; command: 'back' | 'forward' | 'reload' | 'close' }
  | { kind: 'navigate'; url: string }
  | { kind: 'toolbar-action'; action: string }
  | { kind: 'inspector-control'; id: string }
  /** Site information: opened (the host makes the toolbar taller and sends it, `setSiteInfo`), or closed. */
  | { kind: 'site-info'; open: boolean };

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

/** What the host knows of the page's site: shown by Site information. */
export interface IntegrationToolbarSiteInfo {
  url: string;
  allowed: string[];
  /** The browser profile the page is open in: its sign-ins and cookies are the page's. */
  profileName: string;
  /** The certificate the connection presented, as the browser verified it; null when there is none to show. */
  certificate: { subject: string; issuer: string; validFrom: string; validTo: string; sha256: string } | null;
  /** Why there is no certificate to show (not HTTPS, or this browser doesn't tell). */
  certificateNote?: string;
  /** Whether everything on the page was loaded over a secure connection, where the browser tells. */
  onlySecureContent?: boolean;
  /** The page was refused, and why (its certificate expired, or is for another site): shown first, opened by the host. */
  blocked?: string;
}

export interface IntegrationToolbar {
  setBrowserState(state?: IntegrationToolbarBrowserState): void;
  setInspectionState(state?: IntegrationToolbarInspectionState): void;
  /** Site information, shown; null closes it. */
  setSiteInfo(info: IntegrationToolbarSiteInfo | null): void;
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

/** Whether an address is HTTPS, and whether its origin is one of those allowed (any, with none listed). */
function addressSecurity(url: string, allowed: string[]): { parsed: URL | null; secure: boolean; originAllowed: boolean } {
  let parsed: URL | null;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }
  return { parsed, secure: parsed?.protocol === 'https:', originAllowed: !allowed.length || Boolean(parsed && allowed.includes(parsed.origin)) };
}

/** A date as the host gives it (ISO), shown as a date. */
function shownDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
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
  // The page's security, in view while picking too: clicked, the site's information.
  const security = element('button', 'integration-toolbar-security', { type: 'button' });
  security.setAttribute('aria-label', 'Site information');
  security.setAttribute('aria-expanded', 'false');
  security.append(lock, host);
  const address = element('input', 'integration-toolbar-url', { ariaLabel: 'Address' });
  address.setAttribute('aria-label', 'Address');
  const addressForm = element('form', 'integration-toolbar-address-form');
  addressForm.append(address);
  const addressBox = element('div', 'integration-toolbar-address');
  addressBox.append(security, addressForm);
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

  // Site information: below the bar, over the page, while the host has made the toolbar taller for it.
  const siteInfo = element('section', 'integration-toolbar-site-info', { hidden: true });
  siteInfo.setAttribute('aria-label', 'Site information');
  const showSiteInfo = (open: boolean) => {
    security.setAttribute('aria-expanded', String(open));
    // The bar keeps its height while the host makes the toolbar taller for the information below it.
    if (open) bar.style.height = `${bar.offsetHeight}px`;
    else closeSiteInfo();
    send({ kind: 'site-info', open });
  };
  const closeSiteInfo = () => {
    siteInfo.hidden = true;
    security.setAttribute('aria-expanded', 'false');
    bar.style.height = '';
  };
  security.addEventListener('click', () => showSiteInfo(siteInfo.hidden));
  root.ownerDocument.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !siteInfo.hidden) showSiteInfo(false);
  });

  const bar = element('div', 'integration-toolbar');
  bar.append(
    browserCommand('back', '←', 'Back'),
    browserCommand('forward', '→', 'Forward'),
    browserCommand('reload', '↻', 'Reload'),
    addressBox,
    inspection,
    menuWrap,
    browserCommand('close', '×', 'Close', 'integration-toolbar-close'),
  );
  root.replaceChildren(bar, siteInfo);

  const infoRow = (term: string, value: string, className = '') => {
    const row = element('div', `integration-toolbar-site-info-row ${className}`.trim());
    row.append(element('dt', 'integration-toolbar-site-info-term', { textContent: term }), element('dd', 'integration-toolbar-site-info-value', { textContent: value }));
    return row;
  };

  return {
    setBrowserState({ url = '', allowed = [] } = {}) {
      const { parsed, secure, originAllowed } = addressSecurity(url, allowed);
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
      // Picking: the address can't be typed, but the page's security stays in view.
      addressForm.hidden = active;
      addressBox.classList.toggle('is-compact', active);
      menuWrap.hidden = active;
    },
    setSiteInfo(info) {
      if (!info) {
        closeSiteInfo();
        return;
      }
      const { parsed, secure, originAllowed } = addressSecurity(info.url, info.allowed);
      const heading = element('h2', 'integration-toolbar-site-info-heading', { textContent: parsed?.hostname || info.url });
      const close = button('integration-toolbar-site-info-close', '×', 'Close site information');
      close.addEventListener('click', () => showSiteInfo(false));
      const header = element('div', 'integration-toolbar-site-info-header');
      header.append(heading, close);
      const connection = element('dl', 'integration-toolbar-site-info-list');
      connection.append(
        infoRow('Connection', secure ? 'Secure (HTTPS)' : 'Not secure', secure ? 'is-secure' : 'is-warning'),
        ...(info.onlySecureContent === false ? [infoRow('Content', 'Some of this page loaded without a secure connection', 'is-warning')] : []),
        infoRow('Address', info.url),
        infoRow('Site', originAllowed ? 'Allowed for this integration' : 'Not one of this integration’s sites', originAllowed ? '' : 'is-warning'),
        infoRow('Profile', `${info.profileName}: its sign-ins and cookies`),
      );
      const certificateHeading = element('h3', 'integration-toolbar-site-info-subheading', { textContent: 'Certificate' });
      const certificate = element('dl', 'integration-toolbar-site-info-list');
      if (info.certificate) {
        certificate.append(
          infoRow('Issued to', info.certificate.subject),
          infoRow('Issued by', info.certificate.issuer),
          infoRow('Valid', `${shownDate(info.certificate.validFrom)} – ${shownDate(info.certificate.validTo)}`),
          infoRow('SHA-256', info.certificate.sha256, 'is-fingerprint'),
        );
      } else {
        certificate.append(element('p', 'integration-toolbar-site-info-note', { textContent: info.certificateNote || 'No certificate to show.' }));
      }
      const blocked = info.blocked ? [element('p', 'integration-toolbar-site-info-blocked', { textContent: `Blocked: ${info.blocked}` })] : [];
      siteInfo.replaceChildren(header, ...blocked, connection, certificateHeading, certificate);
      siteInfo.hidden = false;
      security.setAttribute('aria-expanded', 'true');
    },
  };
}
