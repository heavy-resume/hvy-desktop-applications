'use strict';

// Electron side of web automation's BrowserHost (src/webAutomation/host.ts):
// hidden worker windows that share a browser profile's session, the visible
// sign-in window, page inspection through the integration inspector, page
// commands, same-origin requests from inside a page, and cookie-free file
// reads. What runs inside a page is shared with Tauri
// (src/web-automation-page.js). The renderer's adapter
// (src/webAutomation/nativeHost.ts) turns site patterns into inspector
// patterns and back.

const { BrowserWindow, WebContentsView, session } = require('electron');

const NAVIGATION_TIMEOUT_MS = 30_000;

// Chromium's network errors that mean the page never reached the site: the connection ones (-100 to -199: refused,
// reset, the name not found, no internet), the network changing, and a timeout. Marked for the renderer
// (src/webAutomation/errors.ts, UNREACHABLE_MARK), which waits for the site and loads the page again.
function isUnreachableLoad(code) {
  return (code <= -100 && code > -200) || code === -21 || code === -7;
}

function loadError(description, code) {
  return new Error(`${isUnreachableLoad(code) ? '[unreachable] ' : ''}The page failed to load: ${description}`);
}
const FETCH_FILE_PARTITION = 'hvy-galaxy-web-automation-files';

