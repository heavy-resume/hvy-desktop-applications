'use strict';

// A browser window's chrome: the toolbar above the page (src/integrationToolbar/toolbar.ts) with back, forward, reload,
// the address and its security, Site information (the page's certificate, or why the browser refused it), and close.
// The integration browser, the web automation sign-in window, and the pop-ups a sign-in page opens all use it. The
// integration browser adds its own: its page menu, picking's buttons, and navigation inside its allowed sites.

const crypto = require('node:crypto');
const path = require('node:path');
const { BrowserWindow, WebContentsView, ipcMain } = require('electron');

const TOOLBAR_HEIGHT = 52;
/** The toolbar's height while it shows Site information, below its bar and over the page. */
const SITE_INFO_HEIGHT = 360;

/** Each toolbar's chrome, by the toolbar's web contents: what it clicks goes to its chrome. */
const chromes = new Map();

// What a toolbar asks: the browser's buttons and Site information, handled here; anything else (an address typed, the
// page menu, picking's buttons) to its owner, or, for an address in a plain browser, loaded.
ipcMain.on('hvy:integration-toolbar', (event, message) => {
  const chrome = chromes.get(event.sender);
  if (!chrome || !message || typeof message !== 'object') return;
  const { contents } = chrome;
  if (message.kind === 'browser') {
    if (message.command === 'back' && contents.canGoBack()) contents.goBack();
    if (message.command === 'forward' && contents.canGoForward()) contents.goForward();
    if (message.command === 'reload') contents.reload();
    if (message.command === 'close') chrome.window.close();
  } else if (message.kind === 'site-info') {
    chrome.siteInfoOpen = message.open === true;
    chrome.layout();
    if (chrome.siteInfoOpen) chrome.showSiteInfo(siteInfo(chrome));
  } else if (chrome.onMessage) {
    chrome.onMessage(message);
  } else if (message.kind === 'navigate' && typeof message.url === 'string' && /^https?:/i.test(message.url)) {
    void contents.loadURL(message.url);
  }
});

/** Why Chromium refused a page, for Site information: its certificate, or its secure connection. Null for anything else. */
const BLOCKED_REASONS = {
  'net::ERR_CERT_DATE_INVALID': 'its certificate has expired, or isn’t valid yet.',
  'net::ERR_CERT_AUTHORITY_INVALID': 'its certificate isn’t from an authority this browser trusts.',
  'net::ERR_CERT_COMMON_NAME_INVALID': 'its certificate is for a different site.',
  'net::ERR_CERT_REVOKED': 'its certificate has been revoked.',
};
function blockedReason(description) {
  const code = String(description || '');
  if (BLOCKED_REASONS[code]) return BLOCKED_REASONS[code];
  if (code.startsWith('net::ERR_CERT_')) return `its certificate isn’t valid (${code.slice('net::'.length)}).`;
  if (code.startsWith('net::ERR_SSL_')) return `a secure connection to it couldn’t be set up (${code.slice('net::'.length)}).`;
  return null;
}

/** A certificate as Site information shows it: who it was issued to and by, when it is valid, its SHA-256 fingerprint. */
function certificateSummary(certificate) {
  const name = (principal) => {
    const organization = principal?.organizations?.[0];
    const commonName = principal?.commonName;
    if (commonName && organization && commonName !== organization) return `${commonName} (${organization})`;
    return commonName || organization || 'Unknown';
  };
  const der = Buffer.from(String(certificate.data).replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');
  return {
    subject: name(certificate.subject),
    issuer: name(certificate.issuer),
    validFrom: new Date(certificate.validStart * 1000).toISOString(),
    validTo: new Date(certificate.validExpiry * 1000).toISOString(),
    sha256: crypto.createHash('sha256').update(der).digest('hex').toUpperCase().match(/.{2}/g).join(':'),
  };
}

/** The certificate each host presented, as Chromium verified it (its verdict stands), by session: its windows share it. */
const sessionCertificates = new WeakMap();
function certificatesOf(browserSession) {
  let certificates = sessionCertificates.get(browserSession);
  if (!certificates) {
    certificates = new Map();
    sessionCertificates.set(browserSession, certificates);
    browserSession.setCertificateVerifyProc((request, callback) => {
      certificates.set(request.hostname, request.certificate);
      callback(-3);
    });
  }
  return certificates;
}

/** What Site information shows of the page's site: its address, whether it is allowed, its profile, and its certificate. */
function siteInfo(chrome, url = chrome.contents.getURL()) {
  let host = '';
  let secure = false;
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    secure = parsed.protocol === 'https:';
  } catch {
    // Not an address: nothing loaded yet.
  }
  const certificate = secure ? chrome.certificates.get(host) : null;
  return {
    url,
    allowed: chrome.allowedOrigins(),
    profileName: chrome.name(),
    certificate: certificate ? certificateSummary(certificate) : null,
    ...(certificate ? {} : { certificateNote: secure ? 'The certificate couldn’t be read.' : 'This page isn’t on a secure connection, so it has no certificate.' }),
  };
}

