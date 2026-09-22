import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';

let browser: Browser;
let page: Page;
let server: ViteDevServer;
const pageErrors: string[] = [];

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0 }, plugins: [{
    name: 'hvy-meta-test',
    configureServer(vite) {
      vite.middlewares.use('/__hvy-meta.html', (_request, response) => {
        response.setHeader('Content-Type', 'text/html');
        response.end(`<!doctype html><html><body><main id="root"></main>
          <script type="module">
            import { mountHvyDocument } from '/src/hvy.ts';
            import { createBlankDocument } from '/@fs/${resolve('../heavy-file-format/src/document-factory.ts')}';
            try {
              const hvyDocument = createBlankDocument();
              hvyDocument.extension = '.phvy';
              window.mounted = await mountHvyDocument(document.querySelector('#root'), hvyDocument, 'advanced');
            } catch (error) {
              window.startupError = error instanceof Error ? error.message : String(error);
            } finally {
              window.ready = true;
            }
          </script></body></html>`);
      });
    },
  }] });
  await server.listen();
  page = await browser.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}/__hvy-meta.html`);
  await page.waitForFunction(() => (window as any).ready);
}, 60000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

it('keeps the collapsed search surface mounted when PHVY metadata opens', async () => {
  expect(await page.evaluate(() => (window as any).startupError)).toBeUndefined();
  await page.evaluate(() => (window as any).mounted.mount.openDocumentMeta());
  await page.locator('.document-meta-view').waitFor();
  await page.evaluate(() => new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame())));

  expect(pageErrors).toEqual([]);
  expect(await page.locator('.pane.full-pane > [data-search-surface="collapsed"]').count()).toBe(1);
  expect(await page.locator('.pane.full-pane > .document-meta-scroll').count()).toBe(1);
});