function createWebAutomationHost(deps) {
  const profileSessions = new Map();
  const workers = new Map();
  const userWindows = new Map();
  let nextWorker = 1;

  // One session per browser profile, shared by its workers and its sign-in window, for the app's run. It starts with the
  // profile's saved cookies, the integration browser's too (the integration vault, once it is set up), and saves back the
  // cookies of the sites it changed (a sign-in, a check that you're human passed, cookies accepted) when one of its
  // windows closes, so the integration browser and the next run of the app see them.
  function profileSession(profileId) {
    let entry = profileSessions.get(profileId);
    if (!entry) {
      const browserSession = session.fromPartition(`hvy-galaxy-web-automation-${profileId}`);
      const changed = new Set();
      const ready = (deps.profileCookies.available() ? deps.profileCookies.restore(browserSession, profileId) : Promise.resolve()).then(() => {
        // Only changes made after the saved cookies are in.
        browserSession.cookies.on('changed', (_event, cookie) => changed.add(String(cookie.domain || '').replace(/^\./, '')));
      });
      entry = { session: browserSession, changed, ready };
      profileSessions.set(profileId, entry);
    }
    return entry;
  }

  async function saveProfileCookies(profileId) {
    const entry = profileSessions.get(profileId);
    if (!entry || !entry.changed.size || !deps.profileCookies.available()) return;
    const domains = new Set(entry.changed);
    entry.changed.clear();
    await deps.profileCookies.save(entry.session, profileId, domains);
  }

  // The browser's own user agent, without the app's tokens ("Electron/…", and "HVYGalaxy/…" or "HVY Galaxy/…"): sites
  // treat an unfamiliar one as a bot.
  function browserUserAgent(contents) {
    return contents.getUserAgent().replace(/\sElectron\/[^\s]+/g, '').replace(/\sHVY(?:[\s-]?Galaxy)?\/[^\s]+/gi, '');
  }

  // A hidden worker window. `opened` keeps what its page asks to open in a new tab or window.
  async function createWorkerWindow(profileId, opened) {
    const { session: browserSession, ready } = profileSession(profileId);
    await ready;
    const window = new BrowserWindow({
      show: false,
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
    contents.setUserAgent(browserUserAgent(contents));
    // The inspector reports some results by navigating to hvy-integration:// URLs; workers read return values instead.
    contents.on('will-navigate', (event, url) => {
      if (url.startsWith('hvy-integration://')) event.preventDefault();
    });
    // What a page opens in a new tab or window (a list whose rows open their item with window.open, a link with
    // target="_blank"): a worker's is kept for `take-opened-window`, its page left as it is.
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) opened.push(url);
      return { action: 'deny' };
    });
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
        if (isMainFrame && code !== -3) finish(loadError(description, code));
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

  // A call into the shared page script, after the inspector it uses, in their own isolated world, out of the page's reach.
  function pageCall(contents, name, argument) {
    return contents.executeJavaScriptInIsolatedWorld(deps.worldId, [{ code: `${deps.inspectorSource}\n${deps.pageSource}\nwindow.__hvyGalaxyAutomation.${name}(${JSON.stringify(argument)})` }]);
  }

  async function navigate(workerId, url) {
    const { window } = worker(workerId);
    try {
      await window.webContents.loadURL(url);
    } catch (error) {
      // loadURL rejects with Chromium's error: its name (code) and number (errno).
      if (isUnreachableLoad(error?.errno)) throw loadError(error.code || error.message, error.errno);
      throw error;
    }
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

  // What the worker's page last asked to open in a new tab, opened in a worker of its own and loaded there.
  async function takeOpenedWindow(workerId) {
    const entry = worker(workerId);
    const url = entry.opened.pop();
    entry.opened.length = 0;
    if (!url) return null;
    const openedId = await createWorker(entry.profileId);
    try {
      return { workerId: openedId, url: (await navigate(openedId, url)).url };
    } catch (error) {
      // Not loaded, it is nobody's to close.
      await command('close-worker', { workerId: openedId });
      throw error;
    }
  }

  async function createWorker(profileId) {
    const workerId = `worker-${nextWorker++}`;
    const opened = [];
    workers.set(workerId, { window: await createWorkerWindow(profileId, opened), profileId, opened });
    return workerId;
  }

  async function inspect(workerId, request) {
    return pageCall(worker(workerId).window.webContents, 'inspect', request);
  }

  // A page command (such as Next) or an item command; waits for the page it opens, if any.
  async function runCommand(workerId, payload) {
    const { window, opened } = worker(workerId);
    const contents = window.webContents;
    opened.length = 0;
    let navigated = null;
    const started = (details) => {
      if (details.isMainFrame && !details.isSameDocument && !details.url.startsWith('hvy-integration://')) navigated = waitForLoad(contents);
    };
    contents.on('did-start-navigation', started);
    try {
      const result = await pageCall(contents, 'runCommand', payload);
      if (navigated) await navigated;
      return result;
    } finally {
      contents.removeListener('did-start-navigation', started);
    }
  }

  async function request(workerId, hostRequest) {
    return pageCall(worker(workerId).window.webContents, 'request', hostRequest);
  }

  // A served document's file, read into memory from the main process: no cookies, no redirects, no referrer, no cache.
  async function fetchFile(url, maxBytes) {
    const files = session.fromPartition(FETCH_FILE_PARTITION);
    const response = await files.fetch(url, { redirect: 'error', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error(`Reading the file returned ${response.status}.`);
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`The file is larger than ${maxBytes} bytes.`);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  }

  // The site's own sign-in page, shown to the user, under a browser's toolbar (browser-chrome.cjs): its address, and its
  // site's information. Its navigations report back so the renderer sees completion. The pop-ups it opens (a "Sign in
  // with Google" button's account picker) open as real windows, in its session, so they can answer the page.
  async function openUserWindow(profileId, url, profileName) {
    let entry = userWindows.get(profileId);
    if (!entry || entry.window.isDestroyed()) {
      const { session: browserSession, ready } = profileSession(profileId);
      await ready;
      const window = new BrowserWindow({
        show: false,
        width: 1180,
        height: 820,
        title: 'HVY Galaxy',
        autoHideMenuBar: true,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      window.removeMenu();
      const pageView = new WebContentsView({
        webPreferences: {
          session: browserSession,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          backgroundThrottling: false,
        },
      });
      const contents = pageView.webContents;
      contents.setUserAgent(browserUserAgent(contents));
      const chromeOptions = { loadToolbar: deps.chrome.loadToolbar, icon: deps.chrome.icon, integration: false, name: () => entry.profileName, allowedOrigins: () => [] };
      const chrome = deps.chrome.attach(window, pageView, chromeOptions);
      await chrome.loadToolbar();
      deps.chrome.allowPopups(contents, chromeOptions);
      entry = { window, contents, profileName };
      userWindows.set(profileId, entry);
      const report = (_event, navigatedUrl) => deps.sendEvent({ profileId, window: 'user', url: navigatedUrl });
      contents.on('did-navigate', report);
      contents.on('did-navigate-in-page', report);
      window.on('closed', () => {
        userWindows.delete(profileId);
        if (!contents.isDestroyed()) contents.close();
        void saveProfileCookies(profileId);
      });
    }
    entry.profileName = profileName || entry.profileName || profileId;
    await entry.contents.loadURL(url);
    entry.window.show();
    entry.window.focus();
  }

  async function hideUserWindow(profileId) {
    const entry = userWindows.get(profileId);
    if (!entry || entry.window.isDestroyed()) return;
    entry.window.close();
  }

  async function command(name, args) {
    switch (name) {
      case 'create-worker': return createWorker(args.profileId);
      case 'close-worker': {
        const entry = workers.get(args.workerId);
        workers.delete(args.workerId);
        if (entry && !entry.window.isDestroyed()) entry.window.destroy();
        if (entry) await saveProfileCookies(entry.profileId);
        return null;
      }
      case 'show-worker': worker(args.workerId).window.show(); return null;
      case 'hide-worker': worker(args.workerId).window.hide(); return null;
      case 'navigate': return navigate(args.workerId, args.url);
      case 'back': return back(args.workerId);
      case 'take-opened-window': return takeOpenedWindow(args.workerId);
      case 'inspect': return inspect(args.workerId, args.request);
      case 'run-command': return runCommand(args.workerId, args.payload);
      case 'request': return request(args.workerId, args.request);
      case 'fetch-file': return fetchFile(args.url, args.maxBytes);
      case 'open-user-window': return openUserWindow(args.profileId, args.url, args.profileName);
      case 'hide-user-window': return hideUserWindow(args.profileId);
      default: throw new Error(`Unknown web automation host command ${name}.`);
    }
  }

  return { command };
}

module.exports = { createWebAutomationHost };
