import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';

let browser: Browser;
let page: Page;
let server: ViteDevServer;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0 }, plugins: [{
    name: 'text-cleanup-test',
    configureServer(vite) {
      vite.middlewares.use('/__text-cleanup.html', (_request, response) => {
        response.setHeader('Content-Type', 'text/html');
        response.end(`<!doctype html><html><body><main id="root"></main>
          <script type="module">
            import '/src/styles.css';
            import { mountHvyDocument } from '/src/hvy.ts';
            import { installAiChatClient } from '/src/aiClient.ts';
            import { state } from '/src/state.ts';
            import { createBlankDocument, createEmptySection, createEmptyBlock } from '/@fs/${resolve('../heavy-file-format/src/document-factory.ts')}';
            state.aiSettings.providers.push({ provider: 'openai-compatible', baseUrl: 'https://cleanup.test/v1', apiKey: 'test-key' });
            state.aiSettings.actions.edit = { providerId: 'openai-compatible', model: 'cleanup-model', modelsByProvider: {} };
            installAiChatClient(state.aiSettings);
            const doc = createBlankDocument();
            const section = createEmptySection();
            const block = createEmptyBlock('text');
            block.text = 'I hav a meting tomorow.';
            section.blocks = [block];
            doc.sections = [section];
            window.mounted = await mountHvyDocument(document.querySelector('#root'), doc, 'editor');
            window.ready = true;
          </script></body></html>`);
      });
    },
  }] });
  await server.listen();
  page = await browser.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(`http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}/__text-cleanup.html`);
  await page.waitForFunction(() => (window as any).ready);
}, 60000);
afterAll(async () => {
  await browser?.close();
  await server?.close();
});

it('uses the desktop Edit model to clean text and supports undo', async () => {
  let requestBody: any;
  await page.route('https://cleanup.test/v1/chat/completions', async (route) => {
    requestBody = route.request().postDataJSON();
    await route.fulfill({ json: { choices: [{ message: { content: 'I have a meeting tomorrow.' } }] } });
  });
  await page.getByText('I hav a meting tomorow.', { exact: true }).first().dblclick();
  await page.getByRole('button', { name: 'Process with AI', exact: true }).first().click();
  expect(await page.getByRole('button', { name: 'Clean Up', exact: true }).isEnabled()).toBe(true);
  await page.getByRole('button', { name: 'Clean Up', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-text-ai-modal]'));
  expect(requestBody.model).toBe('cleanup-model');
  expect(JSON.stringify(requestBody.messages)).toContain('I hav a meting tomorow.');
  expect(await page.locator('[data-field="block-rich"]').first().innerText()).toBe('I have a meeting tomorrow.');
  expect(await page.evaluate(() => (window as any).mounted.mount.isDirty())).toBe(true);
  await page.evaluate(() => (window as any).mounted.mount.undo());
  expect(await page.locator('[data-field="block-rich"]').first().innerText()).toBe('I hav a meting tomorow.');
}, 30000);
