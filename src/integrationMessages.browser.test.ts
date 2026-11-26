import fs from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// The inspector as a host puts it in the page, with the browser's message token.
const TOKEN = 'browser-message-token';
const inspectorSource = fs.readFileSync(new URL('./integration-inspector.js', import.meta.url), 'utf8').replace('__HVY_GALAXY_MESSAGE_TOKEN__', TOKEN);
let browser: Browser;
let page: Page;

declare global {
  interface Window {
    seen: string[];
  }
}

// What a script records of where the page it runs in navigates: the Navigation API's `navigate` event, the nearest a
// script comes to a navigation's address.
const WATCH_NAVIGATIONS = `window.seen = []; navigation.addEventListener('navigate', (event) => seen.push(event.destination.url));`;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
});

beforeEach(async () => {
  page = await browser.newPage();
  await page.route('https://jobs.test/**', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><h1>Jobs</h1><iframe src="https://ads.test/frame"></iframe><script>${WATCH_NAVIGATIONS}</script>` }));
  await page.route('https://ads.test/**', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><p>Ad</p><script>${WATCH_NAVIGATIONS}
    // Whatever the frame can reach of the page above it.
    window.reached = [];
    for (const read of [() => top.__hvyGalaxyInspector, () => top.navigation, () => top.document.documentElement.outerHTML]) {
      try { reached.push(String(read())); } catch (error) { reached.push(error.name); }
    }
  </script>` }));
  await page.goto('https://jobs.test/');
  await page.addScriptTag({ content: inspectorSource });
  // A message, as every page load sends one: the scan for structured sources.
  await page.evaluate(() => (window as unknown as { __hvyGalaxyInspector: { discoverStructuredSourcesAndPublish(context: unknown): void } }).__hvyGalaxyInspector.discoverStructuredSourcesAndPublish({ automatic: true }));
  await page.waitForFunction(() => window.seen.length > 0);
});

describe('messages to Galaxy, as the site sees them', () => {
  it('keeps the message token from a frame the page embeds, which hosts take messages only with', async () => {
    const frame = page.frames().find((candidate) => candidate.url().startsWith('https://ads.test/'))!;
    expect(await frame.evaluate(() => window.seen.join(' '))).not.toContain(TOKEN);
    expect(await frame.evaluate(() => (window as unknown as { reached: string[] }).reached)).toEqual(['SecurityError', 'SecurityError', 'SecurityError']);
  });

  it("shows the page's own scripts the token, so what the host reports never comes from the page (integration-browser-event)", async () => {
    expect(await page.evaluate(() => window.seen)).toEqual([expect.stringMatching(new RegExp(`^hvy-integration://inspection/[\\w-]+\\?t=${TOKEN}$`))]);
  });
});
