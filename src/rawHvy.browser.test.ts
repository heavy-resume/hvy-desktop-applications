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
    name: 'raw-hvy-test',
    configureServer(vite) {
      vite.middlewares.use('/__raw-hvy.html', (_request, response) => {
        response.setHeader('Content-Type', 'text/html');
        response.end(`<!doctype html><html><body><main id="root"></main>
          <script type="module">
            import { mountHvyDocument, deserializeHvy } from '/src/hvy.ts';
            window.openSource = async (source) => {
              window.mounted?.mount.destroy();
              const document = await deserializeHvy(new TextEncoder().encode(source), '.thvy');
              window.mounted = await mountHvyDocument(documentOwner(), document, 'hvy');
            };
            function documentOwner() { return document.querySelector('#root'); }
            window.saveSource = async () => {
              try {
                const bytes = await window.mounted.mount.serializeDocumentBytesAsync();
                window.mounted.mount.markSaved();
                return { text: new TextDecoder().decode(bytes) };
              } catch (error) { return { error: error.message }; }
            };
            window.ready = true;
          </script></body></html>`);
      });
    },
  }] });
  await server.listen();
  page = await browser.newPage();
  page.on('pageerror', (error) => console.error(error.message));
  await page.goto(`http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}/__raw-hvy.html`);
  await page.waitForFunction(() => (window as any).ready);
}, 60000);
afterAll(async () => {
  await browser?.close();
  await server?.close();
});

const source = `---
title: Original
component_defs:
  - name: Card
    baseType: container
    schema:
      containerBlocks:
        - text: Nested content
          schema:
            component: text
section_defs:
  - name: Profile
    template:
      title: Profile heading
      blocks:
        - text: Section content
          schema:
            component: text
      children: []
---
# Body
`;

it('keeps both definitions and nested structure after a valid source edit and save', async () => {
  await page.evaluate((source) => (window as any).openSource(source), source);
  const input = page.locator('textarea.raw-hvy-textarea');
  const text = await input.inputValue();
  await input.fill(text.replace('title: Original', 'title: Edited'));
  const saved = await page.evaluate(() => (window as any).saveSource());
  expect(saved.error).toBeUndefined();
  expect(saved.text).toContain('name: Card');
  expect(saved.text).toContain('containerBlocks:');
  expect(saved.text).toContain('Nested content');
  expect(saved.text).toContain('name: Profile');
  expect(saved.text).toContain('Section content');
});

it('does not replace template definitions with a partial parse when the header has invalid YAML', async () => {
  await page.evaluate((source) => (window as any).openSource(source), source);
  const input = page.locator('textarea.raw-hvy-textarea');
  const text = await input.inputValue();
  const invalid = text.replace('title: Original', 'title: [unfinished');
  await input.fill(invalid);
  const saved = await page.evaluate(() => (window as any).saveSource());
  expect(saved.error).toContain('Invalid YAML front matter');
  expect(saved.text).toBeUndefined();
  expect(await input.inputValue()).toBe(invalid);
  expect(await page.evaluate(() => (window as any).mounted.document.meta.component_defs.length)).toBe(1);
  await input.fill(text.replace('title: Original', 'title: Corrected'));
  const corrected = await page.evaluate(() => (window as any).saveSource());
  expect(corrected.error).toBeUndefined();
  expect(corrected.text).toContain('Nested content');
  expect(corrected.text).toContain('Section content');
});
