'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { runWebMcp } = require('../src-electron/integration-webmcp.cjs');

// The isolated world the preload is told, as main.cjs tells it.
const WORLD_ID = 1001;
const INSPECTOR = fs.readFileSync(path.join(__dirname, '..', 'src', 'integration-inspector.js'), 'utf8');
const POLYFILL = fs.readFileSync(path.join(__dirname, '..', 'node_modules', '@mcp-b', 'webmcp-polyfill', 'dist', 'index.iife.js'), 'utf8');

app.commandLine.appendSwitch('disable-gpu');

async function until(check) {
  const deadline = Date.now() + 5000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${check}.`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function main() {
  const server = http.createServer((request, response) => {
    if (request.url === '/api/items') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ items: [] }));
      return;
    }
    response.setHeader('content-type', 'text/html');
    // A site that looks for Galaxy the ways a page can: where it navigates, our globals, and the browser's functions
    // that reading a page calls, replaced (after its own request for its API).
    if (request.url === '/jobs') {
      response.end(`<!doctype html><h1>Jobs</h1><script>
        window.noticed = [];
        navigation.addEventListener('navigate', (event) => noticed.push('navigation ' + event.destination.url));
        fetch('/api/items').then((reply) => reply.json()).then(() => { window.loaded = true; });
        for (const [owner, name] of [[Element.prototype, 'querySelectorAll'], [Document.prototype, 'querySelectorAll'], [window, 'getComputedStyle'], [JSON, 'stringify'], [window, 'fetch'], [window, 'btoa']]) {
          const original = owner[name];
          owner[name] = function (...args) { noticed.push(name); return original.apply(this, args); };
        }
      </script>`);
      return;
    }
    if (request.url === '/polyfill.js') {
      response.setHeader('content-type', 'text/javascript');
      response.end(POLYFILL);
      return;
    }
    if (request.url === '/child') {
      response.end(`<script src="/polyfill.js"></script><script>document.modelContext.registerTool({name:'child.read',description:'Read child',inputSchema:{type:'object'},annotations:{readOnlyHint:true},execute:()=>({child:true})})</script>`);
      return;
    }
    response.end(`<!doctype html><script src="/polyfill.js"></script><iframe src="/child"></iframe><script>
      document.modelContext.registerTool({name:'slow.wait',description:'Wait a long time',inputSchema:{type:'object'},annotations:{readOnlyHint:true},execute:()=>new Promise((resolve)=>setTimeout(()=>resolve('late'),20000))});
      document.modelContext.registerTool({name:'fixture.read',description:'Read fixture',inputSchema:{type:'object',properties:{id:{type:'string'}}},annotations:{readOnlyHint:true},execute:args=>({id:args.id,ok:true})});
    </script>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  ipcMain.on('hvy:integration-page-setup', (event) => { event.returnValue = { worldId: WORLD_ID }; });
  const pageMessages = [];
  ipcMain.on('hvy:integration-page-message', (_event, message) => pageMessages.push(message));
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src-electron', 'integration-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: true,
      sandbox: true,
    },
  });
  try {
    await window.loadURL(origin);
    await window.webContents.executeJavaScript(`new Promise(resolve => {
      const frame = document.querySelector('iframe');
      if (frame?.contentDocument?.readyState === 'complete') resolve();
      else frame?.addEventListener('load', resolve, {once:true});
    })`);
    const discovery = await runWebMcp(window.webContents, 'discover', { requestId: 'discover' });
    assert.deepEqual(discovery.tools.map((tool) => tool.name).sort(), ['child.read', 'fixture.read', 'slow.wait']);
    const descriptor = discovery.tools.find((tool) => tool.name === 'fixture.read');
    assert.deepEqual((await runWebMcp(window.webContents, 'invoke', { requestId: 'invoke', name: 'fixture.read', origin, descriptor, arguments: { id: '42' } })).value, { id: '42', ok: true });
    assert.deepEqual(await window.webContents.executeJavaScript('Object.getOwnPropertyNames(window).filter((key) => /hvy|galaxy/i.test(key))'), []);
    // A page that navigates away while a request runs ends it, said as such, rather than waiting on.
    const slow = discovery.tools.find((tool) => tool.name === 'slow.wait');
    const running = runWebMcp(window.webContents, 'invoke', { requestId: 'slow', name: 'slow.wait', origin, descriptor: slow, arguments: {} });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await window.loadURL(`${origin}/child`);
    const ended = await Promise.race([running, new Promise((resolve) => setTimeout(() => resolve('still waiting'), 5000))]);
    assert.equal(ended.code, 'NavigationError');
    assert.equal(ended.requestId, 'slow');
    process.stdout.write('Electron WebMCP discovery/invocation smoke passed.\n');

    // Galaxy's scripts read the page from their own isolated world, and send what they find over the preload's
    // channel: the page sees no navigation, no global of ours, and none of its replaced functions called.
    await window.loadURL(`${origin}/jobs`);
    await until(() => window.webContents.executeJavaScript('window.loaded === true'));
    await window.webContents.executeJavaScriptInIsolatedWorld(WORLD_ID, [{ code: `${INSPECTOR}\nwindow.__hvyGalaxyInspector.discoverStructuredSourcesAndPublish({ automatic: true })` }]);
    await until(() => pageMessages.length > 0);
    assert.equal(pageMessages[0].kind, 'publish');
    assert.equal(pageMessages[0].value.kind, 'integration-source-discovery');
    assert.deepEqual(pageMessages[0].value.sources.map((source) => [source.kind, new URL(source.url).pathname]), [['json-api', '/api/items']]);
    assert.deepEqual(await window.webContents.executeJavaScript('({ noticed: window.noticed, inspector: typeof window.__hvyGalaxyInspector, host: typeof window.__hvyGalaxyHost })'), { noticed: [], inspector: 'undefined', host: 'undefined' });
    process.stdout.write('Electron integration isolation smoke passed.\n');
  } finally {
    window.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}

app.whenReady()
  .then(main)
  .then(() => app.quit())
  .catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    app.exit(1);
  });
