import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const inspectorSource = fs.readFileSync(new URL('./integration-inspector.js', import.meta.url), 'utf8');
const guideSource = fs.readFileSync(new URL('../src-tauri/resources/hvy-guide.hvy', import.meta.url), 'utf8');
const resumeSource = fs.readFileSync('/Users/jameshutchison/git/heavy-file-format/examples/resume.hvy', 'utf8');
const guideTitles = ['Text', 'Image', 'Carousel', 'Table', 'Reference', 'Container', 'List', 'Grid', 'Expandable', 'Plugin', 'Custom'];
const projectSkills = ['Reverse Engineering', 'Library Development', 'LLM Prompt Engineering', 'Project Management'];

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
  start(kind: 'parent' | 'target', options?: { primary?: boolean; parentCssPath?: string }): void;
  snapshotElement(element: Element, parent?: Element | null, kind?: 'parent' | 'target'): InspectorSnapshot;
  matchAndHighlight(pattern: { parents: InspectorSnapshot[]; targets: Array<{ label: string; snapshot: InspectorSnapshot }> }): {
    matches: number;
    details: Array<{ parent: string; score: number; relationshipScore: number }>;
  };
  extractPattern(pattern: { parents: InspectorSnapshot[]; targets: Array<{ label: string; snapshot: InspectorSnapshot }> }): {
    matches: number;
    records: Array<{
      parent: string;
      score: number;
      targets: Array<{ label: string; element: string; value: string }>;
    }>;
  };
  selectBestRecords(records: ReturnType<InspectorApi['extractPattern']>['records']): ReturnType<InspectorApi['extractPattern']>;
}

declare global {
  interface Window {
    __hvyGalaxyInspector: InspectorApi;
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
    await page.locator('[data-record="first"] .subject').hover();

    expect(await page.locator('#hvy-galaxy-inspector-status').textContent()).toBe('Galaxy: select a parent');
    expect(await page.locator('#hvy-galaxy-inspector-highlight').count()).toBe(1);

    await page.locator('[data-record="first"] .subject').click();
    expect(await page.locator('#hvy-galaxy-inspector-picker').textContent()).toContain('Choose the parent containing one complete item');
    await page.locator('#hvy-galaxy-inspector-picker button').filter({ hasText: 'article' }).click();

    expect(await page.locator('#hvy-galaxy-inspector-picker').count()).toBe(0);
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

  it('learns a component-title vector from the virtualized Guide and finds and scrolls to every title', async () => {
    await page.goto(`${viteUrl}/__guide-vector-test.html`);
    await page.evaluate(async (source) => {
      const hvy = await (0, eval)('import("/@fs/Users/jameshutchison/git/heavy-file-format/src/embed-full.ts")');
      const documentModel = hvy.deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy');
      hvy.mountHvy({
        root: document.querySelector('#guide-root') as HTMLElement,
        document: documentModel,
        mode: 'viewer',
        controls: false,
      });
    }, guideSource);
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
    await page.evaluate(async (source) => {
      const hvy = await (0, eval)('import("/@fs/Users/jameshutchison/git/heavy-file-format/src/embed-full.ts")');
      const documentModel = hvy.deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy');
      hvy.mountHvy({
        root: document.querySelector('#guide-root') as HTMLElement,
        document: documentModel,
        mode: 'viewer',
        controls: false,
      });
    }, resumeSource);
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
      const pattern = { parents: [parentSnapshot], targets: [{ label: 'SKILL', snapshot: titleSnapshot }] };
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
