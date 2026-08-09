import fs from 'node:fs';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer, normalizePath, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const inspectorSource = fs.readFileSync(new URL('./integration-inspector.js', import.meta.url), 'utf8');
const integrationToolbarSource = fs.readFileSync(new URL('../public/integration-browser-toolbar.html', import.meta.url), 'utf8');
const guideSource = fs.readFileSync(new URL('../src-tauri/resources/hvy-guide.hvy', import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
const hvyReferenceRoot = dirname(require.resolve('heavy-file-format-ref-impl/package.json'));
const hvyEmbedModuleUrl = `/@fs/${normalizePath(resolve(hvyReferenceRoot, 'src/embed-full.ts')).replace(/^\/+/, '')}`;
const resumeSource = fs.readFileSync(resolve(hvyReferenceRoot, 'examples/resume.hvy'), 'utf8');
const guideTitles = ['Text', 'Image', 'Carousel', 'Table', 'Reference', 'Container', 'List', 'Grid', 'Expandable', 'Plugin', 'Custom'];
const projectSkills = ['Reverse Engineering', 'Library Development', 'LLM Prompt Engineering', 'Project Management'];

async function movePointerTo(page: Page, selector: string): Promise<void> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`Element is not visible: ${selector}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

async function clickPointerAt(page: Page, selector: string): Promise<void> {
  await movePointerTo(page, selector);
  await page.mouse.down();
  await page.mouse.up();
}

interface InspectorSnapshot {
  selected: {
    directText: string;
    descendantText: string;
    shape: {
      tag: string;
      childTags: Record<string, number>;
      descendantTags: Record<string, number>;
      semanticIdentity: string[];
      semanticLineage: string[];
      visual: {
        fontWeight: number;
        truncated: boolean;
        widthRatio: number;
        viewportWidthRatio: number;
        viewportHeightRatio: number;
        viewportXRatio: number;
        viewportYRatio: number;
      };
    };
    relativePath: Array<{ tag: string }> | null;
  };
}

interface InspectorApi {
  discoverStructuredSources(): Array<{ kind: 'rss' | 'atom' | 'json-feed' | 'json-api'; url: string; title: string; authenticated: boolean; discoveredBy: 'link' | 'network' }>;
  fetchStructuredSource(source: { kind: 'rss' | 'atom' | 'json-feed' | 'json-api'; url: string }): Promise<{ value: unknown }>;
  start(kind: 'parent' | 'target', options?: {
    primary?: boolean;
    parentCssPath?: string;
    parentSnapshot?: InspectorSnapshot;
    existingPattern?: Parameters<InspectorApi['extractPattern']>[0];
    multiSelect?: boolean;
  }): void;
  snapshotElement(element: Element, parent?: Element | null, kind?: 'parent' | 'target'): InspectorSnapshot;
  suggestTargets(element: Element, pattern: Parameters<InspectorApi['extractPattern']>[0]): Array<{ label: string; score: number; snapshot: InspectorSnapshot | null }>;
  matchAndHighlight(pattern: { parents: InspectorSnapshot[]; targets: Array<{ label: string; optional?: boolean; snapshot: InspectorSnapshot; snapshots?: InspectorSnapshot[]; negativeSnapshots?: InspectorSnapshot[] }>; minimumConfidence?: number }): {
    matches: number;
    details: Array<{ parent: string; score: number; parentScore: number; relationshipScore: number; targets: Array<{ label: string; score: number }> }>;
    diagnostics?: unknown;
  };
  extractPattern(pattern: { parents: InspectorSnapshot[]; targets: Array<{ label: string; cardinality?: 'single' | 'list'; optional?: boolean; snapshot: InspectorSnapshot; snapshots?: InspectorSnapshot[]; negativeSnapshots?: InspectorSnapshot[] }>; minimumConfidence?: number }): {
    matches: number;
    records: Array<{
      parent: string;
      score: number;
      targets: Array<{ label: string; element: string; score: number; value: unknown }>;
    }>;
  };
  extractAcrossPage(pattern: Parameters<InspectorApi['extractPattern']>[0]): Promise<ReturnType<InspectorApi['extractPattern']> & { minimumConfidence: number }>;
  extractLiveExamples(pattern: Parameters<InspectorApi['extractPattern']>[0] & { targets: Array<{ label: string; snapshot: InspectorSnapshot; exampleSnapshots: Array<InspectorSnapshot | null> }> }): Promise<{ matches: number; records: Array<ReturnType<InspectorApi['extractPattern']>['records'][number] | null> }>;
  selectBestRecords(records: ReturnType<InspectorApi['extractPattern']>['records']): ReturnType<InspectorApi['extractPattern']>;
  executeCommand(payload: { pattern: Parameters<InspectorApi['extractPattern']>[0]; command: { id: string; scope: 'page' | 'record'; steps: Array<{ gesture: 'click' | 'double-click' | 'right-click' | 'type'; target: InspectorSnapshot; text?: string }> }; recordParent?: string }): { status: string; reason?: string; record?: string; target?: string; score?: number };
}

declare global {
  interface Window {
    __hvyGalaxyInspector: InspectorApi;
    hvySetBrowserState(value: { url: string; allowed: string[] }): void;
    __guideTitlePattern?: Parameters<InspectorApi['extractPattern']>[0];
  }
}

const fauxInbox = `
  <style>
    .inbox { width: 700px; }
    .mail-row, .promotion { display: grid; grid-template-columns: 140px 1fr; width: 680px; min-height: 72px; padding: 8px; }
    .content { display: grid; }
  </style>
  <main class="inbox">
    <article class="mail-row" data-record="first">
      <span class="sender">Ada</span>
      <div class="content"><a class="subject">Project update</a><span class="preview">The build is ready.</span></div>
    </article>
    <article class="mail-row" data-record="second">
      <span class="sender">Grace</span>
      <div class="content"><a class="subject">Dinner plans</a><span class="preview">How does Friday sound?</span></div>
    </article>
    <article class="mail-row" data-record="missing-preview">
      <span class="sender">Linus</span>
      <div class="content"><a class="subject">Kernel notes</a></div>
    </article>
    <aside class="promotion"><a class="subject">Sponsored offer</a><button>Buy now</button></aside>
  </main>`;

const changingInbox = `
  <style>
    .inbox { width: 700px; }
    .mail-row, .promotion { display: grid; grid-template-columns: 140px 1fr; width: 680px; min-height: 72px; padding: 8px; }
    .content { display: grid; }
    .subject { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; }
    .style-variant .subject { font-size: 15px; font-weight: 600; }
    .style-variant .preview { font-size: 13px; }
  </style>
  <main class="inbox">
    <article class="mail-row" data-record="reference">
      <span class="sender">Ada</span>
      <div class="content"><a class="subject">Project update</a><span class="preview">The build is ready.</span></div>
    </article>
    <section class="mail-row" data-record="changed-tags">
      <span class="sender">Grace</span>
      <section class="content"><a class="subject">Dinner plans</a><span class="preview">How does Friday sound?</span></section>
    </section>
    <article class="mail-row" data-record="inserted-wrapper">
      <span class="sender">Margaret</span>
      <div class="content"><div class="new-wrapper"><a class="subject">Compiler results</a><span class="preview">The suite is green.</span></div></div>
    </article>
    <article class="mail-row" data-record="changed-parent">
      <header><span class="sender">Donald</span></header>
      <div class="content"><a class="subject">System design</a><span class="preview">Review the new draft.</span></div>
    </article>
    <article class="mail-row style-variant" data-record="changed-style">
      <span class="sender">Barbara</span>
      <div class="content"><a class="subject">Release notes</a><span class="preview">A redesigned message row.</span></div>
    </article>
    <article class="mail-row" data-record="missing-preview">
      <span class="sender">Linus</span>
      <div class="content"><a class="subject">Kernel notes</a></div>
    </article>
    <aside class="promotion"><a class="subject">Sponsored offer</a><button>Buy now</button></aside>
  </main>`;

describe('integration structural inspector', () => {
  let browser: Browser;
  let page: Page;
  let pageErrors: string[];
  let viteServer: ViteDevServer;
  let viteUrl: string;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    viteServer = await createServer({
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0 },
      plugins: [{
        name: 'guide-vector-test-page',
        configureServer(server) {
          server.middlewares.use('/__guide-vector-test.html', (_request, response) => {
            response.statusCode = 200;
            response.setHeader('Content-Type', 'text/html');
            response.end('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><div id="guide-root" style="height:100vh"></div></body></html>');
          });
        },
      }],
    });
    await viteServer.listen();
    const address = viteServer.httpServer?.address() as AddressInfo;
    viteUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await viteServer.close();
    await browser.close();
  });

  beforeEach(async () => {
    page = await browser.newPage();
    pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.setContent(fauxInbox);
    await page.addScriptTag({ content: inspectorSource });
  });

  it('highlights on hover and completes a parent choice without an exception', async () => {
    await page.evaluate(() => window.__hvyGalaxyInspector.start('parent', { primary: true }));
    await movePointerTo(page, '[data-record="first"] .subject');

    expect(await page.locator('[data-inspector-status-text]').textContent()).toBe('Galaxy: select a parent');
    expect(await page.locator('#hvy-galaxy-inspector-highlight').count()).toBe(1);

    await clickPointerAt(page, '[data-record="first"] .subject');
    expect(await page.locator('#hvy-galaxy-inspector-picker').textContent()).toContain('Choose the parent containing one complete item');
    await page.locator('#hvy-galaxy-inspector-picker button').filter({ hasText: 'article' }).click();

    expect(await page.locator('#hvy-galaxy-inspector-picker').count()).toBe(0);
    expect(pageErrors).toEqual([]);
  });

  it('discovers advertised feeds without reading page content', async () => {
    await page.setContent('<link rel="alternate" type="application/rss+xml" title="Updates" href="https://example.com/feed.xml"><link rel="alternate" type="application/feed+json" href="https://example.com/feed.json">');
    await page.addScriptTag({ content: inspectorSource });

    expect(await page.evaluate(() => window.__hvyGalaxyInspector.discoverStructuredSources())).toEqual([
      { kind: 'rss', url: 'https://example.com/feed.xml', title: 'Updates', authenticated: false, discoveredBy: 'link' },
      { kind: 'json-feed', url: 'https://example.com/feed.json', title: 'JSON-FEED feed', authenticated: false, discoveredBy: 'link' },
    ]);
  });

  it('renders browser security state in the local toolbar document', async () => {
    await page.setContent(integrationToolbarSource);
    await page.evaluate(() => window.hvySetBrowserState({
      url: 'https://mail.google.com/mail/u/0/',
      allowed: ['https://mail.google.com'],
    }));

    expect(await page.locator('.host').textContent()).toBe('mail.google.com');
    expect(await page.locator('.url').inputValue()).toBe('https://mail.google.com/mail/u/0/');
    expect(await page.locator('.security').getAttribute('data-secure')).toBe('true');
    expect(await page.locator('.security').getAttribute('data-allowed')).toBe('true');
  });

  it('discovers and retrieves a same-origin JSON endpoint with the page session boundary', async () => {
    await page.route('**/integration-items.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [{ id: 1, title: 'Planning session' }] }) }));
    await page.goto(viteUrl);
    await page.addScriptTag({ content: inspectorSource });
    await page.evaluate(() => fetch('/integration-items.json').then((response) => response.json()));
    const source = await page.evaluate(() => window.__hvyGalaxyInspector.discoverStructuredSources().find((candidate) => candidate.url.endsWith('/integration-items.json'))!);
    const result = await page.evaluate((value) => window.__hvyGalaxyInspector.fetchStructuredSource(value), source);

    expect(source.kind).toBe('json-api');
    expect(source.authenticated).toBe(true);
    expect(result.value).toEqual({ items: [{ id: 1, title: 'Planning session' }] });
  });

  it('restarts parent highlighting when another record example is requested', async () => {
    await page.evaluate(() => window.__hvyGalaxyInspector.start('parent', { primary: true }));
    await clickPointerAt(page, '[data-record="first"] .subject');
    await page.locator('#hvy-galaxy-inspector-picker button').filter({ hasText: 'article' }).click();

    await page.evaluate(() => window.__hvyGalaxyInspector.start('parent'));
    await movePointerTo(page, '[data-record="second"] .subject');
    expect(await page.locator('[data-inspector-status-text]').textContent()).toBe('Galaxy: select a parent');
    expect(await page.locator('#hvy-galaxy-inspector-highlight').count()).toBe(1);
    await clickPointerAt(page, '[data-record="second"] .subject');
    expect(await page.locator('#hvy-galaxy-inspector-picker').textContent()).toContain('Choose the parent containing one complete item');
    expect(pageErrors).toEqual([]);
  });

  it('recovers the primary parent structurally when the page replaces its DOM node', async () => {
    const parentSnapshot = await page.evaluate(() => {
      const parent = document.querySelector('[data-record="first"]')!;
      return window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent');
    });
    await page.evaluate(() => {
      const original = document.querySelector('[data-record="first"]')!;
      const replacement = original.cloneNode(true);
      const wrapper = document.createElement('section');
      wrapper.className = 'virtualized-row-shell';
      wrapper.append(replacement);
      original.replaceWith(wrapper);
      document.querySelectorAll('[data-record]:not([data-record="first"])').forEach((element) => element.remove());
    });
    await page.evaluate((snapshot) => window.__hvyGalaxyInspector.start('target', { parentCssPath: '#no-longer-present', parentSnapshot: snapshot }), parentSnapshot);
    await movePointerTo(page, '[data-record="first"] .subject');

    expect(await page.locator('[data-inspector-status-text]').textContent()).toBe('Galaxy: select target data');
    expect(await page.locator('#hvy-galaxy-inspector-highlight').count()).toBe(1);
    await clickPointerAt(page, '[data-record="first"] .subject');
    expect(await page.locator('#hvy-galaxy-inspector-picker').textContent()).toContain('Choose data inside the selected parent');
    expect(pageErrors).toEqual([]);
  });

  it('treats the host of a rendered pseudo-element as a selectable target', async () => {
    await page.setContent(`
      <style>.marker::before { content: "Calendar marker"; display:block; width:80px; height:18px; background:#4682b4; }</style>
      <button class="event"><span>Event title</span><div class="marker"></div></button>
    `);
    await page.addScriptTag({ content: inspectorSource });
    const parentSnapshot = await page.evaluate(() => window.__hvyGalaxyInspector.snapshotElement(document.querySelector('.event')!, null, 'parent'));
    await page.evaluate((snapshot) => window.__hvyGalaxyInspector.start('target', { parentSnapshot: snapshot }), parentSnapshot);
    await movePointerTo(page, '.marker');

    expect(await page.locator('#hvy-galaxy-inspector-highlight').textContent()).toContain('div');
    await clickPointerAt(page, '.marker');
    expect(await page.locator('#hvy-galaxy-inspector-picker button').filter({ hasText: 'Calendar marker' }).count()).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
  });

  it('matches target ancestry through a shadow root and its composed parent', async () => {
    await page.setContent('<div class="event-host"></div>');
    await page.evaluate(() => {
      const host = document.querySelector('.event-host')!;
      host.attachShadow({ mode: 'open' }).innerHTML = '<div><span class="title">Planning session</span></div>';
    });
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(() => {
      const parent = document.querySelector('.event-host')!;
      const title = parent.shadowRoot!.querySelector('.title')!;
      const target = window.__hvyGalaxyInspector.snapshotElement(title, parent, 'target');
      return {
        path: target.selected.relativePath,
        match: window.__hvyGalaxyInspector.matchAndHighlight({
          minimumConfidence: 0.95,
          parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
          targets: [{ label: 'TITLE', snapshot: target }],
        }),
      };
    });

    expect(result.path?.map((node) => node.tag)).toEqual(['span', 'div']);
    expect(result.match.matches, JSON.stringify(result.match, null, 2)).toBe(1);
    expect(result.match.details[0].targets[0].score).toBeCloseTo(1);
    expect(pageErrors).toEqual([]);
  });

  it('matches visually rendered fields inside an aria-hidden subtree', async () => {
    await page.setContent('<button class="event"><div aria-hidden="true"><span class="title">Planning session</span></div></button>');
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(() => {
      const parent = document.querySelector('.event')!;
      const title = parent.querySelector('.title')!;
      return window.__hvyGalaxyInspector.matchAndHighlight({
        minimumConfidence: 0.95,
        parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
        targets: [{ label: 'TITLE', snapshot: window.__hvyGalaxyInspector.snapshotElement(title, parent, 'target') }],
      });
    });

    expect(result.matches, JSON.stringify(result, null, 2)).toBe(1);
    expect(result.details[0].targets[0].score).toBeCloseTo(1);
    expect(pageErrors).toEqual([]);
  });

  it('suppresses page hover actions and boxes the selected parent while choosing a target', async () => {
    await page.setContent(`
      <style>
        .message { position: relative; width: 500px; padding: 20px; }
        .actions { display: none; position: absolute; inset: 0 0 auto auto; }
        .message:hover .actions { display: flex; }
      </style>
      <article class="message"><span class="time">10:42 AM</span><div class="actions"><button>Archive</button><button>Delete</button></div></article>
    `);
    await page.addScriptTag({ content: inspectorSource });
    await movePointerTo(page, '.time');
    expect(await page.locator('.actions').evaluate((element) => getComputedStyle(element).display)).toBe('flex');
    await page.mouse.move(700, 500);

    const parentSnapshot = await page.evaluate(() => {
      const parent = document.querySelector('.message')!;
      return window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent');
    });
    await page.evaluate((snapshot) => window.__hvyGalaxyInspector.start('target', { parentCssPath: '.message', parentSnapshot: snapshot }), parentSnapshot);
    await movePointerTo(page, '.time');

    expect(await page.locator('.actions').evaluate((element) => getComputedStyle(element).display)).toBe('none');
    expect(await page.locator('#hvy-galaxy-inspector-scope').textContent()).toBe('Selected parent');
    expect((await page.locator('#hvy-galaxy-inspector-scope').boundingBox())?.y).toBeCloseTo((await page.locator('.message').boundingBox())!.y, 0);
    expect(await page.locator('#hvy-galaxy-inspector-highlight').textContent()).toBe('span');

    await page.getByRole('button', { name: 'Navigate page' }).click();
    await page.locator('.time').hover();
    expect(await page.locator('.actions').evaluate((element) => getComputedStyle(element).display)).toBe('flex');
    await page.getByRole('button', { name: 'Resume picking' }).click();
    await movePointerTo(page, '.time');
    expect(await page.locator('.actions').evaluate((element) => getComputedStyle(element).display)).toBe('none');
    expect(pageErrors).toEqual([]);
  });

  it('collects several target fields before returning to Galaxy', async () => {
    const parentSnapshot = await page.evaluate(() => {
      const parent = document.querySelector('[data-record="first"]')!;
      return window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent');
    });
    await page.evaluate((snapshot) => window.__hvyGalaxyInspector.start('target', {
      parentCssPath: '[data-record="first"]',
      parentSnapshot: snapshot,
      multiSelect: true,
    }), parentSnapshot);

    await movePointerTo(page, '[data-record="first"] .sender');
    expect(await page.locator('#hvy-galaxy-inspector-highlight').count()).toBe(1);
    expect(await page.locator('#hvy-galaxy-inspector-highlight').textContent()).toBe('Add field · span');
    await clickPointerAt(page, '[data-record="first"] .sender');
    await page.locator('#hvy-galaxy-inspector-picker button').filter({ hasText: 'span' }).first().click();
    expect(await page.locator('[data-inspector-status-text]').textContent()).toBe('Galaxy: 1 field selected');
    expect(await page.locator('[data-collection-selection="true"]').count()).toBe(1);

    await movePointerTo(page, '[data-record="first"] .subject');
    expect(await page.locator('#hvy-galaxy-inspector-highlight').textContent()).toBe('Add field · a');
    await clickPointerAt(page, '[data-record="first"] .subject');
    await page.locator('#hvy-galaxy-inspector-picker button').filter({ hasText: 'a — Project update' }).click();
    expect(await page.locator('[data-inspector-status-text]').textContent()).toBe('Galaxy: 2 fields selected');
    expect(await page.locator('[data-collection-selection="true"]').count()).toBe(2);

    await page.getByRole('button', { name: 'Undo last' }).click();
    expect(await page.locator('[data-inspector-status-text]').textContent()).toBe('Galaxy: 1 field selected');
    expect(await page.locator('[data-collection-selection="true"]').count()).toBe(1);
    expect(await page.getByRole('button', { name: 'Done' }).isEnabled()).toBe(true);
    expect(pageErrors).toEqual([]);
  });

  it('relays wheel scrolling to the page beneath the inspection shield', async () => {
    await page.setContent('<main class="scroll-box" style="height:100px;overflow:auto"><div style="height:800px"><span>Top</span></div></main>');
    await page.addScriptTag({ content: inspectorSource });
    await page.evaluate(() => window.__hvyGalaxyInspector.start('parent', { primary: true }));
    const box = await page.locator('.scroll-box').boundingBox();
    await page.mouse.move(box!.x + 30, box!.y + 30);
    await page.mouse.wheel(0, 180);
    expect(await page.locator('.scroll-box').evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
  });

  it('extracts all visible nested text from the selected element', async () => {
    await page.setContent('<article class="event"><span class="date">Aug <span>3</span></span></article>');
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(() => {
      const parent = document.querySelector('.event')!;
      const date = parent.querySelector('.date')!;
      return window.__hvyGalaxyInspector.extractPattern({
        parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
        targets: [{ label: 'DATE', snapshot: window.__hvyGalaxyInspector.snapshotElement(date, parent, 'target') }],
      });
    });

    expect(result.records[0].targets[0].value).toBe('Aug 3');
    expect(pageErrors).toEqual([]);
  });

  it('assigns each saved example its best unused live record', async () => {
    await page.setContent(`
      <main>
        <article class="message-card"><span class="value">Alpha</span></article>
        <article class="message-card"><span class="value">Alpha decoy</span></article>
        <ul><li class="compact-row" role="listitem"><button class="value">Beta</button></li></ul>
        <ul><li class="compact-row" role="listitem"><button class="value">Beta decoy</button></li></ul>
      </main>
    `);
    await page.addScriptTag({ content: inspectorSource });
    const records = await page.evaluate(async () => {
      const firstParent = document.querySelector('.message-card')!;
      const secondParent = document.querySelector('.compact-row')!;
      const firstTarget = firstParent.querySelector('.value')!;
      const secondTarget = secondParent.querySelector('.value')!;
      const firstSnapshot = window.__hvyGalaxyInspector.snapshotElement(firstTarget, firstParent, 'target');
      const secondSnapshot = window.__hvyGalaxyInspector.snapshotElement(secondTarget, secondParent, 'target');
      return (await window.__hvyGalaxyInspector.extractLiveExamples({
        parents: [
          window.__hvyGalaxyInspector.snapshotElement(firstParent, null, 'parent'),
          window.__hvyGalaxyInspector.snapshotElement(secondParent, null, 'parent'),
        ],
        targets: [{ label: 'VALUE', snapshot: firstSnapshot, exampleSnapshots: [firstSnapshot, secondSnapshot] }],
      })).records;
    });

    expect(records.map((record) => record?.targets[0].value)).toEqual(['Alpha', 'Beta']);
    expect(new Set(records.map((record) => record?.parent)).size).toBe(2);
    expect(pageErrors).toEqual([]);
  });

  it('shows already-matched records while another parent example is selected', async () => {
    const pattern = await page.evaluate(() => {
      const parent = document.querySelector('[data-record="first"]')!;
      return {
        parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
        targets: [
          { label: 'SUBJECT', snapshot: window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('.subject')!, parent, 'target') },
          { label: 'PREVIEW', snapshot: window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('.preview')!, parent, 'target') },
        ],
      };
    });
    await page.evaluate((existingPattern) => window.__hvyGalaxyInspector.start('parent', { existingPattern }), pattern);

    expect(await page.locator('[data-existing-match-kind="parent"][data-existing-match-status="pass"]').count()).toBe(2);
    expect(await page.locator('[data-existing-match-kind="target"][data-existing-match-status="pass"]').count()).toBe(4);
    expect(await page.locator('[data-existing-match-kind="parent"][data-existing-match-status="fail"]').count()).toBeGreaterThan(0);
    expect(await page.locator('[data-existing-match-kind="target"][data-existing-match-status="fail"]').count()).toBe(0);
    expect(await page.locator('#hvy-galaxy-existing-matches').textContent()).toContain('Needs example');
    await movePointerTo(page, '[data-record="missing-preview"] .subject');
    expect(await page.locator('#hvy-galaxy-inspector-highlight').count()).toBe(1);
    expect(pageErrors).toEqual([]);
  });

  it('prepopulates existing field selections for a newly chosen parent example', async () => {
    const suggestions = await page.evaluate(() => {
      const primary = document.querySelector('[data-record="first"]')!;
      const next = document.querySelector('[data-record="second"]')!;
      return window.__hvyGalaxyInspector.suggestTargets(next, {
        parents: [window.__hvyGalaxyInspector.snapshotElement(primary, null, 'parent')],
        targets: [
          { label: 'SUBJECT', snapshot: window.__hvyGalaxyInspector.snapshotElement(primary.querySelector('.subject')!, primary, 'target') },
          { label: 'PREVIEW', snapshot: window.__hvyGalaxyInspector.snapshotElement(primary.querySelector('.preview')!, primary, 'target') },
        ],
      });
    });

    expect(suggestions.map((suggestion) => [suggestion.label, suggestion.snapshot?.selected.directText])).toEqual([
      ['SUBJECT', 'Dinner plans'],
      ['PREVIEW', 'How does Friday sound?'],
    ]);
    expect(suggestions.every((suggestion) => suggestion.snapshot?.selected.relativePath?.length)).toBe(true);
    expect(pageErrors).toEqual([]);
  });

  it('encodes target shape and its path relative to the selected parent without using sibling text', async () => {
    const snapshots = await page.evaluate(() => {
      const parent = document.querySelector('[data-record="first"]')!;
      const subject = parent.querySelector('.subject')!;
      return {
        parent: window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent'),
        subject: window.__hvyGalaxyInspector.snapshotElement(subject, parent, 'target'),
      };
    });

    expect(snapshots.parent.selected.shape.tag).toBe('article');
    expect(snapshots.parent.selected.directText).toBe('');
    expect(snapshots.parent.selected.descendantText).toBe('');
    expect(snapshots.subject.selected.relativePath?.map((node) => node.tag)).toEqual(['a', 'div']);
    expect(snapshots.subject.selected.shape.tag).toBe('a');
  });

  it('encodes normalized visual evidence without recording the text itself in the shape', async () => {
    await page.setContent(changingInbox);
    await page.addScriptTag({ content: inspectorSource });
    const subject = await page.evaluate(() => {
      const parent = document.querySelector('[data-record="reference"]')!;
      return window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('.subject')!, parent, 'target');
    });

    expect(subject.selected.shape.visual.fontWeight).toBe(700);
    expect(subject.selected.shape.visual.truncated).toBe(true);
    expect(subject.selected.shape.visual.widthRatio).toBeGreaterThan(0);
    expect(subject.selected.shape.visual.viewportWidthRatio).toBeGreaterThan(0);
    expect(subject.selected.shape.visual.viewportHeightRatio).toBeGreaterThan(0);
    expect(subject.selected.shape.visual.viewportXRatio).toBeGreaterThanOrEqual(0);
    expect(subject.selected.shape.visual.viewportYRatio).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(subject.selected.shape)).not.toContain('Project update');
  });

  it('encodes normalized container treatment such as borders, radius, background, and padding', async () => {
    await page.setContent('<main><span class="plain">Subject</span><span class="chip" style="display:inline-block;border:1px solid;padding:4px 10px;border-radius:12px;background:rgb(230,230,230)">report.pdf</span></main>');
    await page.addScriptTag({ content: inspectorSource });
    const visual = await page.evaluate(() => ({
      plain: window.__hvyGalaxyInspector.snapshotElement(document.querySelector('.plain')!, null, 'target').selected.shape.visual,
      chip: window.__hvyGalaxyInspector.snapshotElement(document.querySelector('.chip')!, null, 'target').selected.shape.visual,
    }));

    expect((visual.chip as typeof visual.chip & { bordered: boolean }).bordered).toBe(true);
    expect((visual.chip as typeof visual.chip & { borderRadiusRatio: number }).borderRadiusRatio).toBeGreaterThan(0);
    expect((visual.chip as typeof visual.chip & { paddingXRatio: number }).paddingXRatio).toBeGreaterThan(0);
    expect((visual.chip as typeof visual.chip & { hasBackground: boolean }).hasBackground).toBe(true);
    expect((visual.chip as typeof visual.chip & { backgroundColor: { lightness: number } }).backgroundColor.lightness).toBeGreaterThan(0.8);
    expect((visual.chip as typeof visual.chip & { borderColor: { alpha: number } }).borderColor.alpha).toBe(1);
    expect((visual.chip as typeof visual.chip & { textColor: { alpha: number } }).textColor.alpha).toBe(1);
    expect((visual.plain as typeof visual.plain & { bordered: boolean }).bordered).toBe(false);
    expect(pageErrors).toEqual([]);
  });

  it('scores a saved example against its unchanged live element as an exact match', async () => {
    await page.setContent('<article class="event"><span class="title">Planning session</span></article>');
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(() => {
      const parent = document.querySelector('.event')!;
      return window.__hvyGalaxyInspector.matchAndHighlight({
        minimumConfidence: 0.95,
        parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
        targets: [{ label: 'TITLE', snapshot: window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('.title')!, parent, 'target') }],
      });
    });

    expect(result.matches, JSON.stringify(result, null, 2)).toBe(1);
    expect(result.details[0].parentScore).toBeCloseTo(1);
    expect(result.details[0].targets[0].score).toBeCloseTo(1);
    expect(result.details[0].score).toBeCloseTo(1);
    expect(pageErrors).toEqual([]);
  });

  it('matches a button when the same element is both the record parent and selected field', async () => {
    await page.setContent('<main><button class="event" style="width:240px;background:rgb(80,120,200)">Planning session</button></main>');
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(() => {
      const button = document.querySelector('.event')!;
      return window.__hvyGalaxyInspector.matchAndHighlight({
        minimumConfidence: 0.95,
        parents: [window.__hvyGalaxyInspector.snapshotElement(button, null, 'parent')],
        targets: [{ label: 'TITLE', snapshot: window.__hvyGalaxyInspector.snapshotElement(button, button, 'target') }],
      });
    });

    expect(result.matches, JSON.stringify(result, null, 2)).toBe(1);
    expect(result.details[0].parentScore).toBeCloseTo(1);
    expect(result.details[0].targets[0].score).toBeCloseTo(1);
    expect(pageErrors).toEqual([]);
  });

  it('scores through changed container tags, inserted wrappers, and modest parent mutations', async () => {
    await page.setContent(changingInbox);
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(() => {
      const parent = document.querySelector('[data-record="reference"]')!;
      return window.__hvyGalaxyInspector.matchAndHighlight({
        parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
        targets: [
          { label: 'SUBJECT', snapshot: window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('.subject')!, parent, 'target') },
          { label: 'PREVIEW', snapshot: window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('.preview')!, parent, 'target') },
        ],
      });
    });

    expect(result.matches, JSON.stringify(result.details, null, 2)).toBe(5);
    expect(await page.locator('#hvy-galaxy-pattern-matches span', { hasText: 'SUBJECT' }).count()).toBe(5);
    expect(await page.locator('#hvy-galaxy-pattern-matches span', { hasText: 'PREVIEW' }).count()).toBe(5);
    expect(pageErrors).toEqual([]);
  });

  it('uses the action confidence threshold to admit or reject borderline structural variants', async () => {
    await page.setContent(changingInbox);
    await page.addScriptTag({ content: inspectorSource });
    const counts = await page.evaluate(() => {
      const parent = document.querySelector('[data-record="reference"]')!;
      const basePattern = {
        parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
        targets: [
          { label: 'SUBJECT', snapshot: window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('.subject')!, parent, 'target') },
          { label: 'PREVIEW', snapshot: window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('.preview')!, parent, 'target') },
        ],
      };
      return {
        strict: window.__hvyGalaxyInspector.extractPattern({ ...basePattern, minimumConfidence: 0.85 }).matches,
        tolerant: window.__hvyGalaxyInspector.extractPattern({ ...basePattern, minimumConfidence: 0.75 }).matches,
      };
    });

    expect(counts.strict).toBe(5);
    expect(counts.tolerant).toBeGreaterThan(counts.strict);
    expect(pageErrors).toEqual([]);
  });

  it('updates highlighted matches live from the in-page confidence slider', async () => {
    await page.setContent(changingInbox);
    await page.addScriptTag({ content: inspectorSource });
    await page.evaluate(() => {
      const parent = document.querySelector('[data-record="reference"]')!;
      window.__hvyGalaxyInspector.matchAndHighlight({
        minimumConfidence: 0.75,
        parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
        targets: [
          { label: 'SUBJECT', snapshot: window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('.subject')!, parent, 'target') },
          { label: 'PREVIEW', snapshot: window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('.preview')!, parent, 'target') },
        ],
      });
    });

    expect(await page.locator('[data-match-kind="parent"]').count()).toBe(6);
    expect(await page.getByRole('button', { name: 'Compare traits' }).isVisible()).toBe(true);
    expect(await page.getByRole('slider', { name: 'Minimum match confidence' }).getAttribute('min')).toBe('50');
    await page.getByRole('slider', { name: 'Minimum match confidence' }).evaluate((element) => {
      const input = element as HTMLInputElement;
      input.value = '85';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(await page.locator('[data-match-kind="parent"]').count()).toBe(5);
    expect(await page.locator('#hvy-galaxy-inspector-status output').textContent()).toBe('85%');
    const pageUrl = page.url();
    await page.getByRole('slider', { name: 'Minimum match confidence' }).dispatchEvent('change');
    expect(page.url()).toBe(pageUrl);
    expect(pageErrors).toEqual([]);
  });

  it('uses the live confidence threshold consistently when adding an example', async () => {
    await page.setContent(changingInbox);
    await page.addScriptTag({ content: inspectorSource });
    const pattern = await page.evaluate(() => {
      const parent = document.querySelector('[data-record="reference"]')!;
      const value = {
        minimumConfidence: 0.85,
        parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
        targets: [
          { label: 'SUBJECT', snapshot: window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('.subject')!, parent, 'target') },
          { label: 'PREVIEW', snapshot: window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('.preview')!, parent, 'target') },
        ],
      };
      window.__hvyGalaxyInspector.matchAndHighlight(value);
      return value;
    });
    await page.getByRole('slider', { name: 'Minimum match confidence' }).evaluate((element) => {
      const input = element as HTMLInputElement;
      input.value = '75';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(await page.locator('[data-match-kind="parent"]').count()).toBe(6);

    await page.evaluate((existingPattern) => window.__hvyGalaxyInspector.start('parent', { existingPattern }), pattern);

    expect(await page.locator('[data-existing-match-kind="parent"][data-existing-match-status="pass"]').count()).toBe(6);
    expect(pageErrors).toEqual([]);
  });

  it('restores parent hover picking after live match highlighting', async () => {
    const pattern = await page.evaluate(() => {
      const parent = document.querySelector('[data-record="first"]')!;
      return {
        parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
        targets: [{ label: 'SUBJECT', snapshot: window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('.subject')!, parent, 'target') }],
      };
    });
    await page.evaluate((value) => window.__hvyGalaxyInspector.matchAndHighlight(value), pattern);
    await page.evaluate((existingPattern) => window.__hvyGalaxyInspector.start('parent', { existingPattern }), pattern);
    await movePointerTo(page, '[data-record="second"] .subject');

    expect(await page.locator('#hvy-galaxy-pattern-matches').count()).toBe(0);
    expect(await page.locator('#hvy-galaxy-inspector-highlight').count()).toBe(1);
    expect(pageErrors).toEqual([]);
  });

  it('does not discard accepted records through a second confidence-cluster heuristic', async () => {
    const selected = await page.evaluate(() => {
      const parent = document.querySelector('[data-record="first"]')!;
      const base = window.__hvyGalaxyInspector.extractPattern({
        parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
        targets: [{ label: 'SUBJECT', snapshot: window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('.subject')!, parent, 'target') }],
      }).records[0];
      const accepted = Array.from({ length: 49 }, (_, index) => ({ ...base, parent: `record-${index}`, score: 0.99 - index * 0.002 }));
      return window.__hvyGalaxyInspector.selectBestRecords(accepted);
    });

    expect(selected.matches).toBe(49);
    expect(selected.records).toHaveLength(49);
  });

  it('matches repeated parent shapes and highlights each labeled target', async () => {
    const result = await page.evaluate(() => {
      const parent = document.querySelector('[data-record="first"]')!;
      const parentSnapshot = window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent');
      const target = (selector: string) => window.__hvyGalaxyInspector.snapshotElement(parent.querySelector(selector)!, parent, 'target');
      return window.__hvyGalaxyInspector.matchAndHighlight({
        parents: [parentSnapshot],
        targets: [
          { label: 'SUBJECT', snapshot: target('.subject') },
          { label: 'PREVIEW', snapshot: target('.preview') },
        ],
      });
    });

    expect(result.matches, JSON.stringify(result.details, null, 2)).toBe(2);
    expect(await page.locator('#hvy-galaxy-pattern-matches').textContent()).toContain('Match 1');
    expect(await page.locator('#hvy-galaxy-pattern-matches span', { hasText: 'SUBJECT' }).count()).toBe(2);
    expect(await page.locator('#hvy-galaxy-pattern-matches span', { hasText: 'PREVIEW' }).count()).toBe(2);
    expect(pageErrors).toEqual([]);
  });

  it('prefers the stronger record boundary over a broader ancestor with a stronger field candidate', async () => {
    await page.setContent(`
      <main><section class="outer">
        <article class="event"><span class="title" style="font-size:18px;font-weight:700;color:blue">Planning session</span></article>
        <span class="decoy" style="font-size:18px;font-weight:700;color:blue">Other text</span>
      </section></main>
    `);
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(() => {
      const parent = document.querySelector('.event')!;
      const target = parent.querySelector('.title')!;
      const pattern = {
        minimumConfidence: 0.5,
        parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
        targets: [{ label: 'TITLE', snapshot: window.__hvyGalaxyInspector.snapshotElement(target, parent, 'target') }],
      };
      target.setAttribute('style', 'font-size:11px;font-weight:400;color:red');
      return window.__hvyGalaxyInspector.matchAndHighlight(pattern);
    });

    expect(result.matches, JSON.stringify(result, null, 2)).toBe(1);
    expect(result.details[0].parent).toBe('html > body > main > section > article');
    expect(pageErrors).toEqual([]);
  });

  it('rejects a similar row when a required target does not fit', async () => {
    const result = await page.evaluate(() => {
      const parent = document.querySelector('[data-record="first"]')!;
      return window.__hvyGalaxyInspector.matchAndHighlight({
        parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
        targets: [
          { label: 'SUBJECT', snapshot: window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('.subject')!, parent, 'target') },
          { label: 'PREVIEW', snapshot: window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('.preview')!, parent, 'target') },
        ],
      });
    });

    expect(result.matches, JSON.stringify(result.details, null, 2)).toBe(2);
    const captions = await page.locator('#hvy-galaxy-pattern-matches span').allTextContents();
    expect(captions.filter((caption) => caption === 'PREVIEW')).toHaveLength(2);
    expect(captions).not.toContain('Sponsored offer');
  });

  it('returns grouped records with a list-valued target', async () => {
    await page.setContent(`
      <main>
        <article class="project"><h2>Desktop client</h2><div class="skills"><strong>TypeScript</strong><strong>Electron</strong></div></article>
        <article class="project"><h2>Web service</h2><div class="skills"><strong>Python</strong><strong>PostgreSQL</strong><strong>Redis</strong></div></article>
      </main>
    `);
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(() => {
      const parent = document.querySelector('.project')!;
      return window.__hvyGalaxyInspector.extractPattern({
        parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
        targets: [
          { label: 'TITLE', cardinality: 'single', snapshot: window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('h2')!, parent, 'target') },
          { label: 'SKILLS', cardinality: 'list', snapshot: window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('strong')!, parent, 'target') },
        ],
      });
    });

    expect(result.records.map((record) => Object.fromEntries(record.targets.map((target) => [target.label, target.value])))).toEqual([
      { TITLE: 'Desktop client', SKILLS: ['TypeScript', 'Electron'] },
      { TITLE: 'Web service', SKILLS: ['Python', 'PostgreSQL', 'Redis'] },
    ]);
  });

  it('learns an optional target from a later parent example without dropping records where it is absent', async () => {
    await page.setContent(`
      <main>
        <article class="message"><span class="sender">Ada</span><a class="subject">No files</a></article>
        <article class="message has-attachment"><span class="sender">Grace</span><a class="subject">Files attached</a><button class="attachment">report.pdf</button></article>
      </main>
    `);
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(() => {
      const parents = [...document.querySelectorAll('.message')];
      return window.__hvyGalaxyInspector.extractPattern({
        minimumConfidence: 0.8,
        parents: parents.map((parent) => window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')),
        targets: [
          { label: 'SUBJECT', snapshot: window.__hvyGalaxyInspector.snapshotElement(parents[0].querySelector('.subject')!, parents[0], 'target') },
          { label: 'ATTACHMENT', optional: true, snapshot: window.__hvyGalaxyInspector.snapshotElement(parents[1].querySelector('.attachment')!, parents[1], 'target') },
        ],
      });
    });

    const values = result.records.map((record) => Object.fromEntries(record.targets.map((target) => [target.label, target.value])));
    expect(Object.fromEntries(values.map((record) => [record.SUBJECT, record.ATTACHMENT]))).toEqual({
      'No files': null,
      'Files attached': 'report.pdf',
    });
    expect(pageErrors).toEqual([]);
  });

  it('does not accept a parent-only record when none of its optional fields match', async () => {
    await page.setContent('<main><article class="message"><span class="subject">Calendar event</span></article></main>');
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(() => {
      const parent = document.querySelector('.message')!;
      const parentSnapshot = window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent');
      const targetSnapshot = window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('.subject')!, parent, 'target');
      parent.querySelector('.subject')!.remove();
      return window.__hvyGalaxyInspector.matchAndHighlight({
        minimumConfidence: 0.5,
        parents: [parentSnapshot],
        targets: [{ label: 'SUBJECT', optional: true, snapshot: targetSnapshot }],
      });
    });

    expect(result.matches).toBe(0);
    await page.getByRole('button', { name: 'Compare traits' }).click();
    expect(await page.locator('#hvy-galaxy-inspector-status table').count()).toBe(2);
    expect(await page.locator('#hvy-galaxy-inspector-status').textContent()).toContain('Score components');
    await page.getByRole('button', { name: 'Show on page' }).first().click();
    expect(await page.locator('[data-match-kind="diagnostic-comparison"]').count()).toBeGreaterThan(0);
    expect(await page.locator('#hvy-galaxy-inspector-status').textContent()).toMatch(/same element|top live candidate/);
    expect(pageErrors).toEqual([]);
  });

  it('uses an explicit absent example as negative evidence for an optional field', async () => {
    await page.setContent(`
      <main>
        <article class="message"><span class="subject">Files attached</span><span class="attachment" style="border:1px solid;padding:3px 8px;border-radius:8px">report.pdf</span></article>
        <article class="message"><span class="subject">No attachment</span></article>
      </main>
    `);
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(() => {
      const parents = [...document.querySelectorAll('.message')];
      const attachment = window.__hvyGalaxyInspector.snapshotElement(parents[0].querySelector('.attachment')!, parents[0], 'target');
      const mistakenSubject = window.__hvyGalaxyInspector.snapshotElement(parents[1].querySelector('.subject')!, parents[1], 'target');
      return window.__hvyGalaxyInspector.extractPattern({
        minimumConfidence: 0.8,
        parents: parents.map((parent) => window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')),
        targets: [{ label: 'ATTACHMENT', optional: true, snapshot: attachment, negativeSnapshots: [mistakenSubject] }],
      });
    });

    expect(result.records.map((record) => record.targets[0].value).sort((left, right) => String(left).localeCompare(String(right)))).toEqual([null, 'report.pdf']);
    expect(pageErrors).toEqual([]);
  });

  it('allocates the best field matches first and prevents ancestor-descendant overlap', async () => {
    await page.setContent(`
      <main>
        <article class="event"><div class="title"><span>Planning session</span></div><div class="attachment" style="border:1px solid;padding:3px"><span>agenda.pdf</span></div></article>
        <article class="event"><div class="title"><span>Calendar event</span></div></article>
      </main>
    `);
    await page.addScriptTag({ content: inspectorSource });
    const records = await page.evaluate(() => {
      const parents = [...document.querySelectorAll('.event')];
      return window.__hvyGalaxyInspector.extractPattern({
        minimumConfidence: 0.8,
        parents: parents.map((parent) => window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')),
        targets: [
          { label: 'TITLE', snapshot: window.__hvyGalaxyInspector.snapshotElement(parents[0].querySelector('.title span')!, parents[0], 'target') },
          { label: 'ATTACHMENT', optional: true, snapshot: window.__hvyGalaxyInspector.snapshotElement(parents[0].querySelector('.attachment')!, parents[0], 'target') },
        ],
      }).records;
    });

    const values = records.map((record) => Object.fromEntries(record.targets.map((target) => [target.label, target.value])));
    expect(Object.fromEntries(values.map((record) => [record.TITLE, record.ATTACHMENT]))).toEqual({
      'Planning session': 'agenda.pdf',
      'Calendar event': null,
    });
    for (const record of records) {
      const elements = record.targets.map((target) => target.element).filter(Boolean);
      expect(new Set(elements).size).toBe(elements.length);
    }
    expect(pageErrors).toEqual([]);
  });

  it('keeps near-exact learned nested fields while rejecting materially weaker overlap', async () => {
    await page.setContent(`<main>
      <article class="event"><div class="event-title">Calendar event <span class="sender">Ada</span></div></article>
      <article class="event"><div class="event-title">Planning session <strong class="sender">Grace</strong></div></article>
    </main>`);
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(() => {
      const parent = document.querySelector('.event')!;
      return window.__hvyGalaxyInspector.extractPattern({
        minimumConfidence: 0.8,
        parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
        targets: [
          { label: 'EVENT', snapshot: window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('.event-title')!, parent, 'target') },
          { label: 'SENDER', snapshot: window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('.sender')!, parent, 'target') },
        ],
      });
    });

    expect(result.matches).toBe(2);
    expect(result.records.map((record) => Object.fromEntries(record.targets.map((target) => [target.label, target.value])))).toEqual([
      { EVENT: 'Calendar event Ada', SENDER: 'Ada' },
      { EVENT: 'Planning session Grace', SENDER: 'Grace' },
    ]);
    expect(result.records[1].targets[1].score).toBeGreaterThan(result.records[1].targets[0].score + 0.025);
    expect(pageErrors).toEqual([]);
  });

  it('executes a click only inside the requested matched record', async () => {
    await page.setContent(`<main>
      <article class="message"><span class="subject">First</span><button class="open-control">Open</button></article>
      <article class="message"><span class="subject">Second</span><button class="open-control">Open</button></article>
    </main>`);
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(() => {
      const parents = [...document.querySelectorAll('.message')];
      const clicked: number[] = [];
      parents.forEach((parent, index) => parent.querySelector('button')!.addEventListener('click', () => clicked.push(index)));
      const pattern = {
        minimumConfidence: 0.8,
        parents: [window.__hvyGalaxyInspector.snapshotElement(parents[0], null, 'parent')],
        targets: [{ label: 'SUBJECT', snapshot: window.__hvyGalaxyInspector.snapshotElement(parents[0].querySelector('.subject')!, parents[0], 'target') }],
      };
      const records = window.__hvyGalaxyInspector.extractPattern(pattern).records;
      const target = window.__hvyGalaxyInspector.snapshotElement(parents[0].querySelector('.open-control')!, parents[0], 'target');
      const execution = window.__hvyGalaxyInspector.executeCommand({
        pattern,
        command: { id: 'open', scope: 'record', steps: [{ gesture: 'click', target }] },
        recordParent: records[1].parent,
      });
      return { execution, clicked };
    });

    expect(result.execution.status).toBe('executed');
    expect(result.clicked).toEqual([1]);
    expect(pageErrors).toEqual([]);
  });

  it('dispatches a right-click command to a structurally resolved page target', async () => {
    await page.setContent('<main><button class="menu-control">Options</button></main>');
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(() => {
      const target = document.querySelector('.menu-control')!;
      let contextMenus = 0;
      target.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        contextMenus += 1;
      });
      const snapshot = window.__hvyGalaxyInspector.snapshotElement(target, null, 'target');
      const execution = window.__hvyGalaxyInspector.executeCommand({
        pattern: { minimumConfidence: 0.8, parents: [], targets: [] },
        command: { id: 'options', scope: 'page', steps: [{ gesture: 'right-click', target: snapshot }] },
      });
      return { execution, contextMenus };
    });

    expect(result.execution.status).toBe('executed');
    expect(result.contextMenus).toBe(1);
    expect(pageErrors).toEqual([]);
  });

  it('dispatches a double-click command to a structurally resolved page target', async () => {
    await page.setContent('<main><button class="open-control">Open</button></main>');
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(() => {
      const target = document.querySelector('.open-control')!;
      let doubleClicks = 0;
      target.addEventListener('dblclick', () => { doubleClicks += 1; });
      const snapshot = window.__hvyGalaxyInspector.snapshotElement(target, null, 'target');
      const execution = window.__hvyGalaxyInspector.executeCommand({
        pattern: { minimumConfidence: 0.8, parents: [], targets: [] },
        command: { id: 'open', scope: 'page', steps: [{ gesture: 'double-click', target: snapshot }] },
      });
      return { execution, doubleClicks };
    });

    expect(result.execution.status).toBe('executed');
    expect(result.doubleClicks).toBe(1);
    expect(pageErrors).toEqual([]);
  });

  it('enters text into a structurally resolved text field and dispatches form events', async () => {
    await page.setContent('<main><label>Subject <input class="subject-control" value="Old subject"></label></main>');
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(() => {
      const target = document.querySelector<HTMLInputElement>('.subject-control')!;
      const events: string[] = [];
      for (const name of ['beforeinput', 'input', 'change']) target.addEventListener(name, () => events.push(name));
      const snapshot = window.__hvyGalaxyInspector.snapshotElement(target, null, 'target');
      const execution = window.__hvyGalaxyInspector.executeCommand({
        pattern: { minimumConfidence: 0.8, parents: [], targets: [] },
        command: { id: 'subject', scope: 'page', steps: [{ gesture: 'type', target: snapshot, text: 'Project update' }] },
      });
      return { execution, value: target.value, events, focused: document.activeElement === target };
    });

    expect(result.execution.status).toBe('executed');
    expect(result.value).toBe('Project update');
    expect(result.events).toEqual(['beforeinput', 'input', 'change']);
    expect(result.focused).toBe(true);
    expect(pageErrors).toEqual([]);
  });

  it('rejects text entry when the resolved target is not editable', async () => {
    await page.setContent('<main><button class="subject-control">Subject</button></main>');
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(() => {
      const target = document.querySelector('.subject-control')!;
      const snapshot = window.__hvyGalaxyInspector.snapshotElement(target, null, 'target');
      return window.__hvyGalaxyInspector.executeCommand({
        pattern: { minimumConfidence: 0.8, parents: [], targets: [] },
        command: { id: 'subject', scope: 'page', steps: [{ gesture: 'type', target: snapshot, text: 'Project update' }] },
      });
    });

    expect(result).toMatchObject({ status: 'no_match', reason: 'target_not_text_editable' });
    expect(pageErrors).toEqual([]);
  });

  it('does not execute a page command when two targets are structurally tied', async () => {
    await page.setContent('<main><button class="menu-control">First</button><button class="menu-control">Second</button></main>');
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(() => {
      const targets = [...document.querySelectorAll('.menu-control')];
      let clicks = 0;
      targets.forEach((target) => target.addEventListener('click', () => { clicks += 1; }));
      const snapshot = window.__hvyGalaxyInspector.snapshotElement(targets[0], null, 'target');
      const execution = window.__hvyGalaxyInspector.executeCommand({
        pattern: { minimumConfidence: 0.8, parents: [], targets: [] },
        command: { id: 'ambiguous', scope: 'page', steps: [{ gesture: 'click', target: snapshot }] },
      });
      return { execution, clicks };
    });

    expect(result.execution.status).toBe('ambiguous');
    expect(result.clicks).toBe(0);
    expect(pageErrors).toEqual([]);
  });

  it('scrolls the page during across-page extraction and restores its original position', async () => {
    await page.setContent(`<aside class="decoy" style="height:200px;width:2000px;overflow:auto"><div style="height:4000px">Unrelated navigation</div></aside><main class="events" style="height:160px;overflow:auto">${Array.from({ length: 30 }, (_, index) => `<article class="event" style="height:42px"><span>Event ${index + 1}</span></article>`).join('')}</main>`);
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(async () => {
      const scroller = document.querySelector<HTMLElement>('.events')!;
      const decoy = document.querySelector<HTMLElement>('.decoy')!;
      const parent = scroller.querySelector('.event')!;
      let scrollEvents = 0;
      let decoyScrollEvents = 0;
      scroller.addEventListener('scroll', () => { scrollEvents += 1; });
      decoy.addEventListener('scroll', () => { decoyScrollEvents += 1; });
      const extraction = await window.__hvyGalaxyInspector.extractAcrossPage({
        minimumConfidence: 0.8,
        parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
        targets: [{ label: 'EVENT', snapshot: window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('span')!, parent, 'target') }],
      });
      return { matches: extraction.matches, scrollEvents, decoyScrollEvents, finalTop: scroller.scrollTop };
    });

    expect(result.matches).toBe(30);
    expect(result.scrollEvents).toBeGreaterThan(1);
    expect(result.decoyScrollEvents).toBe(0);
    expect(result.finalTop).toBe(0);
    expect(pageErrors).toEqual([]);
  });

  it('waits for virtualized row content to stabilize before collecting records', async () => {
    await page.setContent(`<main class="messages" style="height:160px;overflow:auto">${Array.from({ length: 30 }, (_, index) => `<article class="message" style="height:42px"><span>Message ${index + 1}</span></article>`).join('')}</main>`);
    await page.addScriptTag({ content: inspectorSource });
    const values = await page.evaluate(async () => {
      const scroller = document.querySelector<HTMLElement>('.messages')!;
      const rows = [...scroller.querySelectorAll<HTMLElement>('.message')];
      let pendingUpdate: ReturnType<typeof setTimeout> | null = null;
      scroller.addEventListener('scroll', () => {
        if (pendingUpdate) clearTimeout(pendingUpdate);
        const row = rows[Math.min(rows.length - 1, Math.floor(scroller.scrollTop / 42))];
        const value = row.querySelector('span')!;
        const stableValue = `Message ${rows.indexOf(row) + 1}`;
        value.textContent = 'Loading recycled row';
        pendingUpdate = setTimeout(() => { value.textContent = stableValue; }, 90);
      });
      const parent = rows[0];
      const extraction = await window.__hvyGalaxyInspector.extractAcrossPage({
        minimumConfidence: 0.8,
        parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
        targets: [{ label: 'MESSAGE', snapshot: window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('span')!, parent, 'target') }],
      });
      return extraction.records.flatMap((record) => record.targets.map((target) => target.value));
    });

    expect(values).toHaveLength(30);
    expect(values).not.toContain('Loading recycled row');
    expect(pageErrors).toEqual([]);
  });

  it('extracts across a hidden page without waiting for suspended animation frames', async () => {
    await page.setContent(`<main class="records" style="height:80px;overflow:auto">${Array.from({ length: 8 }, (_, index) => `<article class="record" style="height:40px"><span>Record ${index + 1}</span></article>`).join('')}</main>`);
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(async () => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      const visibleRequestAnimationFrame = window.requestAnimationFrame;
      window.requestAnimationFrame = (() => { throw new Error('hidden extraction requested an animation frame'); }) as typeof requestAnimationFrame;
      const parent = document.querySelector('.record')!;
      try {
        return await window.__hvyGalaxyInspector.extractAcrossPage({
          minimumConfidence: 0.8,
          parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
          targets: [{ label: 'VALUE', snapshot: window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('span')!, parent, 'target') }],
        });
      } finally {
        window.requestAnimationFrame = visibleRequestAnimationFrame;
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      }
    });

    expect(result.matches).toBe(8);
    expect(pageErrors).toEqual([]);
  });

  it('matches a field against structural variants learned from different examples', async () => {
    await page.setContent(`
      <main>
        <article class="record"><span class="value">Alpha</span></article>
        <section class="record"><button class="value" role="link">Beta</button></section>
      </main>
    `);
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(() => {
      const parents = [...document.querySelectorAll('.record')];
      const first = window.__hvyGalaxyInspector.snapshotElement(parents[0].querySelector('.value')!, parents[0], 'target');
      const second = window.__hvyGalaxyInspector.snapshotElement(parents[1].querySelector('.value')!, parents[1], 'target');
      const base = {
        minimumConfidence: 0.9,
        parents: parents.map((parent) => window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')),
      };
      return {
        singleShape: window.__hvyGalaxyInspector.extractPattern({ ...base, targets: [{ label: 'VALUE', snapshot: first }] }).matches,
        learnedShapes: window.__hvyGalaxyInspector.extractPattern({ ...base, targets: [{ label: 'VALUE', snapshot: first, snapshots: [first, second] }] }).matches,
      };
    });

    expect(result.singleShape).toBe(1);
    expect(result.learnedShapes).toBe(2);
    expect(pageErrors).toEqual([]);
  });

  it('does not let changed wrapper relationships veto perfect parent and field matches', async () => {
    await page.setContent(`
      <main><article class="message">
        <div class="field"><span>Ada</span></div>
        <div class="field"><a>Project update</a></div>
        <div class="field"><em>The build is ready.</em></div>
      </article></main>
    `);
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(() => {
      const parent = document.querySelector('.message')!;
      const snapshot = (selector: string) => window.__hvyGalaxyInspector.snapshotElement(parent.querySelector(selector)!, parent, 'target');
      return window.__hvyGalaxyInspector.matchAndHighlight({
        parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
        targets: [
          { label: 'SENDER', snapshot: snapshot('span') },
          { label: 'SUBJECT', snapshot: snapshot('a') },
          { label: 'PREVIEW', snapshot: snapshot('em') },
        ],
      });
    });

    expect(result.matches, JSON.stringify(result, null, 2)).toBe(1);
    expect(result.details[0].relationshipScore).toBeCloseTo(0.2);
    expect(result.details[0].score).toBeGreaterThan(0.88);
  });

  it('numbers matches in page order and keeps overlays attached while a nested page scrolls', async () => {
    await page.setContent(`
      <style>
        .scroller { height: 110px; overflow: auto; }
        .message { display: grid; min-height: 90px; margin-bottom: 30px; }
      </style>
      <main class="scroller">
        <section class="message" data-row="first"><span>First sender</span><a>First subject</a></section>
        <article class="message" data-row="second"><span>Second sender</span><a>Second subject</a></article>
      </main>
    `);
    await page.addScriptTag({ content: inspectorSource });
    await page.evaluate(() => {
      const parent = document.querySelector('[data-row="second"]')!;
      window.__hvyGalaxyInspector.matchAndHighlight({
        parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
        targets: [
          { label: 'SENDER', snapshot: window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('span')!, parent, 'target') },
          { label: 'SUBJECT', snapshot: window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('a')!, parent, 'target') },
        ],
      });
    });

    const firstRow = page.locator('[data-row="first"]');
    const firstOverlay = page.locator('#hvy-galaxy-pattern-matches [data-match-kind="parent"][data-match-index="1"]');
    expect(await firstOverlay.textContent()).toMatch(/^Match 1/);
    expect((await firstOverlay.boundingBox())?.y).toBeCloseTo((await firstRow.boundingBox())!.y, 0);

    await page.locator('.scroller').evaluate((element) => { element.scrollTop = 80; });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    expect((await firstOverlay.boundingBox())?.y).toBeCloseTo((await firstRow.boundingBox())!.y, 0);
    expect(pageErrors).toEqual([]);
  });

  it('learns a component-title vector from the virtualized Guide and finds and scrolls to every title', async () => {
    await page.goto(`${viteUrl}/__guide-vector-test.html`);
    await page.evaluate(async ({ source, moduleUrl }) => {
      const hvy = await (0, eval)(`import(${JSON.stringify(moduleUrl)})`);
      const documentModel = hvy.deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy');
      hvy.mountHvy({
        root: document.querySelector('#guide-root') as HTMLElement,
        document: documentModel,
        mode: 'viewer',
        controls: false,
      });
    }, { source: guideSource, moduleUrl: hvyEmbedModuleUrl });
    await page.locator('.reader-document').waitFor();
    await page.evaluate(() => {
      const body = document.querySelector('.reader-document-body')!;
      const before = document.createElement('div');
      const after = document.createElement('div');
      before.dataset.guideVirtualizationSpacer = 'before';
      after.dataset.guideVirtualizationSpacer = 'after';
      before.style.height = '3200px';
      after.style.height = '3200px';
      body.prepend(before);
      body.append(after);
    });
    await page.locator('#component-guide').waitFor({ state: 'detached' });
    await page.addScriptTag({ content: inspectorSource });

    const initialVirtualization = await page.evaluate(() => {
      const scroller = document.querySelector('.reader-document') as HTMLElement;
      scroller.scrollTop = 0;
      const componentSection = document.querySelector('#component-guide');
      return {
        componentMounted: Boolean(componentSection),
        componentTop: componentSection?.getBoundingClientRect().top ?? null,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
        placeholders: [...document.querySelectorAll('[data-hvy-virtual-placeholder="true"]')].map((element) => (element as HTMLElement).dataset.sectionKey),
      };
    });
    expect(initialVirtualization.componentMounted, JSON.stringify(initialVirtualization)).toBe(false);
    expect(initialVirtualization.placeholders.length).toBeGreaterThan(0);

    const foundGuideByScrolling = await page.evaluate(async () => {
      const scroller = document.querySelector('.reader-document') as HTMLElement;
      for (let top = 0; top <= scroller.scrollHeight - scroller.clientHeight; top += Math.max(200, scroller.clientHeight * 0.7)) {
        scroller.scrollTop = top;
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        if (document.querySelector('#component-guide')) return true;
      }
      return false;
    });
    expect(foundGuideByScrolling).toBe(true);
    await page.locator('#component-guide').waitFor();

    const learned = await page.evaluate(() => {
      const parent = document.querySelector('.reader-block#component-text')!;
      const title = parent.querySelector('h2')!;
      const parentSnapshot = window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent');
      const titleSnapshot = window.__hvyGalaxyInspector.snapshotElement(title, parent, 'target');
      const pattern = { parents: [parentSnapshot], targets: [{ label: 'TITLE', snapshot: titleSnapshot }] };
      window.__guideTitlePattern = pattern;
      return { parentSnapshot, titleSnapshot };
    });
    expect(learned.titleSnapshot.selected.shape.tag).toBe('h2');
    expect(learned.titleSnapshot.selected.shape.visual.viewportWidthRatio).toBeGreaterThan(0);
    expect(learned.titleSnapshot.selected.relativePath?.length).toBeGreaterThan(0);

    await page.evaluate(async () => {
      const scroller = document.querySelector('.reader-document') as HTMLElement;
      scroller.scrollTop = 0;
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    await page.locator('#component-guide').waitFor({ state: 'detached' });

    const extracted = await page.evaluate(async () => {
      const scroller = document.querySelector('.reader-document') as HTMLElement;
      const pattern = window.__guideTitlePattern!;
      const records = new Map<string, ReturnType<InspectorApi['extractPattern']>['records'][number]>();
      const settle = async () => {
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        await new Promise((resolve) => setTimeout(resolve, 25));
      };
      for (let top = 0; top <= scroller.scrollHeight - scroller.clientHeight; top += Math.max(200, scroller.clientHeight * 0.7)) {
        scroller.scrollTop = top;
        await settle();
        for (const record of window.__hvyGalaxyInspector.extractPattern(pattern).records) records.set(record.parent, record);
      }
      scroller.scrollTop = scroller.scrollHeight;
      await settle();
      for (const record of window.__hvyGalaxyInspector.extractPattern(pattern).records) records.set(record.parent, record);
      return window.__hvyGalaxyInspector.selectBestRecords([...records.values()]).records;
    });
    const extractedTitles = extracted.map((record) => String(record.targets.find((target) => target.label === 'TITLE')?.value ?? ''));
    expect(
      [...new Set(extractedTitles)].sort(),
      JSON.stringify(extracted.map((record) => ({ title: record.targets.find((target) => target.label === 'TITLE')?.value, score: record.score, parent: record.parent })), null, 2),
    ).toEqual([...guideTitles].sort());
    expect(extracted.every((record) => record.score >= 0.85)).toBe(true);

    const activation = await page.evaluate(async () => {
      const scroller = document.querySelector('.reader-document') as HTMLElement;
      const pattern = window.__guideTitlePattern!;
      const settle = async () => {
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        await new Promise((resolve) => setTimeout(resolve, 25));
      };
      scroller.scrollTop = 0;
      await settle();
      for (let top = 0; top <= scroller.scrollHeight - scroller.clientHeight; top += Math.max(200, scroller.clientHeight * 0.7)) {
        scroller.scrollTop = top;
        await settle();
        const record = window.__hvyGalaxyInspector.extractPattern(pattern).records.find((candidate) => candidate.targets.some((target) => target.value === 'Custom'));
        if (!record) continue;
        const target = document.querySelector(record.targets.find((item) => item.label === 'TITLE')!.element) as HTMLElement;
        target.scrollIntoView({ block: 'center' });
        await settle();
        const rect = target.getBoundingClientRect();
        const scrollerRect = scroller.getBoundingClientRect();
        return { text: target.textContent?.trim(), visible: rect.top >= scrollerRect.top && rect.bottom <= scrollerRect.bottom };
      }
      return null;
    });
    expect(activation).toEqual({ text: 'Custom', visible: true });

    const afterListMutation = await page.evaluate(() => {
      const pattern = window.__guideTitlePattern!;
      const textCard = document.querySelector<HTMLElement>('#component-text')!;
      const addedCard = textCard.cloneNode(true) as HTMLElement;
      addedCard.id = 'component-chart';
      addedCard.dataset.componentId = 'component-chart';
      addedCard.querySelector('h2')!.textContent = 'Chart';
      textCard.parentElement!.append(addedCard);

      const containerCard = document.querySelector<HTMLElement>('#component-container')!;
      const expandableCard = document.querySelector<HTMLElement>('#component-expandable')!;
      containerCard.parentElement!.insertBefore(expandableCard, containerCard);

      return window.__hvyGalaxyInspector.extractPattern(pattern);
    });
    const titlesAfterMutation = afterListMutation.records.map((record) => String(record.targets.find((target) => target.label === 'TITLE')?.value ?? ''));
    expect([...new Set(titlesAfterMutation)].sort()).toEqual([...guideTitles, 'Chart'].sort());
    expect(afterListMutation.records.every((record) => record.score >= 0.85)).toBe(true);

    const afterSectionReorder = await page.evaluate(() => {
      const componentGuide = document.querySelector<HTMLElement>('#component-guide')!;
      const documentBody = document.querySelector<HTMLElement>('.reader-document-body')!;
      documentBody.prepend(componentGuide);
      return window.__hvyGalaxyInspector.extractPattern(window.__guideTitlePattern!);
    });
    const titlesAfterSectionReorder = afterSectionReorder.records.map((record) => String(record.targets.find((target) => target.label === 'TITLE')?.value ?? ''));
    expect([...new Set(titlesAfterSectionReorder)].sort()).toEqual([...guideTitles, 'Chart'].sort());
    expect(afterSectionReorder.records.every((record) => record.score >= 0.85)).toBe(true);
    expect(pageErrors).toEqual([]);
  });

  it('extracts relevant skills from virtualized and collapsed resume projects', async () => {
    await page.goto(`${viteUrl}/__guide-vector-test.html`);
    await page.evaluate(async ({ source, moduleUrl }) => {
      const hvy = await (0, eval)(`import(${JSON.stringify(moduleUrl)})`);
      const documentModel = hvy.deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy');
      hvy.mountHvy({
        root: document.querySelector('#guide-root') as HTMLElement,
        document: documentModel,
        mode: 'viewer',
        controls: false,
      });
    }, { source: resumeSource, moduleUrl: hvyEmbedModuleUrl });
    await page.locator('.reader-document').waitFor();
    await page.addScriptTag({ content: inspectorSource });

    const foundProjects = await page.evaluate(async () => {
      const scroller = document.querySelector('.reader-document') as HTMLElement;
      for (let top = 0; top <= scroller.scrollHeight - scroller.clientHeight; top += Math.max(240, scroller.clientHeight * 0.65)) {
        scroller.scrollTop = top;
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        if (document.querySelector('#projects')) return true;
      }
      return false;
    });
    expect(foundProjects).toBe(true);
    await page.locator('#projects').waitFor();

    for (const projectId of ['project-heavy-stack', 'project-autonomous-agent-hackathon']) {
      await page.evaluate((id) => {
        const project = document.querySelector<HTMLElement>(`#${id}`)!;
        project.querySelector<HTMLElement>('.expand-stub-toggle')!.click();
      }, projectId);
      await page.locator(`#${projectId} [data-component="skill-xref-card"]`).first().waitFor();
    }

    const learnedSkillVector = await page.evaluate(() => {
      const parent = document.querySelector<HTMLElement>('#project-heavy-stack [data-component="skill-xref-card"]')!;
      const title = parent.querySelector('strong')!;
      const parentSnapshot = window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent');
      const titleSnapshot = window.__hvyGalaxyInspector.snapshotElement(title, parent, 'target');
      const pattern = { minimumConfidence: 0.95, parents: [parentSnapshot], targets: [{ label: 'SKILL', snapshot: titleSnapshot }] };
      window.__guideTitlePattern = pattern;
      return { parentSnapshot, titleSnapshot };
    });
    expect(learnedSkillVector.titleSnapshot.selected.shape.tag).toBe('strong');
    expect(learnedSkillVector.parentSnapshot.selected.shape.semanticLineage.length).toBeGreaterThan(0);

    const extracted = await page.evaluate(async () => {
      const scroller = document.querySelector('.reader-document') as HTMLElement;
      const records = new Map<string, ReturnType<InspectorApi['extractPattern']>['records'][number]>();
      const settle = async () => {
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        await new Promise((resolve) => setTimeout(resolve, 20));
      };
      scroller.scrollTop = 0;
      await settle();
      for (let top = 0; top <= scroller.scrollHeight - scroller.clientHeight; top += Math.max(240, scroller.clientHeight * 0.65)) {
        scroller.scrollTop = top;
        await settle();
        for (const record of window.__hvyGalaxyInspector.extractPattern(window.__guideTitlePattern!).records) records.set(record.parent, record);
      }
      return window.__hvyGalaxyInspector.selectBestRecords([...records.values()]).records;
    });
    const values = extracted.map((record) => String(record.targets.find((target) => target.label === 'SKILL')?.value ?? ''));
    expect(
      [...new Set(values)].sort(),
      JSON.stringify(extracted.map((record) => ({ value: record.targets.find((target) => target.label === 'SKILL')?.value, score: record.score, parent: record.parent })), null, 2),
    ).toEqual([...projectSkills].sort());
    expect(extracted.every((record) => record.score >= 0.85)).toBe(true);

    const activated = await page.evaluate(async () => {
      const scroller = document.querySelector('.reader-document') as HTMLElement;
      for (let top = 0; top <= scroller.scrollHeight - scroller.clientHeight; top += Math.max(240, scroller.clientHeight * 0.65)) {
        scroller.scrollTop = top;
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        const record = window.__hvyGalaxyInspector.extractPattern(window.__guideTitlePattern!).records.find((candidate) => candidate.targets.some((target) => target.value === 'Project Management'));
        if (!record) continue;
        const target = document.querySelector<HTMLElement>(record.targets[0].element)!;
        target.scrollIntoView({ block: 'center' });
        await new Promise(requestAnimationFrame);
        const rect = target.getBoundingClientRect();
        const scrollerRect = scroller.getBoundingClientRect();
        return { value: target.textContent?.trim(), visible: rect.top >= scrollerRect.top && rect.bottom <= scrollerRect.bottom };
      }
      return null;
    });
    expect(activated).toEqual({ value: 'Project Management', visible: true });
    expect(pageErrors).toEqual([]);
  }, 15_000);
});
