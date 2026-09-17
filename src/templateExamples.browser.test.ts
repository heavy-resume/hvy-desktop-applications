import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';

let browser: Browser;
let page: Page;
let server: ViteDevServer;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0 }, plugins: [{
    name: 'template-example-test',
    configureServer(vite) {
      vite.middlewares.use('/__template-examples.html', (_request, response) => {
        response.setHeader('Content-Type', 'text/html');
        response.end(`<!doctype html><html><body><div id="app" style="display:none"></div><main id="root" style="width:320px;position:fixed;top:0;left:0"></main>
          <script type="module">
            import '/src/styles.css';
            import { renderWorkspace } from '/src/ui/render-workspaces.ts';
            import { bindWorkspaceEvents } from '/src/ui/events-workspace.ts';
            import { bindClickEvents } from '/src/ui/events-click.ts';
            import { state } from '/src/state.ts';
            const template = { kind: 'file', name: 'Resume.thvy', extension: '.thvy', path: '/work/templates/Resume.thvy', relativePath: 'templates/Resume.thvy' };
            const example = { kind: 'file', name: 'Example 1.hvy', extension: '.hvy', path: '/work/templates/Resume/Example 1.hvy', relativePath: 'templates/Resume/Example 1.hvy' };
            const workspace = { path: '/work', manifest: { schemaVersion: 1, name: 'Work' }, files: [{ kind: 'folder', name: 'templates', path: '/work/templates', relativePath: 'templates', children: [template, { kind: 'folder', name: 'Resume', path: '/work/templates/Resume', relativePath: 'templates/Resume', children: [example] }] }] };
            state.workspaces = [workspace];
            const root = document.querySelector('#root');
            root.innerHTML = renderWorkspace(workspace, template.path, null, {}, null, 'templates', true, { 'templates/Resume': false }, [], null);
            window.calls = [];
            const handlers = new Proxy({}, { get: (_, name) => (...args) => window.calls.push([name, ...args]) });
            bindWorkspaceEvents(root, handlers, state, new AbortController().signal);
            bindClickEvents(root, handlers, state, new AbortController().signal);
            window.ready = true;
          </script></body></html>`);
      });
    },
  }] });
  await server.listen();
  page = await browser.newPage();
  page.on('pageerror', (error) => console.error(error.message));
  await page.goto(`http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}/__template-examples.html`);
  await page.waitForFunction(() => (window as any).ready);
}, 30000);
afterAll(async () => {
  await page?.close();
  await server?.close();
  await browser?.close();
});

it('renders examples permanently beneath a template that still opens as a file', async () => {
  const template = page.locator('.tree-template-with-examples');
  expect(await template.count()).toBe(1);
  expect(await page.locator('.tree-template-examples .tree-file').count()).toBe(1);
  expect(await page.locator('.tree details').count()).toBe(0);
  await template.click();
  expect(await page.evaluate(() => (window as any).calls)).toContainEqual(['selectFile', '/work/templates/Resume.thvy']);
});

it('offers New Example on the template and example, with both actions targeting the template', async () => {
  for (const selector of ['.tree-template-with-examples', '.tree-template-examples .tree-file']) {
    await page.locator(selector).click({ button: 'right' });
    expect(await page.locator('.file-context-menu button', { hasText: /^New Document$/ }).count()).toBe(0);
    await page.locator('.file-context-menu button', { hasText: /^New Example$/ }).click();
  }
  const calls = await page.evaluate(() => (window as any).calls.filter((call: string[]) => call[0] === 'newTemplateExample'));
  expect(calls).toEqual([
    ['newTemplateExample', '/work', 'templates/Resume.thvy'],
    ['newTemplateExample', '/work', 'templates/Resume.thvy'],
  ]);
});