/**
 * Puts the toolbar over a page in its window. `options`:
 * - `loadToolbar(contents, mode)`: loads the toolbar page (the dev server's or the built one);
 * - `integration`: an integration's browser (its page menu and allowed sites); otherwise a plain browser's;
 * - `name()`: the browser profile's name, for Site information;
 * - `allowedOrigins()`: the integration's sites ([] for a plain browser);
 * - `onMessage(message)`: what the toolbar asks beyond its browser buttons and Site information.
 * The window's title follows the page's.
 */
function attachBrowserChrome(window, pageView, options) {
  const toolbarView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'integration-toolbar-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.contentView.addChildView(pageView);
  window.contentView.addChildView(toolbarView);
  const contents = pageView.webContents;
  const toolbarContents = toolbarView.webContents;
  const chrome = {
    window,
    pageView,
    contents,
    toolbarView,
    toolbarContents,
    certificates: certificatesOf(contents.session),
    siteInfoOpen: false,
    name: options.name,
    allowedOrigins: options.allowedOrigins || (() => []),
    onMessage: options.onMessage,
    layout() {
      if (window.isDestroyed()) return;
      const [width, height] = window.getContentSize();
      // Site information makes the toolbar taller, over the page, which stays where it is.
      toolbarView.setBounds({ x: 0, y: 0, width, height: chrome.siteInfoOpen ? SITE_INFO_HEIGHT : TOOLBAR_HEIGHT });
      pageView.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width, height: Math.max(0, height - TOOLBAR_HEIGHT) });
    },
    showSiteInfo(info) {
      if (!toolbarContents.isDestroyed()) void toolbarContents.executeJavaScript(`window.hvySetSiteInfo?.(${JSON.stringify(info)})`);
    },
    setBrowserState(url = contents.getURL()) {
      if (!toolbarContents.isDestroyed()) void toolbarContents.executeJavaScript(`window.hvySetBrowserState(${JSON.stringify({ url, allowed: chrome.allowedOrigins() })})`);
    },
    loadToolbar() {
      return options.loadToolbar(toolbarContents, options.integration ? 'integration' : 'browse');
    },
  };
  chromes.set(toolbarContents, chrome);
  toolbarContents.on('destroyed', () => chromes.delete(toolbarContents));
  chrome.layout();
  window.on('resize', chrome.layout);
  // A page refused for its certificate or secure connection: Site information opens on it, saying why.
  contents.on('did-fail-load', (_event, _errorCode, errorDescription, validatedURL, isMainFrame) => {
    const reason = isMainFrame ? blockedReason(errorDescription) : null;
    if (!reason) return;
    chrome.siteInfoOpen = true;
    chrome.layout();
    chrome.showSiteInfo({ ...siteInfo(chrome, validatedURL), blocked: reason });
  });
  // A move without a page load (a single-page site going to another of its pages): the toolbar's address follows it.
  contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (isMainFrame) chrome.setBrowserState(url);
  });
  contents.on('did-finish-load', () => chrome.setBrowserState());
  contents.on('page-title-updated', (_event, title) => {
    const siteTitle = String(title || '').trim();
    if (siteTitle && !window.isDestroyed()) window.setTitle(siteTitle);
  });
  return chrome;
}

/**
 * Lets a plain browser's page open pop-ups (a "Sign in with Google" button's account picker): each in a window of its
 * own with the chrome, in the page's session, its opener kept so it can answer the page. Closed when its page closes
 * itself; a pop-up's own pop-ups open the same way.
 */
function allowPopups(contents, options) {
  contents.setWindowOpenHandler(({ url }) => {
    if (!/^https?:/i.test(url)) return { action: 'deny' };
    return {
      action: 'allow',
      createWindow: (windowOptions) => {
        const popup = new BrowserWindow({
          width: windowOptions.width || 520,
          height: (windowOptions.height || 640) + TOOLBAR_HEIGHT,
          title: 'HVY Galaxy',
          backgroundColor: '#f7f3ea',
          autoHideMenuBar: true,
          ...(options.icon ? { icon: options.icon } : {}),
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
        });
        popup.removeMenu();
        const pageView = new WebContentsView({ webContents: windowOptions.webContents, webPreferences: windowOptions.webPreferences });
        const chrome = attachBrowserChrome(popup, pageView, { ...options, integration: false });
        void chrome.loadToolbar();
        pageView.webContents.on('destroyed', () => {
          if (!popup.isDestroyed()) popup.destroy();
        });
        popup.on('closed', () => {
          if (!pageView.webContents.isDestroyed()) pageView.webContents.close();
        });
        allowPopups(pageView.webContents, options);
        return pageView.webContents;
      },
    };
  });
}

module.exports = { TOOLBAR_HEIGHT, SITE_INFO_HEIGHT, attachBrowserChrome, allowPopups, blockedReason, siteInfo };
