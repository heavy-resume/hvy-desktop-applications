'use strict';

// Electron side of web automation's BrowserHost (src/webAutomation/host.ts):
// hidden worker windows that share a browser profile's session, the visible
// sign-in window, page inspection through the integration inspector, page
// commands, same-origin requests from inside a page, and cookie-free
// downloads. The renderer's adapter (src/webAutomation/electronHost.ts)
// turns site patterns into inspector patterns and back.

const { BrowserWindow, session } = require('electron');

const NAVIGATION_TIMEOUT_MS = 30_000;
const DOWNLOAD_PARTITION = 'hvy-galaxy-web-automation-downloads';

function createWebAutomationHost(deps) {
  const profileSessions = new Map();
  const workers = new Map();
  const userWindows = new Map();
  let nextWorker = 1;

  // One session per browser profile, shared by its workers and its sign-in window. It lasts for the app's run: sharing
  // the integration vault's saved cookies with the integration browser is still to come.
  function profileSession(profileId) {
    let browserSession = profileSessions.get(profileId);
    if (!browserSession) {
      browserSession = session.fromPartition(`hvy-galaxy-web-automation-${profileId}`);
      profileSessions.set(profileId, browserSession);
    }
    return browserSession;
  }

  async function createWindow(profileId, show) {
    const browserSession = profileSession(profileId);
    const window = new BrowserWindow({
      show,
      width: 1180,
      height: 820,
      title: 'HVY Galaxy',
      autoHideMenuBar: true,
      webPreferences: {
        session: browserSession,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false,
      },
    });
    const contents = window.webContents;
    contents.setUserAgent(contents.getUserAgent().replace(/\sElectron\/[^\s]+/g, '').replace(/\sHVY(?:[\s-]Galaxy)?\/[^\s]+/gi, ''));
    // The inspector reports some results by navigating to hvy-integration:// URLs; workers read return values instead.
    contents.on('will-navigate', (event, url) => {
      if (url.startsWith('hvy-integration://')) event.preventDefault();
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    return window;
  }

  function worker(workerId) {
    const entry = workers.get(workerId);
    if (!entry || entry.window.isDestroyed()) throw new Error(`Unknown worker ${workerId}.`);
    return entry;
  }

  function waitForLoad(contents) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('The page did not finish loading.')), NAVIGATION_TIMEOUT_MS);
      const loaded = () => finish(null);
      const failed = (_event, code, description, _url, isMainFrame) => {
        if (isMainFrame && code !== -3) finish(new Error(`The page failed to load: ${description}`));
      };
      function finish(error) {
        clearTimeout(timer);
        contents.removeListener('did-finish-load', loaded);
        contents.removeListener('did-fail-load', failed);
        if (error) reject(error);
        else resolve();
      }
      contents.on('did-finish-load', loaded);
      contents.on('did-fail-load', failed);
    });
  }

  function inspector(script) {
    return `${deps.inspectorSource}\n${script}`;
  }

  async function navigate(workerId, url) {
    const { window } = worker(workerId);
    await window.webContents.loadURL(url);
    return { url: window.webContents.getURL() };
  }

  async function back(workerId) {
    const { window } = worker(workerId);
    const history = window.webContents.navigationHistory;
    if (history.canGoBack()) {
      const loaded = waitForLoad(window.webContents);
      history.goBack();
      await loaded;
    }
    return { url: window.webContents.getURL() };
  }

  // Runs each pattern's inspector matcher on the page, and reads its JSON-LD and frames.
  async function inspect(workerId, request) {
    const { window } = worker(workerId);
    return window.webContents.executeJavaScript(inspector(`(async () => {
      const inspector = window.__hvyGalaxyInspector;
      const matches = {};
      for (const pattern of ${JSON.stringify(request.patterns)}) {
        const extraction = await inspector.extractAcrossPage(pattern.matcher);
        matches[pattern.id] = extraction.records || [];
      }
      const jsonLd = [];
      for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
        try { jsonLd.push(JSON.parse(script.textContent || '')); } catch (_) {}
      }
      return {
        url: location.href,
        ready: document.readyState !== 'loading',
        matches,
        jsonLd,
        frames: [...document.querySelectorAll('iframe[src]')].map((frame) => ({ src: frame.src })),
      };
    })()`));
  }

  // A page command (such as Next) or an item command; waits for the page it opens, if any.
  async function runCommand(workerId, payload) {
    const { window } = worker(workerId);
    const contents = window.webContents;
    let navigated = null;
    const started = (details) => {
      if (details.isMainFrame && !details.isSameDocument && !details.url.startsWith('hvy-integration://')) navigated = waitForLoad(contents);
    };
    contents.on('did-start-navigation', started);
    // Commands run on pages other than the one they were taught on, so the page is only checked to be on its site.
    const readyChecks = { urlMode: 'strict-domain', urlValue: new URL(contents.getURL()).hostname, elements: [] };
    try {
      const result = await contents.executeJavaScript(inspector(`window.__hvyGalaxyInspector.executeCommand(${JSON.stringify({ ...payload, readyChecks })})`));
      if (navigated) await navigated;
      return { status: result?.status === 'executed' ? 'executed' : 'no_match' };
    } finally {
      contents.removeListener('did-start-navigation', started);
    }
  }

  // Same-origin, credentialed request made from inside the page the worker is on.
  async function request(workerId, hostRequest) {
    const { window } = worker(workerId);
    return window.webContents.executeJavaScript(`(async () => {
      const request = ${JSON.stringify(hostRequest)};
      const response = await fetch(request.url, { method: request.method, headers: request.headers, body: request.body, credentials: 'include', redirect: 'manual' });
      const contentType = response.headers.get('content-type') || '';
      const text = await response.text();
      let body = text;
      if (contentType.includes('json')) { try { body = JSON.parse(text); } catch (_) {} }
      return { status: response.status, contentType, body };
    })()`);
  }

  // A served document, fetched from the main process: no cookies, no redirects, no referrer, no cache.
  async function download(url, maxBytes) {
    const downloads = session.fromPartition(DOWNLOAD_PARTITION);
    const response = await downloads.fetch(url, { redirect: 'error', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error(`The download returned ${response.status}.`);
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`The download is larger than ${maxBytes} bytes.`);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  }

  // The site's own sign-in page, shown to the user; navigations report back so the renderer sees completion.
  async function openUserWindow(profileId, url) {
    let window = userWindows.get(profileId);
    if (!window || window.isDestroyed()) {
      window = await createWindow(profileId, true);
      userWindows.set(profileId, window);
      const report = (_event, navigatedUrl) => deps.sendEvent({ profileId, window: 'user', url: navigatedUrl });
      window.webContents.on('did-navigate', report);
      window.webContents.on('did-navigate-in-page', report);
      window.on('closed', () => userWindows.delete(profileId));
    }
    await window.webContents.loadURL(url);
    window.show();
    window.focus();
  }

  async function hideUserWindow(profileId) {
    const window = userWindows.get(profileId);
    if (!window || window.isDestroyed()) return;
    window.close();
  }

  async function command(name, args) {
    switch (name) {
      case 'create-worker': {
        const workerId = `worker-${nextWorker++}`;
        workers.set(workerId, { window: await createWindow(args.profileId, false), profileId: args.profileId });
        return workerId;
      }
      case 'reset-worker': worker(args.workerId).window.webContents.navigationHistory.clear(); return null;
      case 'close-worker': {
        const entry = workers.get(args.workerId);
        workers.delete(args.workerId);
        if (entry && !entry.window.isDestroyed()) entry.window.destroy();
        return null;
      }
      case 'show-worker': worker(args.workerId).window.show(); return null;
      case 'hide-worker': worker(args.workerId).window.hide(); return null;
      case 'navigate': return navigate(args.workerId, args.url);
      case 'back': return back(args.workerId);
      case 'inspect': return inspect(args.workerId, args.request);
      case 'run-command': return runCommand(args.workerId, args.payload);
      case 'request': return request(args.workerId, args.request);
      case 'download': return download(args.url, args.maxBytes);
      case 'open-user-window': return openUserWindow(args.profileId, args.url);
      case 'hide-user-window': return hideUserWindow(args.profileId);
      default: throw new Error(`Unknown web automation host command ${name}.`);
    }
  }

  return { command };
}

module.exports = { createWebAutomationHost };
