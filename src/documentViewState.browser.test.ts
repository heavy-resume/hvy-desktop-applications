import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';

declare global {
  interface Window {
    __documentViewState: typeof import('./documentViewState');
  }
}

describe('document view state', () => {
  let browser: Browser;
  let page: Page;
  let viteServer: ViteDevServer;
  let viteUrl: string;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    viteServer = await createServer({
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0 },
      plugins: [{
        name: 'document-view-state-test-page',
        configureServer(server) {
          server.middlewares.use('/__document-view-state-test.html', (_request, response) => {
            response.statusCode = 200;
            response.setHeader('Content-Type', 'text/html');
            response.end(`<!doctype html><html><body><main id="root"></main><button id="other-tab">Other document</button>
              <script type="module">
                import * as documentViewState from '/src/documentViewState.ts';
                window.__documentViewState = documentViewState;
              </script>
            </body></html>`);
          });
        },
      }],
    });
    await viteServer.listen();
    const address = viteServer.httpServer?.address() as AddressInfo;
    viteUrl = `http://127.0.0.1:${address.port}`;
    page = await browser.newPage();
  });

  afterAll(async () => {
    await page.close();
    await viteServer.close();
    await browser.close();
  });

  it('restores the focused table cell and caret after the document remounts', async () => {
    await page.goto(`${viteUrl}/__document-view-state-test.html`);
    await page.waitForFunction(() => Boolean(window.__documentViewState));

    const restored = await page.evaluate(async () => {
      const { captureDocumentViewState, restoreDocumentViewState } = window.__documentViewState;
      const root = document.querySelector<HTMLElement>('#root')!;
      const tableCell = `
        <div contenteditable="true"
          data-field="table-cell"
          data-section-key="summary"
          data-block-id="experience-table"
          data-row-index="2"
          data-cell-index="1">Galaxy engineer</div>`;
      root.innerHTML = tableCell;
      const cell = root.querySelector<HTMLElement>('[data-field="table-cell"]')!;
      cell.focus();
      const selection = window.getSelection()!;
      selection.setBaseAndExtent(cell.firstChild!, 7, cell.firstChild!, 7);
      document.querySelector<HTMLButtonElement>('#other-tab')!.focus();

      const state = captureDocumentViewState(root);
      root.innerHTML = tableCell;
      await restoreDocumentViewState(root, state);

      const active = document.activeElement as HTMLElement;
      return {
        field: active.dataset.field,
        rowIndex: active.dataset.rowIndex,
        cellIndex: active.dataset.cellIndex,
        caretOffset: window.getSelection()?.anchorOffset,
      };
    });

    expect(restored).toEqual({
      field: 'table-cell',
      rowIndex: '2',
      cellIndex: '1',
      caretOffset: 7,
    });
  });

  it('restores selection in an unrelated text control without component-specific logic', async () => {
    await page.goto(`${viteUrl}/__document-view-state-test.html`);
    await page.waitForFunction(() => Boolean(window.__documentViewState));

    const restored = await page.evaluate(async () => {
      const { captureDocumentViewState, restoreDocumentViewState } = window.__documentViewState;
      const root = document.querySelector<HTMLElement>('#root')!;
      const control = '<textarea name="notes">Generic selection</textarea>';
      root.innerHTML = `<section><div>${control}</div></section>`;
      const textarea = root.querySelector<HTMLTextAreaElement>('textarea')!;
      textarea.focus();
      textarea.setSelectionRange(2, 9, 'backward');

      const state = captureDocumentViewState(root);
      root.innerHTML = `<aside></aside><section><div>${control}</div></section>`;
      await restoreDocumentViewState(root, state);

      const active = document.activeElement as HTMLTextAreaElement;
      return {
        name: active.name,
        start: active.selectionStart,
        end: active.selectionEnd,
        direction: active.selectionDirection,
      };
    });

    expect(restored).toEqual({
      name: 'notes',
      start: 2,
      end: 9,
      direction: 'backward',
    });
  });
});
