import fs from 'node:fs';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer, normalizePath, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const inspectorSource = fs.readFileSync(new URL('./integration-inspector.js', import.meta.url), 'utf8');
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
  // The inspector handles a move on the next frame.
  await page.evaluate(() => new Promise((resolve) => { requestAnimationFrame(() => resolve(null)); }));
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
      scopeIdentity?: string[];
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
    pagePath?: Array<{ tag: string }>;
    scopeLabel?: string;
  };
  range?: { includeStart: boolean; includeEnd: boolean; end: InspectorSnapshot; summary?: string };
}

interface PickOptions { gesture: 'click'; pageNumber?: boolean; prompt: string; confirm: string }

interface InspectorApi {
  discoverStructuredSources(): Array<{ kind: 'rss' | 'atom' | 'json-feed' | 'json-api'; url: string; title: string; authenticated: boolean; discoveredBy: 'link' | 'network' }>;
  fetchStructuredSource(source: { kind: 'rss' | 'atom' | 'json-feed' | 'json-api'; url: string }): Promise<{ value: unknown }>;
  stop(): void;
  start(kind: 'parent' | 'target', options?: {
    primary?: boolean;
    parentCssPath?: string;
    parentSnapshot?: InspectorSnapshot;
    scopeSelection?: boolean;
    selectionScope?: InspectorSnapshot;
    minimumConfidence?: number;
    existingPattern?: Parameters<InspectorApi['extractPattern']>[0];
    matchingView?: boolean;
    multiSelect?: boolean;
    undoParent?: boolean;
    deriveParent?: boolean;
    recordChoice?: { refuse?: string };
    fieldChoices?: Array<{ id: string; label: string }>;
    wrongPage?: boolean;
    externalToolbar?: boolean;
    context?: Record<string, unknown>;
    rangeEdit?: { boundary: 'start' | 'end'; snapshot: InspectorSnapshot };
    prompt?: string;
    commandRecorder?: { scope: 'page' | 'record'; pattern?: Parameters<InspectorApi['extractPattern']>[0]; pick?: PickOptions | { question: string; choices: Array<PickOptions & { pagination: string; label: string }> } };
  }): void;
  /** Presses a button the picker put on the toolbar, by its id. */
  control(buttonId: string): void;
  snapshotElement(element: Element, parent?: Element | null, kind?: 'parent' | 'target' | 'scope'): InspectorSnapshot;
  suggestTargets(element: Element, pattern: Parameters<InspectorApi['extractPattern']>[0]): Array<{ label: string; score: number; snapshot: InspectorSnapshot | null }>;
  matchAndHighlight(pattern: { parents: InspectorSnapshot[]; targets: Array<{ label: string; optional?: boolean; snapshot: InspectorSnapshot; snapshots?: InspectorSnapshot[]; negativeSnapshots?: InspectorSnapshot[] }>; minimumConfidence?: number }): {
    matches: number;
    details: Array<{ parent: string; score: number; parentScore: number; relationshipScore: number; targets: Array<{ label: string; score: number }> }>;
    diagnostics?: unknown;
  };
  extractPattern(pattern: { scope?: InspectorSnapshot; parents: InspectorSnapshot[]; targets: Array<{ label: string; cardinality?: 'single' | 'list'; optional?: boolean; snapshot: InspectorSnapshot; snapshots?: InspectorSnapshot[]; negativeSnapshots?: InspectorSnapshot[] }>; minimumConfidence?: number; recordLimit?: number; scrollPage?: boolean; opener?: InspectorSnapshot }): {
    matches: number;
    records: Array<{
      parent: string;
      score: number;
      targets: Array<{ label: string; element: string; score: number; value: unknown }>;
      opener?: { element: string; href: string | null } | null;
    }>;
  };
  extractAcrossPage(pattern: Parameters<InspectorApi['extractPattern']>[0]): Promise<ReturnType<InspectorApi['extractPattern']> & { minimumConfidence: number }>;
  extractLiveExamples(pattern: Parameters<InspectorApi['extractPattern']>[0] & { targets: Array<{ label: string; snapshot: InspectorSnapshot; exampleSnapshots: Array<InspectorSnapshot | null> }> }): Promise<{ matches: number; records: Array<ReturnType<InspectorApi['extractPattern']>['records'][number] | null> }>;
  extractAndPublish(pattern: Parameters<InspectorApi['extractPattern']>[0], context?: Record<string, unknown>): Promise<{ status?: string; matches: number; records: unknown[] }>;
  cancelExtraction(): void;
  pageReadiness(checks: { urlMode: 'strict-url' | 'strict-domain' | 'domain-regex'; urlValue: string; elements: Array<{ id: string; name: string; snapshot: InspectorSnapshot; expectedValue?: string }> }): { ready: boolean; urlReady: boolean; elements: Array<{ ready: boolean; reason?: string }>; message: string };
  validateReadyChecksAndPublish(checks: Parameters<InspectorApi['pageReadiness']>[0], context?: Record<string, unknown>): ReturnType<InspectorApi['pageReadiness']> & { kind: 'integration-ready-check-validation'; context: Record<string, unknown> };
  selectBestRecords(records: ReturnType<InspectorApi['extractPattern']>['records']): ReturnType<InspectorApi['extractPattern']>;
  executeCommand(payload: { requestId?: string; watchRecord?: boolean; recordIdentity?: string; readyChecks?: Parameters<InspectorApi['pageReadiness']>[0]; pattern: Parameters<InspectorApi['extractPattern']>[0]; pageNumber?: number; command: { id: string; scope: 'page' | 'record'; pagination?: 'next' | 'page-number'; inputs?: Array<{ id: string; name: string; required: boolean; options?: Array<{ value: string; label: string }>; allowCustom?: boolean }>; steps: Array<{ gesture: 'click' | 'double-click' | 'right-click' | 'type' | 'select'; target: InspectorSnapshot; inputId?: string; value?: string; valueLabel?: string }> }; inputs?: Record<string, string>; recordParent?: string }): Promise<{ status: string; reason?: string; inputId?: string; record?: string; target?: string; score?: number; stepIndex?: number; stepsExecuted?: number }>;
}

declare global {
  interface Window {
    __hvyGalaxyInspector: InspectorApi;
    __hvyGalaxyHost?: { publish?: (value: unknown) => void; toolbarState?: (value: unknown) => void; cancel?: () => void };
    __toolbarState?: unknown;
    __commandRecordingResult?: unknown;
    __readyCheckResult?: unknown;
    __guideTitlePattern?: Parameters<InspectorApi['extractPattern']>[0];
  }
}

