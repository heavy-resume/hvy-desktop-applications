'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.commandLine.appendSwitch('disable-gpu');

function decodeResult(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'hvy-integration:' || parsed.hostname !== 'inspection') return null;
  const encoded = parsed.pathname.slice(1).replace(/-/g, '+').replace(/_/g, '/');
  const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

async function main() {
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'text/html');
    if (request.url === '/child') {
      response.end(`<script>document.modelContext.registerTool({name:'child.read',description:'Read child',inputSchema:{type:'object'},annotations:{readOnlyHint:true},execute:()=>({child:true})})</script>`);
      return;
    }
    response.end(`<!doctype html><iframe src="/child"></iframe><script>
      window.webMcpAvailableBeforeSiteJavaScript = typeof document.modelContext?.getTools === 'function';
      document.modelContext.registerTool({name:'fixture.read',description:'Read fixture',inputSchema:{type:'object',properties:{id:{type:'string'}}},annotations:{readOnlyHint:true},execute:args=>({id:args.id,ok:true})});
    </script>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const results = new Map();
  const waiters = new Map();
  const receive = (value) => {
    results.set(value.requestId, value);
    waiters.get(value.requestId)?.(value);
    waiters.delete(value.requestId);
  };
  const waitFor = (requestId) => results.has(requestId)
    ? Promise.resolve(results.get(requestId))
    : Promise.race([
      new Promise((resolve) => waiters.set(requestId, resolve)),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out waiting for ${requestId}.`)), 5000)),
    ]);
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
  window.webContents.on('will-navigate', (event, url) => {
    const value = decodeResult(url);
    if (!value) return;
    event.preventDefault();
    receive(value);
  });
  try {
    await window.loadURL(origin);
    await window.webContents.executeJavaScript(`new Promise(resolve => {
      const frame = document.querySelector('iframe');
      if (frame?.contentDocument?.readyState === 'complete') resolve();
      else frame?.addEventListener('load', resolve, {once:true});
    })`);
    assert.equal(await window.webContents.executeJavaScript('window.webMcpAvailableBeforeSiteJavaScript'), true);
    await window.webContents.executeJavaScript(`window.__hvyGalaxyWebMcp.discover({requestId:'discover'})`);
    const discovery = await waitFor('discover');
    assert.deepEqual(discovery.tools.map((tool) => tool.name).sort(), ['child.read', 'fixture.read']);
    const descriptor = discovery.tools.find((tool) => tool.name === 'fixture.read');
    await window.webContents.executeJavaScript(`window.__hvyGalaxyWebMcp.invoke(${JSON.stringify({ requestId: 'invoke', name: 'fixture.read', origin, descriptor, arguments: { id: '42' } })})`);
    assert.deepEqual((await waitFor('invoke')).value, { id: '42', ok: true });
    process.stdout.write('Electron WebMCP preload/discovery/invocation smoke passed.\n');
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
