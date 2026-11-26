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
    name: 'screen-cover-test',
    configureServer(vite) {
      vite.middlewares.use('/__screen-cover.html', (_request, response) => {
        response.setHeader('Content-Type', 'text/html');
        response.end(`<!doctype html><html><head><link rel="stylesheet" href="/src/styles/dialogs.css"></head><body style="margin:0;background:rgb(1, 2, 3)">
          <div id="app" style="height:100%">
            <div class="list" style="height:100px;overflow:auto"><div style="height:1000px">rows</div></div>
            <input class="name">
            <canvas class="chart" width="10" height="10"></canvas>
            <button class="button">Press</button>
          </div>
          <script type="module">
            import { behindScreenCover } from '/src/ui/screenCover.ts';
            window.behindScreenCover = behindScreenCover;
            window.ready = true;
          </script></body></html>`);
      });
    },
  }] });
  await server.listen();
  page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}/__screen-cover.html`);
  await page.waitForFunction(() => (window as any).ready);
}, 60000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

it('shows the window as it was, scrolled, typed into, and drawn, over whatever Galaxy does under it, until it is back', async () => {
  await page.locator('#app .list').evaluate((list) => { list.scrollTop = 300; });
  await page.locator('#app .name').fill('typed');
  await page.locator('#app .chart').evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'rgb(255, 0, 0)';
    context.fillRect(0, 0, 10, 10);
  });
  const during = await page.evaluate(async () => {
    let pressed = 0;
    document.querySelector('#app .button')!.addEventListener('click', () => { pressed += 1; });
    let seen: Record<string, unknown> = {};
    await (window as any).behindScreenCover(async () => {
      // Galaxy switching tabs under it: the real window's content changes.
      document.querySelector<HTMLElement>('#app .list')!.textContent = 'another tab';
      const cover = document.querySelector<HTMLElement>('.screen-cover')!;
      const box = document.querySelector('#app .button')!.getBoundingClientRect();
      document.elementFromPoint(box.x + 2, box.y + 2)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      seen = {
        covers: document.elementFromPoint(box.x + 2, box.y + 2)?.closest('.screen-cover') === cover,
        realAppFound: !document.getElementById('app')!.closest('.screen-cover'),
        background: cover.style.backgroundColor,
        scrolled: cover.querySelector<HTMLElement>('.list')!.scrollTop,
        list: cover.querySelector('.list')!.textContent,
        typed: cover.querySelector<HTMLInputElement>('.name')!.value,
        drawn: [...cover.querySelector<HTMLCanvasElement>('.chart')!.getContext('2d')!.getImageData(5, 5, 1, 1).data],
      };
    });
    const leftAfterwards = Boolean(document.querySelector('.screen-cover'));
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    return { ...seen, pressed, leftAfterwards, goneAfterFrame: !document.querySelector('.screen-cover') };
  });
  expect(during).toEqual({
    covers: true,
    realAppFound: true,
    background: 'rgb(1, 2, 3)',
    scrolled: 300,
    list: 'rows',
    typed: 'typed',
    drawn: [255, 0, 0, 255],
    pressed: 0,
    leftAfterwards: true,
    goneAfterFrame: true,
  });
});