const mockInbox = `
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
    await page.setContent(mockInbox);
    await page.addScriptTag({ content: inspectorSource });
  });

  it('pauses picking for a check that you\'re human, once, so the page takes clicks, and says why', async () => {
    await page.evaluate(() => {
      const check = document.createElement('div');
      check.className = 'cf-turnstile';
      check.style.cssText = 'width:300px;height:65px';
      document.body.append(check);
    });
    await page.evaluate(() => window.__hvyGalaxyInspector.start('parent', { primary: true }));
    const shield = () => page.evaluate(() => document.getElementById('hvy-galaxy-inspector-shield')?.style.pointerEvents);
    expect(await shield()).toBe('none');
    expect(await page.locator('[data-inspector-status-text]').textContent()).toBe('The page is checking you’re human · finish it, then Resume picking');
    // Resumed by hand while the check still shows, picking stays resumed.
    await page.locator('#hvy-galaxy-inspector-status button').filter({ hasText: 'Resume picking' }).click();
    await page.waitForTimeout(1300);
    expect(await shield()).toBe('auto');
    expect(pageErrors).toEqual([]);
  });

  it('does not pause picking for an invisible reCAPTCHA', async () => {
    await page.evaluate(() => {
      const badge = document.createElement('iframe');
      badge.src = 'about:blank#/recaptcha/api2/anchor?k=key&size=invisible';
      badge.style.cssText = 'width:256px;height:60px';
      document.body.append(badge);
    });
    await page.evaluate(() => window.__hvyGalaxyInspector.start('parent', { primary: true }));
    expect(await page.evaluate(() => document.getElementById('hvy-galaxy-inspector-shield')?.style.pointerEvents)).toBe('auto');
  });

  it('highlights on hover and completes a parent choice without an exception', async () => {
    await page.evaluate(() => window.__hvyGalaxyInspector.start('parent', { primary: true }));
    await movePointerTo(page, '[data-record="first"] .subject');

    expect(await page.locator('[data-inspector-status-text]').textContent()).toBe('Select the box around one record');
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

  it('requires the configured URL and selected landmark values before a page is ready', async () => {
    const result = await page.evaluate(() => {
      const subject = document.createElement('strong');
      subject.id = 'ready-marker';
      subject.textContent = 'Project update';
      document.body.prepend(subject);
      const snapshot = window.__hvyGalaxyInspector.snapshotElement(subject, null, 'target');
      const checks = {
        urlMode: 'strict-url' as const,
        urlValue: location.href,
        elements: [{ id: 'subject', name: 'Inbox subject', snapshot, expectedValue: 'Project update' }],
      };
      const ready = window.__hvyGalaxyInspector.pageReadiness(checks);
      subject.textContent = 'Sign in to continue';
      const changed = window.__hvyGalaxyInspector.pageReadiness(checks);
      const wrongUrl = window.__hvyGalaxyInspector.pageReadiness({ ...checks, urlValue: `${location.href}other` });
      return { ready, changed, wrongUrl };
    });

    expect(result.ready.ready).toBe(true);
    expect(result.changed.ready).toBe(false);
    expect(result.changed.elements[0].reason).toBe('value_changed');
    expect(result.wrongUrl.ready).toBe(false);
    expect(result.wrongUrl.urlReady).toBe(false);
  });

  it('publishes self-contained ready-check validation results for the UI', async () => {
    await page.close();
    page = await browser.newPage();
    await page.setContent(mockInbox);
    await page.evaluate(() => {
      window.__hvyGalaxyHost = { ...window.__hvyGalaxyHost, publish: (value) => { window.__readyCheckResult = value; } };
    });
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(() => {
      const landmark = document.createElement('strong');
      landmark.textContent = 'Signed in';
      document.body.prepend(landmark);
      const checks = {
        urlMode: 'strict-url' as const,
        urlValue: location.href,
        elements: [{ id: 'account', name: 'Account marker', snapshot: window.__hvyGalaxyInspector.snapshotElement(landmark, null, 'target'), expectedValue: 'Signed in' }],
      };
      const returned = window.__hvyGalaxyInspector.validateReadyChecksAndPublish(checks, { mode: 'ready-check-validation' });
      return { returned, published: window.__readyCheckResult };
    });

    expect(result.returned).toMatchObject({
      kind: 'integration-ready-check-validation',
      ready: true,
      urlReady: true,
      elements: [{ id: 'account', name: 'Account marker', ready: true }],
    });
    expect(result.published).toEqual(result.returned);
  });

  it('boxes matching ready-check landmarks green and changed values red', async () => {
    await page.close();
    page = await browser.newPage();
    await page.setContent(mockInbox);
    await page.evaluate(() => {
      window.__hvyGalaxyHost = { ...window.__hvyGalaxyHost, publish: (value) => { window.__readyCheckResult = value; } };
    });
    await page.addScriptTag({ content: inspectorSource });
    const states = await page.evaluate(() => {
      const passing = document.createElement('h1');
      passing.textContent = 'Signed in';
      const changed = document.createElement('time');
      changed.textContent = 'August';
      document.body.prepend(passing, changed);
      window.__hvyGalaxyInspector.validateReadyChecksAndPublish({
        urlMode: 'strict-url',
        urlValue: location.href,
        elements: [
          { id: 'passing', name: 'Account heading', snapshot: window.__hvyGalaxyInspector.snapshotElement(passing, null, 'target'), expectedValue: 'Signed in' },
          { id: 'changed', name: 'Current month', snapshot: window.__hvyGalaxyInspector.snapshotElement(changed, null, 'target'), expectedValue: 'September' },
        ],
      });
      return [...document.querySelectorAll<HTMLElement>('#hvy-galaxy-ready-check-matches [data-ready-check-state]')].map((box) => ({
        state: box.dataset.readyCheckState,
        caption: box.textContent,
        borderColor: box.style.borderColor,
      }));
    });

    expect(states).toEqual([
      { state: 'ready', caption: 'Ready · Account heading', borderColor: 'rgb(39, 134, 95)' },
      { state: 'value-changed', caption: 'Value changed · Current month', borderColor: 'rgb(179, 58, 58)' },
    ]);
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

  it("finds a JSON API by the type the browser reports, whatever its address, and leaves the page's fetch as it was", async () => {
    await page.route('**/api/items', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [] }) }));
    await page.goto(viteUrl);
    const pageFetch = await page.evaluate(() => String(window.fetch));
    await page.addScriptTag({ content: inspectorSource });
    await page.evaluate(() => fetch('/api/items').then((response) => response.json()));

    const found = await page.evaluate(() => window.__hvyGalaxyInspector.discoverStructuredSources().filter((source) => source.discoveredBy === 'network').map((source) => [source.kind, new URL(source.url).pathname]));
    expect(found).toContainEqual(['json-api', '/api/items']);
    expect(await page.evaluate(() => String(window.fetch))).toBe(pageFetch);
  });

  it('restarts parent highlighting when another record example is requested', async () => {
    await page.evaluate(() => window.__hvyGalaxyInspector.start('parent', { primary: true }));
    await clickPointerAt(page, '[data-record="first"] .subject');
    await page.locator('#hvy-galaxy-inspector-picker button').filter({ hasText: 'article' }).click();

    await page.evaluate(() => window.__hvyGalaxyInspector.start('parent'));
    await movePointerTo(page, '[data-record="second"] .subject');
    expect(await page.locator('[data-inspector-status-text]').textContent()).toBe('Select the box around one record');
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

    expect(await page.locator('[data-inspector-status-text]').textContent()).toBe('Select the data to read');
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

  it('offers text a card makes click-through, where its title link covers the card', async () => {
    // As a job board's card: the title link's ::after covers the whole card, so a click anywhere opens the job, and the
    // card's other text lets clicks through to it (pointer-events: none), so the page's hit test never finds that text.
    await page.setContent(`
      <style>
        .job { position: relative; display: flex; gap: 2rem; width: 900px; padding: 16px; }
        .title::after { content: ""; position: absolute; inset: 0; z-index: 1; }
        .attributes * { pointer-events: none; }
        .attributes, .attributes div { display: flex; flex-direction: column; }
      </style>
      <div class="job" id="job">
        <h2><a class="title" href="/job/1">Global Tech - Software Developer with AI, Manager</a></h2>
        <div class="attributes"><div><span>19 Hours Ago</span><span>Hybrid</span><div><span class="location">Seattle, WA, USA</span></div></div></div>
      </div>
    `);
    await page.evaluate(() => {
      delete (window as { __hvyGalaxyInspector?: InspectorApi }).__hvyGalaxyInspector;
    });
    await page.addScriptTag({ content: inspectorSource });
    await page.evaluate(() => window.__hvyGalaxyInspector.start('target', {
      parentCssPath: '#job',
      parentSnapshot: window.__hvyGalaxyInspector.snapshotElement(document.querySelector('#job')!, null, 'parent'),
      multiSelect: true,
    }));
    await clickPointerAt(page, '.location');
    // The location itself is offered, not only what holds it with the time and Hybrid.
    expect(await page.locator('#hvy-galaxy-inspector-picker button').allTextContents()).toContain('span — Seattle, WA, USA');
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
    expect(await page.locator('[data-inspector-status-text]').textContent()).toBe('1 field selected');
    expect(await page.locator('[data-collection-selection="true"]').count()).toBe(1);

    await movePointerTo(page, '[data-record="first"] .subject');
    expect(await page.locator('#hvy-galaxy-inspector-highlight').textContent()).toBe('Add field · a');
    await clickPointerAt(page, '[data-record="first"] .subject');
    await page.locator('#hvy-galaxy-inspector-picker button').filter({ hasText: 'a — Project update' }).click();
    expect(await page.locator('[data-inspector-status-text]').textContent()).toBe('2 fields selected');
    expect(await page.locator('[data-collection-selection="true"]').count()).toBe(2);

    await page.getByRole('button', { name: 'Undo last' }).click();
    expect(await page.locator('[data-inspector-status-text]').textContent()).toBe('1 field selected');
    expect(await page.locator('[data-collection-selection="true"]').count()).toBe(1);
    expect(await page.getByRole('button', { name: 'Done' }).isEnabled()).toBe(true);

    // Escape takes back the last field, as Undo last does; with none left it does nothing, and picking goes on.
    await page.keyboard.press('Escape');
    expect(await page.locator('[data-collection-selection="true"]').count()).toBe(0);
    await page.keyboard.press('Escape');
    expect(await page.locator('[data-inspector-status-text]').textContent()).toBe('Select fields, or choose Done to cancel');
    expect(await page.getByRole('button', { name: 'Done' }).isVisible()).toBe(true);
    expect(pageErrors).toEqual([]);
  });

  it('undoes the picked box with Undo last once no fields are left, when picking the first example\'s fields', async () => {
    await page.setContent(mockInbox);
    await page.evaluate(() => {
      delete (window as { __hvyGalaxyInspector?: InspectorApi }).__hvyGalaxyInspector;
      window.__hvyGalaxyHost = { ...window.__hvyGalaxyHost, publish: (value) => { window.__commandRecordingResult = value; } };
    });
    await page.addScriptTag({ content: inspectorSource });
    const parentSnapshot = await page.evaluate(() => window.__hvyGalaxyInspector.snapshotElement(document.querySelector('[data-record="first"]')!, null, 'parent'));
    await page.evaluate((snapshot) => window.__hvyGalaxyInspector.start('target', {
      parentCssPath: '[data-record="first"]',
      parentSnapshot: snapshot,
      multiSelect: true,
      undoParent: true,
    }), parentSnapshot);
    const statusText = page.locator('[data-inspector-status-text]');
    expect(await statusText.textContent()).toBe('Select fields, or Undo last to pick the box again');

    // A field picked is undone first; then the box.
    await clickPointerAt(page, '[data-record="first"] .sender');
    await page.locator('#hvy-galaxy-inspector-picker button').filter({ hasText: 'span' }).first().click();
    await page.getByRole('button', { name: 'Undo last' }).click();
    expect(await statusText.textContent()).toBe('Select fields, or Undo last to pick the box again');
    expect(await page.evaluate(() => window.__commandRecordingResult)).toBeUndefined();
    await page.getByRole('button', { name: 'Undo last' }).click();
    expect(await page.evaluate(() => window.__commandRecordingResult)).toEqual({ kind: 'integration-target-collection-undo-parent' });
    expect(await page.locator('#hvy-galaxy-inspector-status').count()).toBe(0);
    expect(pageErrors).toEqual([]);
  });

  it('takes the box around fields picked first as the record, so a job shown beside the list reads from its pane', async () => {
    await page.setContent(`<main class="board" style="display:flex;gap:20px;margin-top:140px">
      <ul class="rows" style="width:300px">${['Data Analyst', 'Product Manager', 'Designer'].map((title) => `<li class="row"><h2 class="title">${title}</h2><p>Acme</p></li>`).join('')}</ul>
      <section class="pane" style="flex:1"><h2 class="title">Senior Engineer</h2><div class="description"><p>Build the console.</p></div></section>
    </main>`);
    await page.evaluate(() => {
      delete (window as { __hvyGalaxyInspector?: InspectorApi }).__hvyGalaxyInspector;
      window.__hvyGalaxyHost = { ...window.__hvyGalaxyHost, publish: (value) => { window.__commandRecordingResult = value; } };
    });
    await page.addScriptTag({ content: inspectorSource });
    await page.evaluate(() => window.__hvyGalaxyInspector.start('target', { multiSelect: true, deriveParent: true, prompt: 'Pick what to read from the job.' }));
    expect(await page.locator('[data-inspector-status-text]').textContent()).toBe('Pick what to read from the job.');
    await clickPointerAt(page, '.pane .title');
    await page.locator('#hvy-galaxy-inspector-picker button').filter({ hasText: 'h2 — Senior Engineer' }).click();
    await clickPointerAt(page, '.pane .description p');
    await page.locator('#hvy-galaxy-inspector-picker button').filter({ hasText: 'p — Build the console.' }).click();
    await page.getByRole('button', { name: 'Done' }).click();

    const result = await page.evaluate(() => {
      const collection = window.__commandRecordingResult as { kind: string; parent: InspectorSnapshot & { selected: { cssPath: string } }; items: InspectorSnapshot[] };
      const extracted = window.__hvyGalaxyInspector.extractPattern({
        parents: [collection.parent],
        targets: collection.items.map((snapshot, index) => ({ label: ['TITLE', 'DESCRIPTION'][index], snapshot })),
      });
      return {
        kind: collection.kind,
        box: collection.parent.selected.cssPath,
        isPane: document.querySelector(collection.parent.selected.cssPath) === document.querySelector('.pane'),
        records: extracted.records.map((record: { targets: Array<{ value: unknown }> }) => record.targets.map((target) => target.value)),
      };
    });
    expect(result.kind).toBe('integration-target-collection');
    expect(result.isPane, result.box).toBe(true);
    expect(result.records).toEqual([['Senior Engineer', 'Build the console.']]);
    expect(pageErrors).toEqual([]);
  });

  it('shows the fields as pills, filled once picked, and asks which field each pick is by the pills not yet filled', async () => {
    await page.setContent(`<main class="board" style="display:flex;gap:20px">
      <section class="pane" style="flex:1"><h2 class="title">Senior Engineer</h2><p class="pay">\$140,000 a year</p><div class="description"><p>Build the console.</p></div></section>
    </main>`);
    await page.evaluate(() => {
      delete (window as { __hvyGalaxyInspector?: InspectorApi }).__hvyGalaxyInspector;
      window.__hvyGalaxyHost = { ...window.__hvyGalaxyHost, publish: (value) => { window.__commandRecordingResult = value; } };
      window.__hvyGalaxyHost = { ...window.__hvyGalaxyHost, toolbarState: (value) => { window.__toolbarState = value; } };
    });
    await page.addScriptTag({ content: inspectorSource });
    await page.evaluate(() => window.__hvyGalaxyInspector.start('target', {
      multiSelect: true,
      deriveParent: true,
      externalToolbar: true,
      prompt: 'Pick what to read from the job',
      fieldChoices: [{ id: 'title', label: 'Title' }, { id: 'pay', label: 'Pay' }, { id: 'description', label: 'Description' }],
    }));
    type Toolbar = { status: string; buttons: Array<{ id: string; label: string }>; fields: Array<{ id: string; label: string; picked: boolean; disabled: boolean }> };
    const toolbar = () => page.evaluate(() => window.__toolbarState as Toolbar);
    const settled = (status: string) => page.waitForFunction((expected) => (window.__toolbarState as Toolbar).status === expected, status);
    const press = async (label: string) => {
      const { buttons, fields } = await toolbar();
      const id = [...buttons, ...fields].find((button) => button.label === label)!.id;
      await page.evaluate((buttonId) => window.__hvyGalaxyInspector.control(buttonId), id);
    };
    // Every field, there from the start, none filled; nothing to answer yet.
    const pills = async () => (await toolbar()).fields.map(({ label, picked, disabled }) => `${label}${picked ? ' ✓' : ''}${disabled ? '' : ' (choose)'}`);
    expect((await toolbar()).status).toBe('Pick what to read from the job');
    expect(await pills()).toEqual(['Title', 'Pay', 'Description']);

    await clickPointerAt(page, '.pane .title');
    await page.locator('#hvy-galaxy-inspector-picker button').filter({ hasText: 'h2 — Senior Engineer' }).click();
    await settled('Which field is this? “Senior Engineer”');
    expect(await pills()).toEqual(['Title (choose)', 'Pay (choose)', 'Description (choose)']);
    expect((await toolbar()).buttons.map((button) => button.label)).toEqual(['Skip', 'Undo last']);
    await press('Title');
    await settled('Pick what to read from the job · then Done');
    expect(await pills()).toEqual(['Title ✓', 'Pay', 'Description']);
    expect((await toolbar()).buttons.map((button) => button.label)).toEqual(['Navigate page', 'Use range', 'Undo last', 'Done']);

    await clickPointerAt(page, '.pane .pay');
    await page.locator('#hvy-galaxy-inspector-picker button').filter({ hasText: 'p — \$140,000 a year' }).click();
    await settled('Which field is this? “\$140,000 a year”');
    // A field already picked stays filled, and is not offered again.
    expect(await pills()).toEqual(['Title ✓', 'Pay (choose)', 'Description (choose)']);
    await press('Pay');
    await settled('Pick what to read from the job · then Done');
    expect(await pills()).toEqual(['Title ✓', 'Pay ✓', 'Description']);
    // Undo last empties its pill again.
    await press('Undo last');
    await page.waitForFunction(() => !(window.__toolbarState as { fields: Array<{ picked: boolean }> }).fields[1].picked);
    expect(await pills()).toEqual(['Title ✓', 'Pay', 'Description']);
    await clickPointerAt(page, '.pane .pay');
    await page.locator('#hvy-galaxy-inspector-picker button').filter({ hasText: 'p — \$140,000 a year' }).click();
    await settled('Which field is this? “\$140,000 a year”');
    await press('Pay');
    await settled('Pick what to read from the job · then Done');
    await press('Done');

    const published = await page.evaluate(() => window.__commandRecordingResult as { items: Array<{ fieldId?: string }> });
    expect(published.items.map((item) => item.fieldId)).toEqual(['title', 'pay']);
    expect(pageErrors).toEqual([]);
  });

  it('records a range picked first within the box taken around the fields, both of its ends', async () => {
    await page.setContent(sectionedPostings);
    await page.evaluate(() => {
      delete (window as { __hvyGalaxyInspector?: InspectorApi }).__hvyGalaxyInspector;
      window.__hvyGalaxyHost = { ...window.__hvyGalaxyHost, publish: (value) => { window.__commandRecordingResult = value; } };
    });
    await page.addScriptTag({ content: inspectorSource });
    await page.evaluate(() => window.__hvyGalaxyInspector.start('target', { multiSelect: true, deriveParent: true }));
    const picker = page.locator('#hvy-galaxy-inspector-picker');
    await clickPointerAt(page, '[data-record="first"] .posting-title');
    await picker.locator('button', { hasText: 'h1 — Senior TypeScript Engineer' }).click();
    await page.getByRole('button', { name: 'Use range' }).click();
    await clickPointerAt(page, '[data-record="first"] .posting-meta');
    await picker.getByLabel('Start after it').check();
    await picker.locator('button', { hasText: 'p — Remote (US) · Full-time' }).click();
    await clickPointerAt(page, '[data-record="first"] .apply-button');
    await picker.getByLabel('End before it').check();
    await picker.locator('button', { hasText: 'a — Apply now' }).click();
    await page.getByRole('button', { name: 'Done' }).click();

    const result = await page.evaluate(() => {
      const collection = window.__commandRecordingResult as { parent: InspectorSnapshot & { selected: { cssPath: string } }; items: Array<InspectorSnapshot & { selected: { scopeCssPath: string | null; relativePath: unknown } }> };
      const range = collection.items[1].range as unknown as { end: { selected: { scopeCssPath: string | null; relativePath: unknown } }; summary: string };
      return {
        isRecord: document.querySelector(collection.parent.selected.cssPath) === document.querySelector('[data-record="first"]'),
        withinBox: [collection.items[0].selected.scopeCssPath, collection.items[1].selected.scopeCssPath, range.end.selected.scopeCssPath].every((path) => path === collection.parent.selected.cssPath),
        endPlaced: range.end.selected.relativePath !== null,
        summary: range.summary,
      };
    });
    expect(result).toMatchObject({ isRecord: true, withinBox: true, endPlaced: true });
    expect(result.summary).toMatch(/^Starts after “Remote \(US\) · Full-time” · Ends before “Apply now”/);
    expect(pageErrors).toEqual([]);
  });

  it('treats Done with no selected fields as a canceled collection', async () => {
    await page.setContent(mockInbox);
    await page.evaluate(() => {
      delete (window as { __hvyGalaxyInspector?: InspectorApi }).__hvyGalaxyInspector;
      window.__hvyGalaxyHost = { ...window.__hvyGalaxyHost, publish: (value) => { window.__commandRecordingResult = value; } };
      window.__hvyGalaxyHost = { ...window.__hvyGalaxyHost, toolbarState: (value) => { window.__toolbarState = value; } };
    });
    await page.addScriptTag({ content: inspectorSource });
    const parentSnapshot = await page.evaluate(() => {
      const parent = document.querySelector('[data-record="first"]')!;
      return window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent');
    });
    await page.evaluate((snapshot) => window.__hvyGalaxyInspector.start('target', {
      parentCssPath: '[data-record="first"]',
      parentSnapshot: snapshot,
      multiSelect: true,
      externalToolbar: true,
    }), parentSnapshot);

    expect(await page.locator('#hvy-galaxy-inspector-status').count()).toBe(0);
    expect(await page.evaluate(() => window.__toolbarState)).toMatchObject({
      active: true,
      buttons: [{ id: 'navigate', label: 'Navigate page' }, { id: 'range', label: 'Use range' }, { id: 'undo', label: 'Undo last', disabled: true }, { id: 'done', label: 'Done', primary: true }],
    });
    await page.evaluate(() => window.__hvyGalaxyInspector.control('done'));
    expect(await page.evaluate(() => window.__commandRecordingResult)).toEqual({ kind: 'integration-target-collection', items: [] });
    expect(pageErrors).toEqual([]);
  });

  it('relays wheel scrolling to the box beneath the inspection shield', async () => {
    await page.setContent('<main class="scroll-box" style="height:100px;overflow:auto"><div style="height:800px"><span>Top</span></div></main>');
    await page.addScriptTag({ content: inspectorSource });
    await page.evaluate(() => window.__hvyGalaxyInspector.start('parent', { primary: true }));
    const box = await page.locator('.scroll-box').boundingBox();
    await page.mouse.move(box!.x + 30, box!.y + 30);
    await page.mouse.wheel(0, 180);
    expect(await page.locator('.scroll-box').evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
  });

  it('scrolls a box beneath the shield by a touchpad’s slow wheel, each event less than a pixel', async () => {
    await page.setContent('<main class="scroll-box" style="height:100px;overflow:auto"><div style="height:800px"><span>Top</span></div></main>');
    await page.addScriptTag({ content: inspectorSource });
    await page.evaluate(() => window.__hvyGalaxyInspector.start('parent', { primary: true }));
    const scrollTop = await page.evaluate(() => {
      const scroller = document.querySelector('.scroll-box')!;
      scroller.scrollTop = 300;
      const shield = document.getElementById('hvy-galaxy-inspector-shield')!;
      const rect = scroller.getBoundingClientRect();
      for (let index = 0; index < 20; index += 1) {
        shield.dispatchEvent(new WheelEvent('wheel', { deltaY: -0.4, clientX: rect.left + 30, clientY: rect.top + 30, bubbles: true, cancelable: true }));
      }
      return scroller.scrollTop;
    });
    expect(scrollTop).toBe(292);
    expect(pageErrors).toEqual([]);
  });

  it('leaves a page that scrolls as a whole to the browser to scroll, beneath the shield', async () => {
    await page.setContent('<main style="height:3000px"><span>Top</span></main>');
    await page.addScriptTag({ content: inspectorSource });
    await page.evaluate(() => window.__hvyGalaxyInspector.start('parent', { primary: true }));
    const cancelled = await page.evaluate(() => {
      const shield = document.getElementById('hvy-galaxy-inspector-shield')!;
      const wheel = new WheelEvent('wheel', { deltaY: 120, clientX: 30, clientY: 30, bubbles: true, cancelable: true });
      shield.dispatchEvent(wheel);
      return wheel.defaultPrevented;
    });
    expect(cancelled).toBe(false);
    await page.mouse.move(30, 30);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(300);
    expect(pageErrors).toEqual([]);
  });

  it('keeps the page from hearing presses, hovers, and clicks while picking, and lets it hear them once stopped', async () => {
    await page.setContent('<main><button class="page-button" style="width:200px;height:60px">Open</button></main>');
    await page.addScriptTag({ content: inspectorSource });
    await page.evaluate(() => {
      const button = document.querySelector('.page-button')!;
      (window as unknown as { __heard: string[] }).__heard = [];
      for (const type of ['pointerdown', 'mousedown', 'mouseup', 'mouseover', 'pointerenter', 'click']) {
        button.addEventListener(type, () => (window as unknown as { __heard: string[] }).__heard.push(type));
      }
      window.__hvyGalaxyInspector.start('parent', { primary: true });
    });
    await movePointerTo(page, '.page-button');
    await page.mouse.down();
    await page.mouse.up();
    expect(await page.evaluate(() => (window as unknown as { __heard: string[] }).__heard)).toEqual([]);
    // The click opened the picker's choices, not the page's button.
    expect(await page.locator('#hvy-galaxy-inspector-picker').count()).toBe(1);

    await page.evaluate(() => window.__hvyGalaxyInspector.stop());
    await page.locator('.page-button').click();
    expect(await page.evaluate(() => (window as unknown as { __heard: string[] }).__heard)).toContain('click');
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

  it('offers a section of paragraphs and lists as a field, and reads it with its line breaks', async () => {
    await page.setContent(`
      <article class="job-detail">
        <h1 class="job-title">Senior Frontend Engineer</h1>
        <div class="job-description">
          <p>Build the operator console.</p>
          <h2>What you'll do</h2>
          <ul><li>Work with the team.</li><li>Ship every week.</li></ul>
          <p hidden>Internal note.</p>
          <button>Apply</button>
        </div>
      </article>`);
    await page.addScriptTag({ content: inspectorSource });
    const parentSnapshot = await page.evaluate(() => window.__hvyGalaxyInspector.snapshotElement(document.querySelector('.job-detail')!, null, 'parent'));
    await page.evaluate((snapshot) => window.__hvyGalaxyInspector.start('target', {
      parentCssPath: '.job-detail',
      parentSnapshot: snapshot,
      multiSelect: true,
    }), parentSnapshot);
    await clickPointerAt(page, '.job-description p:first-child');
    const choices = await page.locator('#hvy-galaxy-inspector-picker button').allTextContents();
    expect(choices).toContain('p — Build the operator console.');
    // The section is offered with its length and where it starts and ends; the whole posting (the record) is not.
    const section = choices.find((choice) => choice.startsWith('div.job-description · '));
    expect(section).toContain('Starts  Build the operator console.');
    expect(section).toContain('Ends  Build the operator console.');
    expect(choices.some((choice) => choice.startsWith('article'))).toBe(false);

    const value = await page.evaluate(() => {
      const parent = document.querySelector('.job-detail')!;
      return window.__hvyGalaxyInspector.extractPattern({
        parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
        targets: [{ label: 'description', snapshot: window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('.job-description')!, parent, 'target') }],
      }).records[0].targets[0].value;
    });
    expect(value).toBe("Build the operator console.\n\nWhat you'll do\n\nWork with the team.\n\nShip every week.");
    expect(pageErrors).toEqual([]);
  });

  // Postings whose description is their sections, beside the title, details, and Apply button, with no element of its own.
  const sectionedPostings = `
    <style>.posting { width: 640px; padding: 16px; } .apply-button { display: inline-block; padding: 6px 12px; }</style>
    <main class="postings">
      <article class="posting" data-record="first">
        <h1 class="posting-title">Senior TypeScript Engineer</h1>
        <p class="posting-meta"><span class="location">Remote (US)</span> · Full-time</p>
        <h2>About the role</h2>
        <p>Build the dispatch console.</p>
        <h2>Responsibilities</h2>
        <ul><li>Own the route planning screens.</li><li>Mentor two engineers.</li></ul>
        <div class="apply-bar"><a class="apply-button" href="#apply">Apply now</a></div>
        <h2>Similar jobs</h2>
        <ul class="similar"><li><a href="#other">Data Analyst</a></li></ul>
      </article>
      <article class="posting" data-record="second">
        <h1 class="posting-title">Data Analyst</h1>
        <p class="posting-meta"><span class="location">Denver, CO</span> · Full-time</p>
        <h2>About the role</h2>
        <p>Turn shipment data into reports.</p>
        <h2>Requirements</h2>
        <ul><li>SQL and Python.</li></ul>
        <h2>Benefits</h2>
        <ul><li>Learning budget.</li></ul>
        <div class="apply-bar"><a class="apply-button" href="#apply">Apply now</a></div>
        <h2>Similar jobs</h2>
        <ul class="similar"><li><a href="#other">Senior TypeScript Engineer</a></li></ul>
      </article>
      <article class="posting" data-record="closed">
        <h1 class="posting-title">Warehouse Systems Engineer</h1>
        <p class="posting-meta"><span class="location">Reno, NV</span> · Contract</p>
        <h2>About the role</h2>
        <p>This position has been filled.</p>
        <h2>Similar jobs</h2>
        <ul class="similar"><li><a href="#other">Data Analyst</a></li></ul>
      </article>
    </main>`;

  it('picks a field as a range from one element to another, and returns it as one field', async () => {
    await page.setContent(sectionedPostings);
    await page.evaluate(() => {
      delete (window as { __hvyGalaxyInspector?: InspectorApi }).__hvyGalaxyInspector;
      window.__hvyGalaxyHost = { ...window.__hvyGalaxyHost, publish: (value) => { window.__commandRecordingResult = value; } };
    });
    await page.addScriptTag({ content: inspectorSource });
    const parentSnapshot = await page.evaluate(() => window.__hvyGalaxyInspector.snapshotElement(document.querySelector('[data-record="first"]')!, null, 'parent'));
    await page.evaluate((snapshot) => window.__hvyGalaxyInspector.start('target', {
      parentCssPath: '[data-record="first"]',
      parentSnapshot: snapshot,
      multiSelect: true,
    }), parentSnapshot);
    const status = page.locator('[data-inspector-status-text]');
    const picker = page.locator('#hvy-galaxy-inspector-picker');

    // The title is a field of its own; the description starts after the details line.
    await clickPointerAt(page, '[data-record="first"] .posting-title');
    await picker.locator('button', { hasText: 'h1 — Senior TypeScript Engineer' }).click();
    // Use range: a click picks where a range starts, not a field.
    await page.getByRole('button', { name: 'Use range' }).click();
    expect(await status.textContent()).toBe('Pick where the range starts · Esc leaves range mode');
    expect(await page.getByRole('button', { name: 'Pick element' }).count()).toBe(1);
    await clickPointerAt(page, '[data-record="first"] .posting-meta');
    // The row clicked is where it starts; ticked, it starts after the row.
    await picker.getByLabel('Start after it').check();
    await picker.locator('button', { hasText: 'p — Remote (US) · Full-time' }).click();
    expect(await picker.count()).toBe(0);
    expect(await status.textContent()).toBe('Pick where the range ends · Esc leaves range mode');

    // Hovering previews the range up to the element under the pointer.
    await movePointerTo(page, '[data-record="first"] .apply-button');
    expect(await page.locator('#hvy-galaxy-inspector-highlight').textContent()).toMatch(/^Range · \d+ characters$/);
    expect(await status.textContent()).toMatch(/^Pick where the range ends · Ends …?.*Apply now · \d+ characters$/);
    // Only what comes after the start can end it.
    await movePointerTo(page, '[data-record="first"] .posting-title');
    expect(await status.textContent()).toBe('Pick something after the start');

    await clickPointerAt(page, '[data-record="first"] .apply-button');
    expect(await picker.locator('div').first().textContent()).toBe('Choose where the range ends');
    await picker.getByLabel('End before it').check();
    await picker.locator('button', { hasText: 'a — Apply now' }).click();
    // The range made, picking is back to elements.
    expect(await status.textContent()).toBe('2 fields selected');
    expect(await page.getByRole('button', { name: 'Use range' }).count()).toBe(1);
    expect(await page.locator('[data-collection-selection="true"]').count()).toBe(2);

    await page.getByRole('button', { name: 'Done' }).click();
    const published = await page.evaluate(() => window.__commandRecordingResult) as { items: InspectorSnapshot[] };
    expect(published.items).toHaveLength(2);
    expect(published.items[0].range).toBeUndefined();
    expect(published.items[1].selected.directText).toBe('· Full-time');
    expect(published.items[1].range).toMatchObject({
      includeStart: false,
      includeEnd: false,
      end: { selected: { directText: 'Apply now' } },
      summary: expect.stringMatching(/^Starts after “Remote \(US\) · Full-time” · Ends before “Apply now” · \d+ characters$/),
    });
    expect(pageErrors).toEqual([]);
  });

  it('cancels a range with Escape and keeps the fields already picked', async () => {
    await page.setContent(sectionedPostings);
    await page.addScriptTag({ content: inspectorSource });
    const parentSnapshot = await page.evaluate(() => window.__hvyGalaxyInspector.snapshotElement(document.querySelector('[data-record="first"]')!, null, 'parent'));
    await page.evaluate((snapshot) => window.__hvyGalaxyInspector.start('target', {
      parentCssPath: '[data-record="first"]',
      parentSnapshot: snapshot,
      multiSelect: true,
    }), parentSnapshot);
    await clickPointerAt(page, '[data-record="first"] .posting-title');
    await page.locator('#hvy-galaxy-inspector-picker button', { hasText: 'h1 — Senior TypeScript Engineer' }).click();
    await page.getByRole('button', { name: 'Use range' }).click();
    await clickPointerAt(page, '[data-record="first"] .posting-meta');
    await page.locator('#hvy-galaxy-inspector-picker button', { hasText: 'p — Remote (US) · Full-time' }).click();
    await page.keyboard.press('Escape');

    // Escape leaves range mode, taking the range's start back.
    expect(await page.locator('[data-inspector-status-text]').textContent()).toBe('1 field selected');
    expect(await page.getByRole('button', { name: 'Use range' }).count()).toBe(1);
    expect(await page.locator('#hvy-galaxy-inspector-status').count()).toBe(1);
    expect(await page.locator('[data-collection-selection="true"]').count()).toBe(1);
    expect(pageErrors).toEqual([]);
  });

  it('shows how an item page pattern matches a page it failed on, to look at only: how close, which field failed, and Add as example', async () => {
    const posting = (description: string) => `
      <main>
        <article class="posting">
          <h1 class="title">Senior Engineer</h1>
          <p class="company">Acme</p>
          ${description}
        </article>
      </main>`;
    await page.setContent(posting('<div class="description"><p>Build secure services.</p><p>Run them well.</p></div>'));
    await page.evaluate(() => {
      delete (window as { __hvyGalaxyInspector?: InspectorApi }).__hvyGalaxyInspector;
      window.__hvyGalaxyHost = { ...window.__hvyGalaxyHost, publish: (value) => { window.__commandRecordingResult = value; } };
    });
    await page.addScriptTag({ content: inspectorSource });
    const pattern = await page.evaluate(() => {
      const parent = document.querySelector('.posting')!;
      const target = (selector: string) => window.__hvyGalaxyInspector.snapshotElement(parent.querySelector(selector)!, parent, 'target');
      return {
        minimumConfidence: 0.85,
        parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
        targets: [{ label: 'title', snapshot: target('.title') }, { label: 'company', snapshot: target('.company') }, { label: 'description', snapshot: target('.description') }],
      };
    });

    // A page laid out differently: no description where the examples had it.
    await page.setContent(posting('<aside class="apply"><a href="#apply">Apply</a></aside>'));
    await page.evaluate(() => {
      delete (window as { __hvyGalaxyInspector?: InspectorApi }).__hvyGalaxyInspector;
      window.__hvyGalaxyHost = { ...window.__hvyGalaxyHost, publish: (value) => { window.__commandRecordingResult = value; } };
    });
    await page.addScriptTag({ content: inspectorSource });
    await page.evaluate((existingPattern) => window.__hvyGalaxyInspector.start('parent', { existingPattern, matchingView: true, prompt: 'Job page' }), pattern);
    const status = page.locator('[data-inspector-status-text]');
    expect(await status.textContent()).toMatch(/^Job page · Closest \d+% \(needs 85%\)( · .*)? · description (not found|\d+% \(needs \d+%\))/);
    // The candidate is boxed as failing, and so is each of its fields, pass or fail.
    expect(await page.locator('[data-existing-match-kind="parent"][data-existing-match-status="fail"]').count()).toBeGreaterThan(0);
    expect(await page.locator('[data-existing-match-kind="target"][data-existing-match-label="title"][data-existing-match-status="pass"]').count()).toBe(1);

    // Clicking the page picks nothing.
    await clickPointerAt(page, '.posting .title');
    expect(await page.locator('#hvy-galaxy-inspector-picker').count()).toBe(0);
    expect(await page.evaluate(() => window.__commandRecordingResult)).toBeUndefined();

    await page.getByRole('button', { name: 'Add as example' }).click();
    expect(await page.evaluate(() => window.__commandRecordingResult)).toEqual({ kind: 'integration-matching-add-example' });
    expect(await page.locator('#hvy-galaxy-inspector-status').count()).toBe(0);
    expect(pageErrors).toEqual([]);
  });

  it('picks a label out of a line of them, or an element\'s own text without its children\'s, and reads every row that way', async () => {
    const row = (title: string, date: string, company: string, place: string) => `
      <article class="job">
        <div class="title">${title} <span class="date">${date}</span></div>
        <span class="meta">${company} · ${date} · ${place}</span>
      </article>`;
    await page.setContent(`<main>${row('Senior System Software Engineer', '3 months ago', 'Nvidia', 'Seattle, WA')}${row('Staff Engineer', '2 days ago', 'Acme', 'Remote, US')}
      <p class="prose">This long paragraph · with a dot in it ${'is prose, not a line of labels, '.repeat(20)}</p></main>`);
    await page.evaluate(() => {
      delete (window as { __hvyGalaxyInspector?: InspectorApi }).__hvyGalaxyInspector;
      window.__hvyGalaxyHost = { ...window.__hvyGalaxyHost, publish: (value) => { window.__commandRecordingResult = value; } };
    });
    await page.addScriptTag({ content: inspectorSource });
    const parentSnapshot = await page.evaluate(() => window.__hvyGalaxyInspector.snapshotElement(document.querySelector('.job')!, null, 'parent'));
    await page.evaluate((snapshot) => window.__hvyGalaxyInspector.start('target', { parentCssPath: '.job', parentSnapshot: snapshot, multiSelect: true }), parentSnapshot);
    const picker = page.locator('#hvy-galaxy-inspector-picker');

    // The title without its date: the element's own text.
    await clickPointerAt(page, '.job:first-of-type .title');
    // Hovered, it is boxed with the date it leaves out struck out.
    await picker.locator('button', { hasText: 'Text: Senior System Software Engineer' }).hover();
    expect(await page.locator('#hvy-galaxy-inspector-highlight [data-inspector-excluded]').count()).toBe(1);
    await picker.locator('button', { hasText: 'Text: Senior System Software Engineer' }).click();
    // The company and the place, each a part of the line (the place the last, counted from the end).
    await clickPointerAt(page, '.job:first-of-type .meta');
    expect(await picker.locator('[data-picker-part]').allTextContents()).toEqual(['Part 1 of 3: Nvidia', 'Part 2 of 3: 3 months ago', 'Part 3 of 3 (last): Seattle, WA']);
    // Hovered, a part is boxed alone: narrower than the line it is in.
    await picker.locator('button', { hasText: 'Part 1 of 3: Nvidia' }).hover();
    const partBox = (await page.locator('#hvy-galaxy-inspector-highlight').boundingBox())!;
    expect(await page.locator('#hvy-galaxy-inspector-highlight').textContent()).toBe('Part · Nvidia');
    expect(partBox.width).toBeLessThan((await page.locator('.job:first-of-type .meta').boundingBox())!.width / 2);
    await picker.locator('button', { hasText: 'Part 1 of 3: Nvidia' }).click();
    await clickPointerAt(page, '.job:first-of-type .meta');
    await picker.locator('button', { hasText: 'Part 3 of 3 (last): Seattle, WA' }).click();
    expect(await page.locator('[data-collection-selection="true"]').count()).toBe(3);
    await page.getByRole('button', { name: 'Done' }).click();
    const picked = (await page.evaluate(() => window.__commandRecordingResult as { items: Array<InspectorSnapshot & { textPart?: { index: number }; ownText?: boolean }> })).items;
    expect(picked.map((item) => ({ ownText: item.ownText ?? false, textPart: item.textPart ?? null }))).toEqual([
      { ownText: true, textPart: null }, { ownText: false, textPart: { index: 0, count: 3 } }, { ownText: false, textPart: { index: -1, count: 3 } },
    ]);

    // Every row read that way, the two parts of one element two fields.
    const values = await page.evaluate(({ parent, items }) => window.__hvyGalaxyInspector.extractPattern({
      parents: [parent],
      targets: items.map((item, index) => ({ label: ['title', 'company', 'place'][index], snapshot: item })),
    }).records.map((record) => record.targets.map((target) => target.value)), { parent: parentSnapshot, items: picked });
    expect(values).toEqual([['Senior System Software Engineer', 'Nvidia', 'Seattle, WA'], ['Staff Engineer', 'Acme', 'Remote, US']]);

    // On an item's own page, its fields are picked first and the box taken around them: they keep how they read.
    await page.evaluate(() => window.__hvyGalaxyInspector.start('target', { multiSelect: true, deriveParent: true }));
    await clickPointerAt(page, '.job:first-of-type .title');
    await picker.locator('button', { hasText: 'Text: Senior System Software Engineer' }).click();
    await clickPointerAt(page, '.job:first-of-type .meta');
    await picker.locator('button', { hasText: 'Part 3 of 3 (last): Seattle, WA' }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    const derived = (await page.evaluate(() => window.__commandRecordingResult as { parent: InspectorSnapshot; items: Array<{ textPart?: { index: number }; ownText?: boolean }> }));
    expect(derived.items.map((item) => ({ ownText: item.ownText ?? false, textPart: item.textPart ?? null }))).toEqual([{ ownText: true, textPart: null }, { ownText: false, textPart: { index: -1, count: 3 } }]);

    // Asked which field it is, the part picked is what is quoted, not the whole line.
    await page.evaluate((snapshot) => window.__hvyGalaxyInspector.start('target', { parentCssPath: '.job', parentSnapshot: snapshot, multiSelect: true, fieldChoices: [{ id: 'place', label: 'Location' }] }), parentSnapshot);
    await clickPointerAt(page, '.job:first-of-type .meta');
    await picker.locator('button', { hasText: 'Part 3 of 3 (last): Seattle, WA' }).click();
    expect(await page.locator('[data-inspector-status-text]').textContent()).toBe('Which field is this? “Seattle, WA”');

    // A long line of prose with a dot in it is not offered in parts.
    await page.evaluate(() => window.__hvyGalaxyInspector.start('target', { multiSelect: true }));
    await clickPointerAt(page, '.prose');
    expect(await picker.locator('[data-picker-part]').count()).toBe(0);
    expect(pageErrors).toEqual([]);
  });

  it('reads a line of labels that leaves one out: a part counted from the start is still there, the last of a different line is missing, and an example with as many parts reads it', async () => {
    const row = (meta: string) => `<article class="job"><h3 class="title">Engineer</h3><span class="meta">${meta}</span></article>`;
    await page.setContent(`<main>${row('Nvidia · 3 months ago · Seattle, WA · Remote')}${row('Acme · 2 days ago · Denver, CO')}</main>`);
    await page.addScriptTag({ content: inspectorSource });
    const read = (counts: number[][]) => page.evaluate((exampleParts) => {
      const first = document.querySelector('.job')!;
      const meta = first.querySelector('.meta')!;
      const snapshot = (textPart: { index: number; count: number }) => ({ ...window.__hvyGalaxyInspector.snapshotElement(meta, first, 'target'), textPart });
      // Each field's examples: [index, count] of the line it was picked in.
      const field = (label: string, examples: number[][]) => {
        const snapshots = examples.map(([index, count]) => snapshot({ index, count }));
        return { label, snapshot: snapshots[0], snapshots, optional: true };
      };
      return window.__hvyGalaxyInspector.extractPattern({
        parents: [window.__hvyGalaxyInspector.snapshotElement(first, null, 'parent')],
        targets: [field('company', [[0, 4]]), field('place', [[2, 4]]), field('remote', exampleParts)],
      }).records.map((record) => record.targets.map((target) => target.value));
    }, counts);
    // Picked on the four-part line, Remote the last: the three-part line has none, and its place is still its place.
    expect(await read([[-1, 4]])).toEqual([['Nvidia', 'Seattle, WA', 'Remote'], ['Acme', 'Denver, CO', null]]);
    // An example of a three-part line whose last part is the field: that line reads by it.
    expect((await read([[-1, 4], [-1, 3]]))[1]).toEqual(['Acme', 'Denver, CO', 'Denver, CO']);
    expect(pageErrors).toEqual([]);
  });

  it('offers an image, or what holds only an image, as an image; a section holding a logo among its text is offered as that text', async () => {
    await page.setContent(`
      <main>
        <article data-record="first">
          <a class="logo" href="#company"><img alt="Acme logo" width="40" height="40" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'/%3E"></a>
          <div class="body"><h2>Overview</h2><p>Acme builds secure services for regulated customers.</p><p>You will design and run them.</p></div>
        </article>
      </main>`);
    await page.addScriptTag({ content: inspectorSource });
    const parentSnapshot = await page.evaluate(() => window.__hvyGalaxyInspector.snapshotElement(document.querySelector('[data-record="first"]')!, null, 'parent'));
    await page.evaluate((snapshot) => window.__hvyGalaxyInspector.start('target', { parentCssPath: '[data-record="first"]', parentSnapshot: snapshot, multiSelect: true }), parentSnapshot);
    const picker = page.locator('#hvy-galaxy-inspector-picker');

    // The section's text is offered with its length, not as an image for the logo beside it.
    await clickPointerAt(page, '[data-record="first"] .body p:first-of-type');
    const choices = await picker.locator('[data-picker-choice]').allTextContents();
    expect(choices.some((choice) => choice.includes('🖼️'))).toBe(false);
    expect(choices.some((choice) => /^div\.body · \d+ characters/.test(choice))).toBe(true);

    // The logo is an image, and so is the link holding only it.
    await page.keyboard.press('Escape');
    await clickPointerAt(page, '[data-record="first"] .logo img');
    const logo = await picker.locator('[data-picker-choice]').allTextContents();
    expect(logo.some((choice) => choice.startsWith('🖼️ img'))).toBe(true);
    expect(pageErrors).toEqual([]);
  });

  it('takes a range\'s start back with Undo last, or Cancel range where nothing after it can end it, keeping the fields already picked', async () => {
    await page.setContent(sectionedPostings);
    await page.addScriptTag({ content: inspectorSource });
    const parentSnapshot = await page.evaluate(() => window.__hvyGalaxyInspector.snapshotElement(document.querySelector('[data-record="first"]')!, null, 'parent'));
    await page.evaluate((snapshot) => window.__hvyGalaxyInspector.start('target', {
      parentCssPath: '[data-record="first"]',
      parentSnapshot: snapshot,
      multiSelect: true,
    }), parentSnapshot);
    const status = page.locator('[data-inspector-status-text]');
    await clickPointerAt(page, '[data-record="first"] .posting-title');
    await page.locator('#hvy-galaxy-inspector-picker button', { hasText: 'h1 — Senior TypeScript Engineer' }).click();
    await page.getByRole('button', { name: 'Use range' }).click();
    await clickPointerAt(page, '[data-record="first"] .posting-meta');
    await page.locator('#hvy-galaxy-inspector-picker button', { hasText: 'p — Remote (US) · Full-time' }).click();
    expect(await status.textContent()).toBe('Pick where the range ends · Esc leaves range mode');

    // Undo last takes back the range's start, not the field before it, and stays in range mode.
    await page.getByRole('button', { name: 'Undo last' }).click();
    expect(await status.textContent()).toBe('Pick where the range starts · Esc leaves range mode');
    expect(await page.locator('[data-collection-selection="true"]').count()).toBe(1);

    // Clicked where nothing comes after the start: the picker offers to take the start back.
    await clickPointerAt(page, '[data-record="first"] .posting-meta');
    await page.locator('#hvy-galaxy-inspector-picker button', { hasText: 'p — Remote (US) · Full-time' }).click();
    await clickPointerAt(page, '[data-record="first"] .posting-title');
    expect(await page.locator('#hvy-galaxy-inspector-picker div').first().textContent()).toBe('Pick something after the start');
    await page.getByRole('button', { name: 'Cancel range' }).click();
    expect(await status.textContent()).toBe('Pick where the range starts · Esc leaves range mode');
    expect(await page.locator('#hvy-galaxy-inspector-picker').count()).toBe(0);

    // Pick element leaves range mode.
    await page.getByRole('button', { name: 'Pick element' }).click();
    expect(await status.textContent()).toBe('1 field selected');

    // Navigating the page, Use range goes back to picking, in range mode.
    await page.getByRole('button', { name: 'Navigate page' }).click();
    expect(await page.getByRole('button', { name: 'Resume picking' }).count()).toBe(1);
    await page.getByRole('button', { name: 'Use range' }).click();
    expect(await page.getByRole('button', { name: 'Navigate page' }).count()).toBe(1);
    expect(await status.textContent()).toBe('Pick where the range starts · Esc leaves range mode');
    await clickPointerAt(page, '[data-record="first"] .posting-meta');
    expect(await page.locator('#hvy-galaxy-inspector-picker div').first().textContent()).toBe('Choose where the range starts');
    expect(pageErrors).toEqual([]);
  });

  it('picks a range field\'s start or end again, keeping the other boundary', async () => {
    await page.setContent(sectionedPostings);
    await page.evaluate(() => {
      delete (window as { __hvyGalaxyInspector?: InspectorApi }).__hvyGalaxyInspector;
      window.__hvyGalaxyHost = { ...window.__hvyGalaxyHost, publish: (value) => { window.__commandRecordingResult = value; } };
    });
    await page.addScriptTag({ content: inspectorSource });
    const { parentSnapshot, rangeSnapshot } = await page.evaluate(() => {
      const parent = document.querySelector('[data-record="first"]')!;
      const target = (selector: string) => window.__hvyGalaxyInspector.snapshotElement(parent.querySelector(selector)!, parent, 'target');
      return {
        parentSnapshot: window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent'),
        rangeSnapshot: { ...target('.posting-meta'), range: { includeStart: false, includeEnd: false, end: target('.apply-button') } },
      };
    });
    const startEdit = (boundary: 'start' | 'end') => page.evaluate(([snapshot, range, which]) => window.__hvyGalaxyInspector.start('target', {
      parentCssPath: '[data-record="first"]',
      parentSnapshot: snapshot,
      rangeEdit: { boundary: which, snapshot: range },
    }), [parentSnapshot, rangeSnapshot, boundary] as const);
    const status = page.locator('[data-inspector-status-text]');
    const picker = page.locator('#hvy-galaxy-inspector-picker');
    const published = () => page.evaluate(() => window.__commandRecordingResult) as Promise<InspectorSnapshot>;

    // A new end: the start after the details line is kept.
    await startEdit('end');
    expect(await status.textContent()).toBe('Pick where the range ends');
    await clickPointerAt(page, '[data-record="first"] .similar a');
    expect(await picker.locator('div').first().textContent()).toBe('Choose where the range ends');
    await picker.locator('button', { hasText: 'a — Data Analyst' }).click();
    expect((await published()).selected.directText).toBe('· Full-time');
    expect((await published()).range).toMatchObject({ includeStart: false, includeEnd: true, end: { selected: { directText: 'Data Analyst' } } });

    // A new start: the end before Apply now is kept, and only what comes before it can start the range.
    await startEdit('start');
    expect(await status.textContent()).toBe('Pick where the range starts');
    await clickPointerAt(page, '[data-record="first"] .similar a');
    expect(await picker.locator('div').first().textContent()).toBe('Pick something before the end');
    await page.locator('#hvy-galaxy-inspector-picker').evaluate((element) => element.remove());
    await clickPointerAt(page, '[data-record="first"] h2:first-of-type');
    expect(await picker.locator('div').first().textContent()).toBe('Choose where the range starts');
    await picker.locator('button', { hasText: 'h2 — About the role' }).click();
    expect((await published()).selected.directText).toBe('About the role');
    expect((await published()).range).toMatchObject({
      includeStart: true,
      includeEnd: false,
      end: { selected: { directText: 'Apply now' } },
      summary: expect.stringMatching(/^Starts at “About the role” · Ends before “Apply now” · \d+ characters$/),
    });
    expect(await page.locator('#hvy-galaxy-inspector-status').count()).toBe(0);
    expect(pageErrors).toEqual([]);
  });

  it('reads a range field between its boundaries in each record, however many sections it has', async () => {
    await page.setContent(sectionedPostings);
    await page.addScriptTag({ content: inspectorSource });
    const pattern = await page.evaluate(() => {
      const parent = document.querySelector('[data-record="first"]')!;
      const target = (selector: string) => window.__hvyGalaxyInspector.snapshotElement(parent.querySelector(selector)!, parent, 'target');
      return {
        parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
        targets: [
          { label: 'title', snapshot: target('.posting-title') },
          { label: 'description', snapshot: { ...target('.posting-meta'), range: { includeStart: false, includeEnd: false, end: target('.apply-button') } } },
        ],
        minimumConfidence: 0.7,
      };
    });
    const result = await page.evaluate((value) => window.__hvyGalaxyInspector.extractPattern(value), pattern);

    // The closed posting has no Apply button, so its description has no end: it is missing rather than running on into
    // Similar jobs, and the field is required.
    expect(result.records.map((record) => record.targets.map((target) => target.value)), JSON.stringify(result.records, null, 2)).toEqual([
      ['Senior TypeScript Engineer', 'About the role\n\nBuild the dispatch console.\n\nResponsibilities\n\nOwn the route planning screens.\n\nMentor two engineers.'],
      ['Data Analyst', 'About the role\n\nTurn shipment data into reports.\n\nRequirements\n\nSQL and Python.\n\nBenefits\n\nLearning budget.'],
    ]);

    // Highlight matches boxes each range over its text, with its length.
    await page.evaluate((value) => window.__hvyGalaxyInspector.matchAndHighlight(value), pattern);
    const captions = await page.locator('#hvy-galaxy-pattern-matches [data-match-kind="target"] span').allTextContents();
    expect(captions.filter((caption) => caption.startsWith('description'))).toEqual([
      expect.stringMatching(/^description · \d+ characters$/),
      expect.stringMatching(/^description · \d+ characters$/),
    ]);
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

  it('looks for saved examples the live check missed in what the page adds afterwards, as a list loads more', async () => {
    // A page of its own: the inspector keeps the channel it found as it loaded.
    await page.close();
    page = await browser.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.setContent(`
      <main>
        <article class="message-card"><span class="value">Alpha</span></article>
        <ul id="later"><li class="compact-row" role="listitem"><button class="value">Beta</button></li></ul>
      </main>
    `);
    // Galaxy's channel, there before the inspector is.
    await page.evaluate(() => {
      const sent: unknown[] = [];
      (window as unknown as { __sent: unknown[] }).__sent = sent;
      window.__hvyGalaxyHost = { ...window.__hvyGalaxyHost, publish: (value) => { sent.push(value); } };
    });
    await page.addScriptTag({ content: inspectorSource });
    // The second example was saved from a row the page has not loaded yet.
    const published = await page.evaluate(async () => {
      const sent = (window as unknown as { __sent: unknown[] }).__sent;
      const firstParent = document.querySelector('.message-card')!;
      const secondParent = document.querySelector('.compact-row')!;
      const firstSnapshot = window.__hvyGalaxyInspector.snapshotElement(firstParent.querySelector('.value')!, firstParent, 'target');
      const secondSnapshot = window.__hvyGalaxyInspector.snapshotElement(secondParent.querySelector('.value')!, secondParent, 'target');
      const pattern = {
        parents: [window.__hvyGalaxyInspector.snapshotElement(firstParent, null, 'parent'), window.__hvyGalaxyInspector.snapshotElement(secondParent, null, 'parent')],
        targets: [{ label: 'VALUE', snapshot: firstSnapshot, exampleSnapshots: [firstSnapshot, secondSnapshot] }],
        scrollPage: false,
      };
      document.querySelector('#later')!.remove();
      await window.__hvyGalaxyInspector.extractAndPublish(pattern, { mode: 'examples', actionId: 'jobs-list' });
      return sent;
    }) as Array<{ kind: string; records: Array<{ targets: Array<{ value: unknown }> } | null> }>;
    expect(published.map((value) => [value.kind, value.records.map((record) => record?.targets[0].value ?? null)])).toEqual([['integration-extraction', ['Alpha', null]]]);

    // Something else added: nothing to tell.
    await page.evaluate(() => document.querySelector('main')!.insertAdjacentHTML('beforeend', '<p>Loading…</p>'));
    await page.waitForTimeout(700);
    expect(await page.evaluate(() => (window as unknown as { __sent: unknown[] }).__sent.length)).toBe(1);

    // The row loads: found in what was added, and told with the record type it is for.
    await page.evaluate(() => document.querySelector('main')!.insertAdjacentHTML('beforeend', '<ul><li class="compact-row" role="listitem"><button class="value">Beta</button></li></ul>'));
    await page.waitForTimeout(700);
    const update = await page.evaluate(() => (window as unknown as { __sent: unknown[] }).__sent[1]) as { kind: string; context: unknown; records: Array<{ targets: Array<{ value: unknown }> } | null> };
    expect(update.kind).toBe('integration-live-examples');
    expect(update.context).toEqual({ mode: 'live-examples', actionId: 'jobs-list' });
    expect(update.records.map((record) => record?.targets[0].value ?? null)).toEqual(['Alpha', 'Beta']);
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

  it('hides the matched records while the page scrolls, and draws them where they are once it pauses', async () => {
    await page.setContent(`
      <main class="scroller" style="height:160px;overflow:auto">
        <article class="row" style="height:90px"><b class="name">Alpha</b></article>
        <article class="row" style="height:90px"><b class="name">Beta</b></article>
        <article class="row" style="height:90px"><b class="name">Gamma</b></article>
      </main>
    `);
    await page.addScriptTag({ content: inspectorSource });
    await page.evaluate(() => {
      const parent = document.querySelector('.row')!;
      const existingPattern = {
        parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
        targets: [{ label: 'NAME', snapshot: window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('.name')!, parent, 'target') }],
      };
      window.__hvyGalaxyInspector.start('parent', { existingPattern });
    });
    const firstBox = page.locator('[data-existing-match-kind="parent"]').first();
    await expect.poll(() => firstBox.isVisible()).toBe(true);

    // The page tells of a scroll on its next frame.
    await page.locator('.scroller').evaluate(async (element) => {
      element.scrollTop = 60;
      await new Promise(requestAnimationFrame);
    });
    expect(await firstBox.isVisible()).toBe(false);

    await page.waitForTimeout(300);
    expect(await firstBox.isVisible()).toBe(true);
    expect((await firstBox.boundingBox())?.y).toBeCloseTo((await page.locator('.row').first().boundingBox())!.y, 0);
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

  it('limits identical record vectors to a vector-matched page section', async () => {
    await page.setContent(`
      <main>
        <section class="task-list"><h2>My Tasks</h2><article class="task"><span class="title">Alpha</span></article><article class="task"><span class="title">Beta</span></article></section>
        <section class="task-list"><h2>Todo</h2><article class="task"><span class="title">Gamma</span></article><article class="task"><span class="title">Delta</span></article></section>
      </main>
    `);
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(() => {
      const scope = document.querySelector('.task-list')!;
      const parent = scope.querySelector('.task')!;
      const record = {
        parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
        targets: [{ label: 'TITLE', snapshot: window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('.title')!, parent, 'target') }],
      };
      const scopeSnapshot = window.__hvyGalaxyInspector.snapshotElement(scope, parent, 'scope');
      return {
        scopeSnapshot,
        pageWide: window.__hvyGalaxyInspector.extractPattern(record),
        limited: window.__hvyGalaxyInspector.extractPattern({
          ...record,
          scope: scopeSnapshot,
        }),
      };
    });

    expect(result.scopeSnapshot.selected.scopeLabel).toBe('My Tasks');
    expect(JSON.stringify(result.scopeSnapshot.selected.shape)).not.toContain('My Tasks');
    expect(result.pageWide.records.map((record) => record.targets[0].value).sort()).toEqual(['Alpha', 'Beta', 'Delta', 'Gamma']);
    expect(result.limited.records.map((record) => record.targets[0].value)).toEqual(['Alpha', 'Beta']);
    expect(pageErrors).toEqual([]);
  });

  it('picks page sections from a stable local ancestor chain', async () => {
    await page.setContent('<main><section class="task-list"><h2>My Tasks</h2><article><span class="title">Alpha</span></article></section><section><h2>Todo</h2></section></main>');
    await page.addScriptTag({ content: inspectorSource });
    await page.evaluate(() => window.__hvyGalaxyInspector.start('parent', { scopeSelection: true }));
    await movePointerTo(page, '.title');

    expect(await page.locator('#hvy-galaxy-inspector-highlight').textContent()).toBe('section');
    expect((await page.locator('#hvy-galaxy-inspector-highlight').boundingBox())?.width).toBeCloseTo((await page.locator('.task-list').boundingBox())!.width, 0);
    await clickPointerAt(page, '.title');
    const choices = await page.locator('#hvy-galaxy-inspector-picker button').allTextContents();
    expect(choices[0]).toContain('My Tasks');
    expect(choices.some((choice) => choice.startsWith('html') || choice.startsWith('body'))).toBe(false);
    expect(pageErrors).toEqual([]);
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
    expect(await page.getByRole('button', { name: 'Limit to section' }).isVisible()).toBe(true);
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
    const result = await page.evaluate(async () => {
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
      const execution = await window.__hvyGalaxyInspector.executeCommand({
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

  it('rematches a record by content identity when list changes invalidate its parent path', async () => {
    await page.setContent(`<main>
      <article class="message"><span class="subject">First</span><button>Delete</button></article>
      <article class="message"><span class="subject">Second</span><button>Delete</button></article>
    </main>`);
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(async () => {
      const parents = [...document.querySelectorAll('.message')];
      const pattern = {
        minimumConfidence: 0.8,
        parents: [window.__hvyGalaxyInspector.snapshotElement(parents[0], null, 'parent')],
        targets: [{ label: 'SUBJECT', snapshot: window.__hvyGalaxyInspector.snapshotElement(parents[0].querySelector('.subject')!, parents[0], 'target') }],
      };
      const records = window.__hvyGalaxyInspector.extractPattern(pattern).records;
      const selected = records.find((record) => record.targets[0].value === 'Second')!;
      const recordIdentity = JSON.stringify(selected.targets.map((field) => [field.label, field.value]));
      const target = window.__hvyGalaxyInspector.snapshotElement(parents[0].querySelector('button')!, parents[0], 'target');
      const clicked: string[] = [];
      parents.forEach((parent) => parent.querySelector('button')!.addEventListener('click', () => clicked.push(parent.querySelector('.subject')!.textContent!)));
      const inserted = parents[0].cloneNode(true) as HTMLElement;
      inserted.querySelector('.subject')!.textContent = 'Inserted';
      inserted.querySelector('button')!.addEventListener('click', () => clicked.push('Inserted'));
      document.querySelector('main')!.prepend(inserted);

      const execution = await window.__hvyGalaxyInspector.executeCommand({
        pattern,
        command: { id: 'delete', scope: 'record', steps: [{ gesture: 'click', target }] },
        recordParent: selected.parent,
        recordIdentity,
      });
      return { execution, clicked };
    });

    expect(result.execution.status).toBe('executed');
    expect(result.clicked).toEqual(['Second']);
    expect(pageErrors).toEqual([]);
  });

  it('waits for page readiness and the requested record after refreshed content is restored', async () => {
    await page.setContent('<h1 class="ready-state">Ready</h1><main><article class="message"><span class="subject">First</span><button>Delete</button></article></main>');
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(async () => {
      const landmark = document.querySelector('.ready-state')!;
      const parent = document.querySelector('.message')!;
      const subject = parent.querySelector('.subject')!;
      const control = parent.querySelector('button')!;
      const pattern = {
        minimumConfidence: 0.8,
        parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
        targets: [{ label: 'SUBJECT', snapshot: window.__hvyGalaxyInspector.snapshotElement(subject, parent, 'target') }],
      };
      const recordParent = window.__hvyGalaxyInspector.extractPattern(pattern).records[0].parent;
      const target = window.__hvyGalaxyInspector.snapshotElement(control, parent, 'target');
      const readySnapshot = window.__hvyGalaxyInspector.snapshotElement(landmark, null, 'target');
      const replacementLandmark = landmark.cloneNode(true);
      const replacementParent = parent.cloneNode(true) as HTMLElement;
      let clicks = 0;
      replacementParent.querySelector('button')!.addEventListener('click', () => { clicks += 1; });
      landmark.remove();
      parent.remove();
      window.setTimeout(() => {
        document.body.prepend(replacementLandmark);
        document.querySelector('main')!.append(replacementParent);
      }, 100);

      const execution = await window.__hvyGalaxyInspector.executeCommand({
        pattern,
        command: { id: 'delete', scope: 'record', steps: [{ gesture: 'click', target }] },
        recordParent,
        readyChecks: {
          urlMode: 'strict-url',
          urlValue: location.href,
          elements: [{ id: 'ready', name: 'Ready state', snapshot: readySnapshot, expectedValue: 'Ready' }],
        },
      });
      return { execution, clicks };
    });

    expect(result.execution.status).toBe('executed');
    expect(result.clicks).toBe(1);
    expect(pageErrors).toEqual([]);
  });

  it('reports a changed record after its command mutates the page', async () => {
    await page.close();
    page = await browser.newPage();
    pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.setContent('<main><article class="message"><span class="status">Unread</span><button>Mark read</button></article></main>');
    await page.evaluate(() => {
      window.__hvyGalaxyHost = { ...window.__hvyGalaxyHost, publish: (value) => { window.__commandRecordingResult = value; } };
    });
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(async () => {
      const parent = document.querySelector('.message')!;
      const status = parent.querySelector('.status')!;
      const control = parent.querySelector('button')!;
      control.addEventListener('click', () => window.setTimeout(() => { status.textContent = 'Read'; }, 25));
      const pattern = {
        minimumConfidence: 0.8,
        parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
        targets: [{ label: 'STATUS', snapshot: window.__hvyGalaxyInspector.snapshotElement(status, parent, 'target') }],
      };
      const recordParent = window.__hvyGalaxyInspector.extractPattern(pattern).records[0].parent;
      const target = window.__hvyGalaxyInspector.snapshotElement(control, parent, 'target');
      const execution = await window.__hvyGalaxyInspector.executeCommand({
        requestId: 'watch-request',
        watchRecord: true,
        pattern,
        command: { id: 'mark-read', scope: 'record', steps: [{ gesture: 'click', target }] },
        recordParent,
      });
      for (let attempt = 0; attempt < 20 && !window.__commandRecordingResult; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 25));
      }
      return { execution, published: window.__commandRecordingResult };
    });

    expect(result.execution.status).toBe('executed');
    expect(result.published).toMatchObject({
      kind: 'integration-record-watch-result',
      requestId: 'watch-request',
      recordChange: {
        status: 'changed',
        record: { targets: [{ label: 'STATUS', value: 'Read' }] },
      },
    });
    expect(pageErrors).toEqual([]);
  });

  it('reports a removed record after its command removes the matched element', async () => {
    await page.close();
    page = await browser.newPage();
    pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.setContent('<main><article class="message"><span class="status">Active</span><button>Delete</button></article></main>');
    await page.evaluate(() => {
      window.__hvyGalaxyHost = { ...window.__hvyGalaxyHost, publish: (value) => { window.__commandRecordingResult = value; } };
    });
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(async () => {
      const parent = document.querySelector('.message')!;
      const status = parent.querySelector('.status')!;
      const control = parent.querySelector('button')!;
      control.addEventListener('click', () => parent.remove());
      const pattern = {
        minimumConfidence: 0.8,
        parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
        targets: [{ label: 'STATUS', snapshot: window.__hvyGalaxyInspector.snapshotElement(status, parent, 'target') }],
      };
      const recordParent = window.__hvyGalaxyInspector.extractPattern(pattern).records[0].parent;
      const target = window.__hvyGalaxyInspector.snapshotElement(control, parent, 'target');
      const execution = await window.__hvyGalaxyInspector.executeCommand({
        requestId: 'remove-request',
        watchRecord: true,
        pattern,
        command: { id: 'delete', scope: 'record', steps: [{ gesture: 'click', target }] },
        recordParent,
      });
      for (let attempt = 0; attempt < 20 && !window.__commandRecordingResult; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 25));
      }
      return { execution, published: window.__commandRecordingResult, recordParent };
    });

    expect(result.execution.status).toBe('executed');
    expect(result.published).toMatchObject({
      kind: 'integration-record-watch-result',
      requestId: 'remove-request',
      recordChange: { status: 'removed', previousParent: result.recordParent },
    });
    expect(pageErrors).toEqual([]);
  });

  it('dispatches a right-click command to a structurally resolved page target', async () => {
    await page.setContent('<main><button class="menu-control">Options</button></main>');
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(async () => {
      const target = document.querySelector('.menu-control')!;
      let contextMenus = 0;
      target.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        contextMenus += 1;
      });
      const snapshot = window.__hvyGalaxyInspector.snapshotElement(target, null, 'target');
      const execution = await window.__hvyGalaxyInspector.executeCommand({
        pattern: { minimumConfidence: 0.8, parents: [], targets: [] },
        command: { id: 'options', scope: 'page', steps: [{ gesture: 'right-click', target: snapshot }] },
      });
      return { execution, contextMenus };
    });

    expect(result.execution.status).toBe('executed');
    expect(result.contextMenus).toBe(1);
    expect(pageErrors).toEqual([]);
  });

  it('clicks the asked-for page number in the pager whose number was recorded, and finds none past its last', async () => {
    await page.setContent(`<main><ol class="results"><li>Job</li></ol><nav class="pager" aria-label="pagination"><ul>
      ${[1, 2, 3, 4, 5].map((number) => `<li><a href="#" data-testid="pagination-page-${number}" aria-label="${number}"${number === 1 ? ' aria-current="page"' : ''}>${number}</a></li>`).join('')}
      <li><a href="#" data-testid="pagination-page-next" aria-label="Next Page">›</a></li></ul></nav></main>`);
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(async () => {
      const clicked: string[] = [];
      document.querySelectorAll('.pager a').forEach((link) => link.addEventListener('click', (event) => {
        event.preventDefault();
        clicked.push(link.textContent ?? '');
      }));
      const snapshot = window.__hvyGalaxyInspector.snapshotElement(document.querySelector('[data-testid="pagination-page-2"]')!, null, 'target');
      const command = { id: 'pages', scope: 'page' as const, pagination: 'page-number' as const, steps: [{ gesture: 'click' as const, target: snapshot }] };
      const pattern = { minimumConfidence: 0.8, parents: [], targets: [] };
      const third = await window.__hvyGalaxyInspector.executeCommand({ pattern, command, pageNumber: 3 });
      const fifth = await window.__hvyGalaxyInspector.executeCommand({ pattern, command, pageNumber: 5 });
      const sixth = await window.__hvyGalaxyInspector.executeCommand({ pattern, command, pageNumber: 6 });
      return { third: third.status, fifth: fifth.status, sixth: sixth.status, clicked };
    });

    expect(result).toEqual({ third: 'executed', fifth: 'executed', sixth: 'no_match', clicked: ['3', '5'] });
    expect(pageErrors).toEqual([]);
  });

  it('shows picking in the browser\'s toolbar, off the page, with what it was asked to say, and takes its buttons', async () => {
    await page.setContent('<main><article class="job"><h1>Engineer</h1><p>Build things.</p></article></main>');
    await page.evaluate(() => {
      delete (window as { __hvyGalaxyInspector?: InspectorApi }).__hvyGalaxyInspector;
      window.__hvyGalaxyHost = { ...window.__hvyGalaxyHost, toolbarState: (value) => { window.__toolbarState = value; } };
    });
    await page.addScriptTag({ content: inspectorSource });
    await page.evaluate(() => window.__hvyGalaxyInspector.start('parent', { primary: true, externalToolbar: true, prompt: 'Pick the box around the whole job posting.' }));
    expect(await page.locator('#hvy-galaxy-inspector-status').count()).toBe(0);
    expect(await page.evaluate(() => window.__toolbarState)).toEqual({
      active: true,
      status: 'Pick the box around the whole job posting.',
      buttons: [{ id: 'navigate', label: 'Navigate page', primary: false, disabled: false }],
      fields: [],
    });

    await page.evaluate(() => window.__hvyGalaxyInspector.control('navigate'));
    await page.waitForFunction(() => (window.__toolbarState as { buttons: Array<{ label: string }> }).buttons[0].label === 'Resume picking');
    expect(await page.evaluate(() => (window.__toolbarState as { status: string }).status)).toBe('Page navigation enabled');
    expect(pageErrors).toEqual([]);
  });

  it('asks which way a list goes to its next page, in the toolbar, then picks it and says which', async () => {
    await page.setContent('<main><nav class="pager"><a href="#" class="next">Next</a></nav></main>');
    await page.evaluate(() => {
      delete (window as { __hvyGalaxyInspector?: InspectorApi }).__hvyGalaxyInspector;
      window.__hvyGalaxyHost = { ...window.__hvyGalaxyHost, publish: (value) => { window.__commandRecordingResult = value; } };
      window.__hvyGalaxyHost = { ...window.__hvyGalaxyHost, toolbarState: (value) => { window.__toolbarState = value; } };
    });
    await page.addScriptTag({ content: inspectorSource });
    await page.evaluate(() => window.__hvyGalaxyInspector.start('target', {
      externalToolbar: true,
      commandRecorder: {
        scope: 'page',
        pick: {
          question: 'How does this list go to its next page?',
          choices: [
            { pagination: 'next', label: 'Next link or button', gesture: 'click', prompt: 'Select the Next link or button.', confirm: 'Found it.' },
            { pagination: 'page-number', label: 'Page numbers', gesture: 'click', pageNumber: true, prompt: 'Select one of the page numbers.', confirm: 'Found it.' },
          ],
        },
      },
    }));
    type Toolbar = { status: string; buttons: Array<{ id: string; label: string }> };
    const toolbar = () => page.evaluate(() => window.__toolbarState as Toolbar);
    const press = async (label: string) => {
      const id = (await toolbar()).buttons.find((button) => button.label === label)!.id;
      await page.evaluate((buttonId) => window.__hvyGalaxyInspector.control(buttonId), id);
    };
    expect(await toolbar()).toMatchObject({ status: 'How does this list go to its next page?' });
    expect((await toolbar()).buttons.map((button) => button.label)).toEqual(['Next link or button', 'Page numbers', 'Cancel']);
    expect(await page.locator('#hvy-galaxy-inspector-status').count()).toBe(0);

    await press('Next link or button');
    await page.waitForFunction(() => (window.__toolbarState as Toolbar).status === 'Select the Next link or button.');
    expect((await toolbar()).buttons.map((button) => button.label)).toEqual(['Back', 'Pause to navigate', 'Cancel']);
    await clickPointerAt(page, '.next');
    await page.locator('#hvy-galaxy-inspector-picker button').filter({ hasText: 'a — Next' }).click();
    await page.waitForFunction(() => (window.__toolbarState as Toolbar).status === 'Found it.');
    await press('Use this');
    const recording = await page.evaluate(() => window.__commandRecordingResult as { kind: string; pagination: string; steps: unknown[] });
    expect(recording).toMatchObject({ kind: 'integration-command-recording', pagination: 'next' });
    expect(recording.steps).toHaveLength(1);
    expect(pageErrors).toEqual([]);
  });

  it('picks one of a pattern\'s records by what opens it, gives back both, and refuses a click outside them', async () => {
    // As a job board's row: the company's link first, then the job's.
    await page.setContent(`<main style="margin-top:140px"><ul class="rows">${['Data Analyst', 'Product Manager', 'Designer'].map((title, index) => `<li class="row" data-row="${index}"><a href="https://jobs.test/company/acme" class="company">Acme</a> <a href="https://jobs.test/jobs/${index}" class="open">${title}</a><p>Remote</p></li>`).join('')}</ul><p class="outside">Not a job</p></main>`);
    await page.evaluate(() => {
      delete (window as { __hvyGalaxyInspector?: InspectorApi }).__hvyGalaxyInspector;
      window.__hvyGalaxyHost = { ...window.__hvyGalaxyHost, publish: (value) => { window.__commandRecordingResult = value; } };
    });
    await page.addScriptTag({ content: inspectorSource });
    const rowsPattern = await page.evaluate(() => {
      const row = document.querySelector('[data-row="0"]')!;
      return {
        minimumConfidence: 0.8,
        parents: [window.__hvyGalaxyInspector.snapshotElement(row, null, 'parent')],
        targets: [
          { label: 'company', snapshot: window.__hvyGalaxyInspector.snapshotElement(row.querySelector('.company')!, row, 'target') },
          { label: 'title', snapshot: window.__hvyGalaxyInspector.snapshotElement(row.querySelector('.open')!, row, 'target') },
        ],
      };
    });
    const choose = () => page.evaluate((pattern) => window.__hvyGalaxyInspector.start('parent', {
      existingPattern: pattern,
      prompt: 'Click what opens a job',
      recordChoice: { refuse: 'Click what opens one of the jobs boxed in green.' },
    }), rowsPattern);
    type Choice = { kind: string; record: { targets: Array<{ label: string; value: unknown }> }; opener: { snapshot: InspectorSnapshot; href: string | null } };
    await choose();
    const status = page.locator('[data-inspector-status-text]');
    expect(await status.textContent()).toBe('Click what opens a job');
    // Only the jobs are boxed, not their fields.
    expect(await page.locator('[data-existing-match-kind="parent"]').count()).toBeGreaterThan(0);
    expect(await page.locator('[data-existing-match-kind="target"]').count()).toBe(0);

    await clickPointerAt(page, '.outside');
    expect(await status.textContent()).toBe('Click what opens one of the jobs boxed in green.');
    expect(await page.evaluate(() => window.__commandRecordingResult)).toBeUndefined();

    // Pointing at the job's link boxes it, and clicking it gives the row and the link it follows: the job's, not the company's.
    await movePointerTo(page, '[data-row="1"] .open');
    expect((await page.locator('#hvy-galaxy-inspector-highlight').boundingBox())?.width).toBeCloseTo((await page.locator('[data-row="1"] .open').boundingBox())!.width, 0);
    await clickPointerAt(page, '[data-row="1"] .open');
    const chosen = await page.evaluate(() => window.__commandRecordingResult as Choice);
    expect(chosen.kind).toBe('integration-record-choice');
    expect(chosen.record.targets.map((target) => target.value)).toEqual(['Acme', 'Product Manager']);
    expect(chosen.opener.href).toBe('https://jobs.test/jobs/1');
    expect(chosen.opener.snapshot.selected.shape.tag).toBe('a');
    expect(await page.locator('#hvy-galaxy-inspector-status').count()).toBe(0);

    // What has no link opens its item by its script: it is given back with none.
    await choose();
    await clickPointerAt(page, '[data-row="2"] p');
    expect((await page.evaluate(() => window.__commandRecordingResult as Choice)).opener).toMatchObject({ href: null, snapshot: { selected: { shape: { tag: 'p' } } } });
    expect(pageErrors).toEqual([]);
  });

  it('finds a list\'s opener in every row, and the link it follows, where a field\'s element is the same', async () => {
    await page.setContent(`<main><ul class="rows">${['Data Analyst', 'Product Manager'].map((title, index) => `<li class="row"><a href="https://jobs.test/company/acme" class="company">Acme</a> <a href="https://jobs.test/jobs/${index}" class="open">${title}</a></li>`).join('')}</ul></main>`);
    await page.addScriptTag({ content: inspectorSource });
    const records = await page.evaluate(() => {
      const row = document.querySelector('.row')!;
      const snapshot = (element: Element) => window.__hvyGalaxyInspector.snapshotElement(element, row, 'target');
      return window.__hvyGalaxyInspector.extractPattern({
        minimumConfidence: 0.8,
        parents: [window.__hvyGalaxyInspector.snapshotElement(row, null, 'parent')],
        targets: [{ label: 'company', snapshot: snapshot(row.querySelector('.company')!) }, { label: 'title', snapshot: snapshot(row.querySelector('.open')!) }],
        // The title is a field, and what opens the job too.
        opener: snapshot(row.querySelector('.open')!),
      }).records;
    });
    expect(records.map((record) => [record.targets.map((target) => target.value), record.opener?.href])).toEqual([
      [['Acme', 'Data Analyst'], 'https://jobs.test/jobs/0'],
      [['Acme', 'Product Manager'], 'https://jobs.test/jobs/1'],
    ]);
    expect(pageErrors).toEqual([]);
  });

  it('offers Wrong page while picking an item\'s fields, when asked, which gives the page back unread', async () => {
    await page.evaluate(() => {
      delete (window as { __hvyGalaxyInspector?: InspectorApi }).__hvyGalaxyInspector;
      window.__hvyGalaxyHost = { ...window.__hvyGalaxyHost, publish: (value) => { window.__commandRecordingResult = value; } };
    });
    await page.addScriptTag({ content: inspectorSource });
    await page.evaluate(() => window.__hvyGalaxyInspector.start('target', { multiSelect: true, deriveParent: true, wrongPage: true, fieldChoices: [{ id: 'title', label: 'Title' }] }));
    await page.locator('#hvy-galaxy-inspector-status button').filter({ hasText: 'Wrong page' }).click();
    expect(await page.evaluate(() => window.__commandRecordingResult)).toEqual({ kind: 'integration-wrong-page' });
    expect(await page.locator('#hvy-galaxy-inspector-status').count()).toBe(0);
    expect(pageErrors).toEqual([]);
  });

  it('records a page number as one click pick, without choosing an interaction or clicking it', async () => {
    await page.setContent(`<main><nav class="pager"><ul>
      ${[1, 2, 3].map((number) => `<li><a href="#" class="page-${number}">${number}</a></li>`).join('')}
      <li><a href="#" class="group-next" aria-label="Next">›</a></li></ul></nav></main>`);
    await page.evaluate(() => {
      delete (window as { __hvyGalaxyInspector?: InspectorApi }).__hvyGalaxyInspector;
      window.__hvyGalaxyHost = { ...window.__hvyGalaxyHost, publish: (value) => { window.__commandRecordingResult = value; } };
      (window as { __pagerClicks?: number }).__pagerClicks = 0;
      document.querySelectorAll('.pager a').forEach((link) => link.addEventListener('click', (event) => {
        event.preventDefault();
        (window as { __pagerClicks?: number }).__pagerClicks! += 1;
      }));
    });
    await page.addScriptTag({ content: inspectorSource });
    await page.evaluate(() => window.__hvyGalaxyInspector.start('target', {
      commandRecorder: { scope: 'page', pick: { gesture: 'click', pageNumber: true, prompt: 'Select one of the page numbers.', confirm: 'Found it.' } },
    }));
    const statusText = page.locator('[data-inspector-status-text]');
    expect(await statusText.textContent()).toBe('Select one of the page numbers.');
    expect(await page.getByRole('button', { name: 'Click', exact: true }).count()).toBe(0);

    await clickPointerAt(page, '.group-next');
    await page.locator('#hvy-galaxy-inspector-picker button').filter({ hasText: /^a — / }).first().click();
    expect(await statusText.textContent()).toBe('Pick one of the page numbers, such as 2.');
    expect(await page.getByRole('button', { name: 'Use this' }).count()).toBe(0);

    await page.getByRole('button', { name: 'Pick again' }).click();
    await clickPointerAt(page, '.page-2');
    await page.locator('#hvy-galaxy-inspector-picker button').filter({ hasText: 'a — 2' }).click();
    expect(await statusText.textContent()).toBe('Found it.');
    await page.getByRole('button', { name: 'Use this' }).click();

    const recording = await page.evaluate(() => window.__commandRecordingResult as { kind: string; steps: Array<{ gesture: string }> });
    expect(recording.kind).toBe('integration-command-recording');
    expect(recording.steps.map((step) => step.gesture)).toEqual(['click']);
    expect(await page.evaluate(() => (window as { __pagerClicks?: number }).__pagerClicks)).toBe(0);
    expect(pageErrors).toEqual([]);
  });

  it('dispatches a double-click command to a structurally resolved page target', async () => {
    await page.setContent('<main><button class="open-control">Open</button></main>');
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(async () => {
      const target = document.querySelector('.open-control')!;
      let doubleClicks = 0;
      target.addEventListener('dblclick', () => { doubleClicks += 1; });
      const snapshot = window.__hvyGalaxyInspector.snapshotElement(target, null, 'target');
      const execution = await window.__hvyGalaxyInspector.executeCommand({
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
    const result = await page.evaluate(async () => {
      const target = document.querySelector<HTMLInputElement>('.subject-control')!;
      const events: string[] = [];
      for (const name of ['beforeinput', 'input', 'change']) target.addEventListener(name, () => events.push(name));
      const snapshot = window.__hvyGalaxyInspector.snapshotElement(target, null, 'target');
      const execution = await window.__hvyGalaxyInspector.executeCommand({
        pattern: { minimumConfidence: 0.8, parents: [], targets: [] },
        command: { id: 'subject', scope: 'page', inputs: [{ id: 'subject', name: 'Subject', required: true }], steps: [{ gesture: 'type', target: snapshot, inputId: 'subject' }] },
        inputs: { subject: 'Project update' },
      });
      return { execution, value: target.value, events, focused: document.activeElement === target };
    });

    expect(result.execution.status).toBe('executed');
    expect(result.value).toBe('Project update');
    expect(result.events).toEqual(['beforeinput', 'input', 'change']);
    expect(result.focused).toBe(true);
    expect(pageErrors).toEqual([]);
  });

  it('reports the named input when a text parameter is missing', async () => {
    await page.setContent('<main><input class="subject-control"></main>');
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(async () => {
      const target = document.querySelector('.subject-control')!;
      const snapshot = window.__hvyGalaxyInspector.snapshotElement(target, null, 'target');
      return window.__hvyGalaxyInspector.executeCommand({
        pattern: { minimumConfidence: 0.8, parents: [], targets: [] },
        command: { id: 'subject', scope: 'page', inputs: [{ id: 'subject', name: 'Subject', required: true }], steps: [{ gesture: 'type', target: snapshot, inputId: 'subject' }] },
      });
    });

    expect(result).toMatchObject({ status: 'no_match', reason: 'command_input_missing', inputId: 'subject', stepIndex: 0, stepsExecuted: 0 });
    expect(pageErrors).toEqual([]);
  });

  it('selects a fixed native dropdown value and dispatches form events', async () => {
    await page.setContent('<main><label>List <select class="list-control"><option value="wrong">Wrong list</option><option value="correct">Correct list</option></select></label></main>');
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(async () => {
      const target = document.querySelector<HTMLSelectElement>('.list-control')!;
      const events: string[] = [];
      for (const name of ['input', 'change']) target.addEventListener(name, () => events.push(name));
      const snapshot = window.__hvyGalaxyInspector.snapshotElement(target, null, 'target');
      const execution = await window.__hvyGalaxyInspector.executeCommand({
        pattern: { minimumConfidence: 0.8, parents: [], targets: [] },
        command: { id: 'choose-list', scope: 'page', steps: [{ gesture: 'select', target: snapshot, value: 'correct', valueLabel: 'Correct list' }] },
      });
      return { execution, value: target.value, events };
    });

    expect(result.execution.status).toBe('executed');
    expect(result.value).toBe('correct');
    expect(result.events).toEqual(['input', 'change']);
    expect(pageErrors).toEqual([]);
  });

  it('selects a native dropdown value supplied at run time', async () => {
    await page.setContent('<main><select class="list-control"><option value="wrong">Wrong list</option><option value="correct">Correct list</option></select></main>');
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(async () => {
      const target = document.querySelector<HTMLSelectElement>('.list-control')!;
      const snapshot = window.__hvyGalaxyInspector.snapshotElement(target, null, 'target');
      const execution = await window.__hvyGalaxyInspector.executeCommand({
        pattern: { minimumConfidence: 0.8, parents: [], targets: [] },
        command: {
          id: 'choose-list',
          scope: 'page',
          inputs: [{ id: 'list', name: 'List', required: true, options: [{ value: 'wrong', label: 'Wrong list' }, { value: 'correct', label: 'Correct list' }] }],
          steps: [{ gesture: 'select', target: snapshot, inputId: 'list' }],
        },
        inputs: { list: 'correct' },
      });
      return { execution, value: target.value };
    });

    expect(result.execution.status).toBe('executed');
    expect(result.value).toBe('correct');
    expect(pageErrors).toEqual([]);
  });

  it('selects an option when its live status count changes after recording', async () => {
    await page.setContent('<main><select class="list-control"><option>My Tasks. 8 active tasks.</option><option selected>Todo. 37 active tasks.</option></select></main>');
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(async () => {
      const target = document.querySelector<HTMLSelectElement>('.list-control')!;
      const snapshot = window.__hvyGalaxyInspector.snapshotElement(target, null, 'target');
      target.options[0].textContent = 'My Tasks. 11 active tasks.';
      target.options[1].textContent = 'Todo. 35 active tasks.';
      const execution = await window.__hvyGalaxyInspector.executeCommand({
        pattern: { minimumConfidence: 0.8, parents: [], targets: [] },
        command: { id: 'choose-list', scope: 'page', steps: [{ gesture: 'select', target: snapshot, value: 'My Tasks. 8 active tasks.', valueLabel: 'My Tasks. 8 active tasks.' }] },
      });
      return { execution, value: target.value };
    });

    expect(result.execution.status).toBe('executed');
    expect(result.value).toBe('My Tasks. 11 active tasks.');
    expect(pageErrors).toEqual([]);
  });

  it('uses the changing-label vector when a recycled option value now points at the wrong list', async () => {
    await page.setContent('<main><select class="list-control"><option value="0">My Tasks. 11 active tasks.</option><option value="1" selected>Todo. 35 active tasks.</option></select></main>');
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(async () => {
      const target = document.querySelector<HTMLSelectElement>('.list-control')!;
      const snapshot = window.__hvyGalaxyInspector.snapshotElement(target, null, 'target');
      const execution = await window.__hvyGalaxyInspector.executeCommand({
        pattern: { minimumConfidence: 0.8, parents: [], targets: [] },
        command: { id: 'choose-list', scope: 'page', steps: [{ gesture: 'select', target: snapshot, value: '1', valueLabel: 'My Tasks. 8 active tasks.' }] },
      });
      return { execution, value: target.value, label: target.selectedOptions[0]?.textContent };
    });

    expect(result.execution.status).toBe('executed');
    expect(result.value).toBe('0');
    expect(result.label).toBe('My Tasks. 11 active tasks.');
    expect(pageErrors).toEqual([]);
  });

  it('prefers the user-facing label and form name when repeated combobox IDs and positions change', async () => {
    await page.setContent('<main><div role="dialog"><label for="project-1">Project</label><select id="project-1" name="project"><option>Wrong project</option></select><label for="list-1">List</label><select id="list-1" name="list"><option value="wrong">Wrong list</option><option value="correct">Correct list</option></select><label for="owner-1">Owner</label><select id="owner-1" name="owner"><option>Wrong owner</option></select></div></main>');
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(async () => {
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
      const target = document.querySelector<HTMLSelectElement>('[name="list"]')!;
      const snapshot = window.__hvyGalaxyInspector.snapshotElement(target, null, 'target');
      document.querySelector<HTMLLabelElement>('[for="list-1"]')!.htmlFor = 'generated-list-92';
      target.id = 'generated-list-92';
      const extraLabel = document.createElement('label');
      extraLabel.textContent = 'Workspace';
      const extra = document.createElement('select');
      extra.name = 'workspace';
      extra.append(new Option('Wrong workspace'));
      dialog.prepend(extraLabel, extra);
      const execution = await window.__hvyGalaxyInspector.executeCommand({
        pattern: { minimumConfidence: 0.8, parents: [], targets: [] },
        command: { id: 'choose-list', scope: 'page', steps: [{ gesture: 'select', target: snapshot, value: 'correct', valueLabel: 'Correct list' }] },
      });
      return { execution, value: target.value, shape: snapshot.selected.shape };
    });

    expect(result.execution.status).toBe('executed');
    expect(result.value).toBe('correct');
    expect(JSON.stringify(result.shape)).not.toContain('List');
    expect(JSON.stringify(result.shape)).not.toContain('list-1');
    expect(pageErrors).toEqual([]);
  });

  it('opens an ARIA combobox and selects its matching DOM option', async () => {
    await page.setContent('<main><button class="list-control" role="combobox" aria-haspopup="listbox">Wrong list</button><div class="options" role="listbox" hidden><button role="option">Wrong list</button><button role="option">Correct list</button></div></main>');
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(async () => {
      const target = document.querySelector<HTMLButtonElement>('.list-control')!;
      const options = document.querySelector<HTMLElement>('.options')!;
      target.addEventListener('click', () => { options.hidden = false; });
      options.querySelectorAll('[role="option"]').forEach((option) => option.addEventListener('click', () => {
        target.textContent = option.textContent;
        options.hidden = true;
      }));
      const snapshot = window.__hvyGalaxyInspector.snapshotElement(target, null, 'target');
      const execution = await window.__hvyGalaxyInspector.executeCommand({
        pattern: { minimumConfidence: 0.8, parents: [], targets: [] },
        command: { id: 'choose-list', scope: 'page', steps: [{ gesture: 'select', target: snapshot, value: 'Correct list', valueLabel: 'Correct list' }] },
      });
      return { execution, value: target.textContent };
    });

    expect(result.execution.status).toBe('executed');
    expect(result.value).toBe('Correct list');
    expect(pageErrors).toEqual([]);
  });

  it('operates a div and li JavaScript combobox entirely through clicks', async () => {
    await page.setContent('<main><div class="list-control" role="combobox" aria-haspopup="listbox" aria-controls="list-options" tabindex="0">Wrong list</div><ul id="list-options" role="listbox" hidden><li role="option">Wrong list</li><li role="option">Correct list</li></ul></main>');
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(async () => {
      const target = document.querySelector<HTMLElement>('.list-control')!;
      const listbox = document.querySelector<HTMLElement>('#list-options')!;
      let triggerClicks = 0;
      let optionClicks = 0;
      target.addEventListener('click', () => {
        triggerClicks += 1;
        target.setAttribute('aria-expanded', 'true');
        listbox.hidden = false;
      });
      listbox.querySelectorAll('[role="option"]').forEach((option) => option.addEventListener('click', () => {
        optionClicks += 1;
        target.textContent = option.textContent;
        target.setAttribute('aria-expanded', 'false');
        listbox.hidden = true;
      }));
      const snapshot = window.__hvyGalaxyInspector.snapshotElement(target, null, 'target');
      const execution = await window.__hvyGalaxyInspector.executeCommand({
        pattern: { minimumConfidence: 0.8, parents: [], targets: [] },
        command: { id: 'choose-list', scope: 'page', steps: [{ gesture: 'select', target: snapshot, value: 'Correct list', valueLabel: 'Correct list' }] },
      });
      return { execution, value: target.textContent, triggerClicks, optionClicks };
    });

    expect(result.execution.status).toBe('executed');
    expect(result.value).toBe('Correct list');
    expect(result.triggerClicks).toBe(1);
    expect(result.optionClicks).toBe(1);
    expect(pageErrors).toEqual([]);
  });

  it('clicks an ARIA input combobox option instead of assigning its input value', async () => {
    await page.setContent('<main><input class="list-control" role="combobox" aria-haspopup="listbox" aria-controls="list-options"><div id="list-options" role="listbox" hidden><div role="option">Correct list</div></div></main>');
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(async () => {
      const target = document.querySelector<HTMLInputElement>('.list-control')!;
      const listbox = document.querySelector<HTMLElement>('#list-options')!;
      let inputEvents = 0;
      let optionClicks = 0;
      target.addEventListener('input', () => { inputEvents += 1; });
      target.addEventListener('click', () => { listbox.hidden = false; });
      listbox.querySelector('[role="option"]')!.addEventListener('click', (event) => {
        optionClicks += 1;
        target.value = (event.currentTarget as HTMLElement).textContent || '';
        listbox.hidden = true;
      });
      const snapshot = window.__hvyGalaxyInspector.snapshotElement(target, null, 'target');
      const execution = await window.__hvyGalaxyInspector.executeCommand({
        pattern: { minimumConfidence: 0.8, parents: [], targets: [] },
        command: { id: 'choose-list', scope: 'page', steps: [{ gesture: 'select', target: snapshot, value: 'Correct list', valueLabel: 'Correct list' }] },
      });
      return { execution, value: target.value, inputEvents, optionClicks };
    });

    expect(result.execution.status).toBe('executed');
    expect(result.value).toBe('Correct list');
    expect(result.inputEvents).toBe(0);
    expect(result.optionClicks).toBe(1);
    expect(pageErrors).toEqual([]);
  });

  it('runs ordered steps and waits for targets revealed by earlier interactions', async () => {
    await page.setContent('<main><button class="compose-control">Compose</button><section class="draft"><input class="recipient-control"><button class="send-control">Send</button></section></main>');
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(async () => {
      const compose = document.querySelector<HTMLButtonElement>('.compose-control')!;
      const draft = document.querySelector<HTMLElement>('.draft')!;
      const recipient = draft.querySelector<HTMLInputElement>('.recipient-control')!;
      const send = draft.querySelector<HTMLButtonElement>('.send-control')!;
      const composeTarget = window.__hvyGalaxyInspector.snapshotElement(compose, null, 'target');
      const recipientTarget = window.__hvyGalaxyInspector.snapshotElement(recipient, null, 'target');
      const sendTarget = window.__hvyGalaxyInspector.snapshotElement(send, null, 'target');
      draft.remove();
      let sentValue = '';
      send.addEventListener('click', () => { sentValue = recipient.value; });
      compose.addEventListener('click', () => { window.setTimeout(() => document.querySelector('main')!.append(draft), 100); });
      const execution = await window.__hvyGalaxyInspector.executeCommand({
        pattern: { minimumConfidence: 0.8, parents: [], targets: [] },
        command: {
          id: 'compose',
          scope: 'page',
          inputs: [{ id: 'email', name: 'Email', required: true }],
          steps: [
            { gesture: 'click', target: composeTarget },
            { gesture: 'type', target: recipientTarget, inputId: 'email' },
            { gesture: 'click', target: sendTarget },
          ],
        },
        inputs: { email: 'ada@example.com' },
      });
      return { execution, sentValue };
    });

    expect(result.execution).toMatchObject({ status: 'executed', stepsExecuted: 3 });
    expect(result.sentValue).toBe('ada@example.com');
    expect(pageErrors).toEqual([]);
  });

  it('waits for a dropdown-triggered animation to settle before running the next step', async () => {
    await page.setContent('<main><select class="list-control"><option value="wrong">Wrong list</option><option value="correct">Correct list</option></select><button class="save-control">Save</button></main>');
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(async () => {
      const list = document.querySelector<HTMLSelectElement>('.list-control')!;
      const save = document.querySelector<HTMLButtonElement>('.save-control')!;
      const listTarget = window.__hvyGalaxyInspector.snapshotElement(list, null, 'target');
      const saveTarget = window.__hvyGalaxyInspector.snapshotElement(save, null, 'target');
      let selectionSettled = false;
      let clickedAfterSettle = false;
      list.addEventListener('change', () => {
        const animation = save.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 300 });
        void animation.finished.then(() => { selectionSettled = true; });
      });
      save.addEventListener('click', () => { clickedAfterSettle = selectionSettled; });
      const execution = await window.__hvyGalaxyInspector.executeCommand({
        pattern: { minimumConfidence: 0.8, parents: [], targets: [] },
        command: {
          id: 'choose-and-save',
          scope: 'page',
          steps: [
            { gesture: 'select', target: listTarget, value: 'correct', valueLabel: 'Correct list' },
            { gesture: 'click', target: saveTarget },
          ],
        },
      });
      return { execution, clickedAfterSettle };
    });

    expect(result.execution).toMatchObject({ status: 'executed', stepsExecuted: 2 });
    expect(result.clickedAfterSettle).toBe(true);
    expect(pageErrors).toEqual([]);
  });

  it('records, resolves, and performs a multi-step command without leaving the browser', async () => {
    await page.close();
    page = await browser.newPage();
    pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.setContent('<main><button class="reveal-control">Reveal field</button><section class="editor" hidden><input class="entry-control"></section></main>');
    await page.evaluate(() => {
      window.__hvyGalaxyHost = { ...window.__hvyGalaxyHost, publish: (value) => { window.__commandRecordingResult = value; } };
      document.querySelector('.reveal-control')!.addEventListener('click', () => {
        document.querySelector<HTMLElement>('.editor')!.hidden = false;
      });
    });
    await page.addScriptTag({ content: inspectorSource });
    await page.evaluate(() => window.__hvyGalaxyInspector.start('target', { commandRecorder: { scope: 'page' } }));

    await page.locator('#hvy-galaxy-inspector-status').getByRole('button', { name: 'Click', exact: true }).click();
    await clickPointerAt(page, '.reveal-control');
    await page.locator('#hvy-galaxy-inspector-picker button').first().click();
    await page.locator('#hvy-galaxy-inspector-status button', { hasText: 'Perform click' }).click();
    await expect.poll(() => page.locator('.editor').isVisible()).toBe(true);

    await page.locator('#hvy-galaxy-inspector-status button', { hasText: 'Add step' }).click();
    await page.locator('#hvy-galaxy-inspector-status button', { hasText: 'Enter text' }).click();
    await clickPointerAt(page, '.entry-control');
    await page.locator('#hvy-galaxy-inspector-picker button').first().click();
    await page.locator('#hvy-galaxy-inspector-status button', { hasText: 'Continue to sample' }).click();
    await page.locator('[data-command-recorder-input]').fill('Temporary verification value');
    await page.locator('#hvy-galaxy-inspector-status button', { hasText: 'Confirm typing' }).click();
    await expect.poll(() => page.locator('.entry-control').inputValue()).toBe('Temporary verification value');
    await page.locator('#hvy-galaxy-inspector-status button', { hasText: 'Finish recording' }).click();

    const recording = await page.evaluate(() => window.__commandRecordingResult);
    expect(recording).toMatchObject({
      kind: 'integration-command-recording',
      steps: [
        { gesture: 'click' },
        { gesture: 'type', inputId: 'input-1' },
      ],
    });
    expect(JSON.stringify(recording)).not.toContain('Temporary verification value');
    expect(pageErrors).toEqual([]);
  });

  it('records a native dropdown as a fixed option or run-time parameter', async () => {
    await page.close();
    page = await browser.newPage();
    pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.setContent('<main><div role="dialog"><label>Project <select class="list-control"><option>Wrong project</option></select></label><label>List <select class="list-control target"><option value="wrong">Wrong list</option><option value="correct">Correct list</option></select></label><label>Owner <select class="list-control"><option>Wrong owner</option></select></label></div></main>');
    await page.evaluate(() => { window.__hvyGalaxyHost = { ...window.__hvyGalaxyHost, publish: (value) => { window.__commandRecordingResult = value; } }; });
    await page.addScriptTag({ content: inspectorSource });
    await page.evaluate(() => window.__hvyGalaxyInspector.start('target', { commandRecorder: { scope: 'page' } }));

    await page.locator('#hvy-galaxy-inspector-status').getByRole('button', { name: 'Choose option', exact: true }).click();
    await clickPointerAt(page, '.list-control.target');
    await page.locator('#hvy-galaxy-inspector-picker button').first().click();
    await page.locator('#hvy-galaxy-inspector-status').getByRole('button', { name: 'Choose value', exact: true }).click();
    await page.locator('#hvy-galaxy-inspector-status [data-command-recorder-input]').selectOption('correct');
    await page.locator('#hvy-galaxy-inspector-status').getByRole('button', { name: 'Ask each run', exact: true }).click();
    await expect.poll(() => page.locator('.list-control.target').inputValue()).toBe('correct');
    await page.locator('#hvy-galaxy-inspector-status').getByRole('button', { name: 'Finish recording', exact: true }).click();

    expect(await page.evaluate(() => window.__commandRecordingResult)).toMatchObject({
      kind: 'integration-command-recording',
      steps: [{
        gesture: 'select',
        inputId: 'input-1',
        options: [{ value: 'wrong', label: 'Wrong list' }, { value: 'correct', label: 'Correct list' }],
      }],
    });
    expect(pageErrors).toEqual([]);
  });

  it('can finish recording a click without performing the destructive interaction', async () => {
    await page.close();
    page = await browser.newPage();
    pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.setContent('<main><button class="destructive-control">Clear task</button></main>');
    await page.evaluate(() => {
      window.__hvyGalaxyHost = { ...window.__hvyGalaxyHost, publish: (value) => { window.__commandRecordingResult = value; } };
      document.body.dataset.clickCount = '0';
      document.querySelector('.destructive-control')!.addEventListener('click', () => {
        document.body.dataset.clickCount = String(Number(document.body.dataset.clickCount) + 1);
      });
    });
    await page.addScriptTag({ content: inspectorSource });
    await page.evaluate(() => window.__hvyGalaxyInspector.start('target', { commandRecorder: { scope: 'page' } }));

    await page.locator('#hvy-galaxy-inspector-status').getByRole('button', { name: 'Click', exact: true }).click();
    await clickPointerAt(page, '.destructive-control');
    await page.locator('#hvy-galaxy-inspector-picker button').first().click();
    expect(await page.locator('#hvy-galaxy-inspector-status').getByRole('button', { name: 'Perform click', exact: true }).count()).toBe(1);
    await page.locator('#hvy-galaxy-inspector-status').getByRole('button', { name: 'Finish without clicking', exact: true }).click();

    expect(await page.locator('body').getAttribute('data-click-count')).toBe('0');
    expect(await page.evaluate(() => window.__commandRecordingResult)).toMatchObject({
      kind: 'integration-command-recording',
      steps: [{ gesture: 'click' }],
    });
    expect(pageErrors).toEqual([]);
  });

  it('only offers accepted record matches when scoping an item command', async () => {
    await page.setContent(mockInbox);
    await page.addScriptTag({ content: inspectorSource });
    await page.evaluate(() => {
      const parent = document.querySelector('[data-record="first"]')!;
      const subject = parent.querySelector('.subject')!;
      const pattern = {
        minimumConfidence: 0.8,
        parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
        targets: [{ label: 'Subject', snapshot: window.__hvyGalaxyInspector.snapshotElement(subject, parent, 'target') }],
      };
      window.__hvyGalaxyInspector.start('parent', {
        existingPattern: pattern,
        commandRecorder: { scope: 'record', pattern },
      });
    });

    await movePointerTo(page, '[data-record="second"] .subject');
    expect(await page.locator('#hvy-galaxy-inspector-highlight').textContent()).toBe('article');
    await clickPointerAt(page, '[data-record="second"] .subject');
    const choices = await page.locator('#hvy-galaxy-inspector-picker button').allTextContents();
    expect(choices).toHaveLength(1);
    expect(choices[0]).toContain('article');
    expect(choices[0]).toContain('.mail-row');
    expect(pageErrors).toEqual([]);
  });

  it('does not resolve a text-entry step to a non-editable target', async () => {
    await page.setContent('<main><button class="subject-control">Subject</button></main>');
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(async () => {
      const target = document.querySelector('.subject-control')!;
      const snapshot = window.__hvyGalaxyInspector.snapshotElement(target, null, 'target');
      return window.__hvyGalaxyInspector.executeCommand({
        pattern: { minimumConfidence: 0.8, parents: [], targets: [] },
        command: { id: 'subject', scope: 'page', inputs: [{ id: 'subject', name: 'Subject', required: true }], steps: [{ gesture: 'type', target: snapshot, inputId: 'subject' }] },
        inputs: { subject: 'Project update' },
      });
    });

    expect(result).toMatchObject({ status: 'no_match', reason: 'target_not_found' });
    expect(pageErrors).toEqual([]);
  });

  it('does not execute a page command when two targets are structurally tied', async () => {
    await page.setContent('<main><button class="menu-control">First</button><button class="menu-control">Second</button></main>');
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(async () => {
      const targets = [...document.querySelectorAll('.menu-control')];
      let clicks = 0;
      targets.forEach((target) => target.addEventListener('click', () => { clicks += 1; }));
      const snapshot = window.__hvyGalaxyInspector.snapshotElement(targets[0], null, 'target');
      const execution = await window.__hvyGalaxyInspector.executeCommand({
        pattern: { minimumConfidence: 0.8, parents: [], targets: [] },
        command: { id: 'ambiguous', scope: 'page', steps: [{ gesture: 'click', target: snapshot }] },
      });
      return { execution, clicks };
    });

    expect(result.execution.status).toBe('ambiguous');
    expect(result.clicks).toBe(0);
    expect(pageErrors).toEqual([]);
  });

  it('stops scanning once a fully rendered page satisfies the record limit', async () => {
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
        recordLimit: 7,
        parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
        targets: [{ label: 'EVENT', snapshot: window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('span')!, parent, 'target') }],
      });
      return { matches: extraction.matches, scrollEvents, decoyScrollEvents, finalTop: scroller.scrollTop };
    });

    expect(result.matches).toBe(7);
    expect(result.scrollEvents).toBeLessThanOrEqual(1);
    expect(result.decoyScrollEvents).toBe(0);
    expect(result.finalTop).toBe(0);
    expect(pageErrors).toEqual([]);
  });

  it('does not move the page when scrolling is disabled for loaded records', async () => {
    await page.setContent(`<main class="events" style="height:160px;overflow:auto">${Array.from({ length: 20 }, (_, index) => `<article class="event" style="height:42px"><span>Event ${index + 1}</span></article>`).join('')}</main>`);
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(async () => {
      const scroller = document.querySelector<HTMLElement>('.events')!;
      const parent = scroller.querySelector('.event')!;
      scroller.scrollTop = 160;
      await new Promise(requestAnimationFrame);
      const initialTop = scroller.scrollTop;
      let scrollEvents = 0;
      scroller.addEventListener('scroll', () => { scrollEvents += 1; });
      const extraction = await window.__hvyGalaxyInspector.extractAcrossPage({
        minimumConfidence: 0.8,
        recordLimit: 7,
        scrollPage: false,
        parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
        targets: [{ label: 'EVENT', snapshot: window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('span')!, parent, 'target') }],
      });
      return { matches: extraction.matches, initialTop, finalTop: scroller.scrollTop, scrollEvents };
    });

    expect(result.matches).toBe(7);
    expect(result.finalTop).toBe(result.initialTop);
    expect(result.scrollEvents).toBe(0);
    expect(pageErrors).toEqual([]);
  });

  it('waits for live page landmarks before fetching records', async () => {
    await page.setContent('<main><h1>Inbox</h1><article><span>Message</span></article></main>');
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(async () => {
      const inspector = window.__hvyGalaxyInspector;
      const heading = document.querySelector('h1')!;
      const parent = document.querySelector('article')!;
      const snapshot = inspector.snapshotElement(heading, null, 'target');
      const pattern = { scrollPage: false, parents: [inspector.snapshotElement(parent, null, 'parent')], targets: [{ label: 'Subject', snapshot: inspector.snapshotElement(parent.querySelector('span')!, parent, 'target') }] };
      heading.textContent = 'Loading';
      window.__hvyGalaxyHost = { ...window.__hvyGalaxyHost, publish: () => undefined };
      setTimeout(() => { heading.textContent = 'Inbox'; }, 150);
      return inspector.extractAndPublish(pattern, { readyChecks: { urlMode: 'strict-url', urlValue: location.href, elements: [{ id: 'inbox', name: 'Inbox', snapshot, expectedValue: 'Inbox' }] } });
    });
    expect(result.matches).toBe(1);
    expect(result.status).not.toBe('not-ready');
  });

  it('discards records when the live page changes during scrolling', async () => {
    await page.route('**/__record-navigation-test.html', (route) => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
    await page.goto(`${viteUrl}/__record-navigation-test.html`);
    await page.evaluate(() => {
      window.__readyCheckResult = [];
      window.__hvyGalaxyHost = { ...window.__hvyGalaxyHost, publish: (value) => { (window.__readyCheckResult as unknown[]).push(value); } };
    });
    await page.setContent(`<main style="height:160px;overflow:auto">${Array.from({ length: 60 }, (_, index) => `<article style="height:42px"><span>Message ${index}</span></article>`).join('')}</main>`);
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(async () => {
      const inspector = window.__hvyGalaxyInspector;
      const parent = document.querySelector('article')!;
      const operation = inspector.extractAndPublish({ parents: [inspector.snapshotElement(parent, null, 'parent')], targets: [{ label: 'Subject', snapshot: inspector.snapshotElement(parent.querySelector('span')!, parent, 'target') }] }, {
        readyChecks: { urlMode: 'strict-domain', urlValue: location.hostname, elements: [] },
      });
      setTimeout(() => history.pushState({}, '', '/another-page'), 50);
      const extraction = await operation;
      return { extraction, published: window.__readyCheckResult };
    });
    expect(result.extraction).toMatchObject({ status: 'not-ready', records: [] });
    expect(result.published).toEqual([expect.objectContaining({ status: 'not-ready', records: [], message: 'The browser page changed while fetching records.' })]);
  });

  it('stops an in-progress page extraction without publishing partial records', async () => {
    await page.setContent(`<main class="events" style="height:120px;overflow:auto">${Array.from({ length: 60 }, (_, index) => `<article class="event" style="height:42px"><span>Event ${index + 1}</span></article>`).join('')}</main>`);
    await page.addScriptTag({ content: inspectorSource });
    const result = await page.evaluate(async () => {
      const scroller = document.querySelector<HTMLElement>('.events')!;
      const parent = scroller.querySelector('.event')!;
      let published = false;
      window.__hvyGalaxyHost = { ...window.__hvyGalaxyHost, publish: () => { published = true; } };
      const operation = window.__hvyGalaxyInspector.extractAndPublish({
        minimumConfidence: 0.8,
        parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
        targets: [{ label: 'EVENT', snapshot: window.__hvyGalaxyInspector.snapshotElement(parent.querySelector('span')!, parent, 'target') }],
      }, {
        readyChecks: { urlMode: 'strict-url', urlValue: location.href, elements: [] },
      });
      window.setTimeout(() => window.__hvyGalaxyInspector.cancelExtraction(), 50);
      const extraction = await operation;
      return { extraction, published, scrollTop: scroller.scrollTop };
    });

    expect(result.extraction).toMatchObject({ status: 'cancelled', matches: 0, records: [] });
    expect(result.published).toBe(false);
    expect(result.scrollTop).toBe(0);
    expect(pageErrors).toEqual([]);
  });

  it('does not return the same positioned record twice when its extracted value changes between scroll passes', async () => {
    await page.setContent('<main class="events" style="height:160px;overflow:auto"><article class="event" style="height:42px"><span>Event initial</span></article><div style="height:1200px"></div></main>');
    await page.addScriptTag({ content: inspectorSource });
    const extraction = await page.evaluate(async () => {
      const scroller = document.querySelector<HTMLElement>('.events')!;
      const parent = scroller.querySelector<HTMLElement>('.event')!;
      const value = parent.querySelector('span')!;
      scroller.addEventListener('scroll', () => {
        value.textContent = scroller.scrollTop > 0 ? `Event pass ${Math.round(scroller.scrollTop)}` : 'Event initial';
      });
      return window.__hvyGalaxyInspector.extractAcrossPage({
        minimumConfidence: 0.8,
        parents: [window.__hvyGalaxyInspector.snapshotElement(parent, null, 'parent')],
        targets: [{ label: 'EVENT', snapshot: window.__hvyGalaxyInspector.snapshotElement(value, parent, 'target') }],
      });
    });

    expect(extraction.matches).toBe(1);
    expect(extraction.records).toHaveLength(1);
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
