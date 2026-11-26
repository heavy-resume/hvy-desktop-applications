import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

describe('integration WebMCP, run once in the page for each request', () => {
  let browser: Browser;
  let page: Page;
  let server: Server;
  let origin: string;
  let polyfill: string;
  let bridge: string;

  beforeAll(async () => {
    polyfill = await readFile(fileURLToPath(new URL('../node_modules/@mcp-b/webmcp-polyfill/dist/index.iife.js', import.meta.url)), 'utf8');
    bridge = await readFile(fileURLToPath(new URL('./integration-webmcp-bridge.js', import.meta.url)), 'utf8');
    server = createServer((request, response) => {
      response.setHeader('content-type', 'text/html');
      if (request.url === '/child') {
        response.end(`<script>document.modelContext.registerTool({name:'child.read',description:'Read from a child frame',inputSchema:{type:'object'},annotations:{readOnlyHint:true},execute:()=>({child:true})})</script>`);
        return;
      }
      if (request.url === '/delayed') {
        response.end(`<script>setTimeout(() => document.modelContext.registerTool({name:'late.read',description:'Registered after page load',inputSchema:{type:'object'},annotations:{readOnlyHint:true},execute:()=>({late:true})}), 100)</script>`);
        return;
      }
      if (request.url === '/plain') {
        response.end('<!doctype html><h1>No WebMCP here</h1>');
        return;
      }
      response.end(`<!doctype html><form toolname="form.submit" tooldescription="Submit the form" toolautosubmit><label>Message<input name="message" required></label><button type="submit">Submit</button></form><iframe src="/child"></iframe><script>
        document.querySelector('form').addEventListener('submit', event => { if (event.agentInvoked) { event.preventDefault(); event.respondWith({ submitted: event.target.elements.message.value }); } });
        window.__toolChangeCount = 0;
        document.modelContext.addEventListener('toolchange', () => { window.__toolChangeCount += 1; });
        document.modelContext.registerTool({name:'account.read',title:'Read account',description:'Read account data',inputSchema:{type:'object',properties:{id:{type:'string'}}},outputSchema:{type:'object',properties:{id:{type:'string'},ok:{type:'boolean'}}},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:args=>({id:args.id,ok:true})});
        document.modelContext.registerTool({name:'slow.action',description:'Wait until cancelled',inputSchema:{type:'object'},execute:()=>new Promise(resolve=>setTimeout(()=>resolve('late'),10000))});
        document.modelContext.registerTool({name:'text.read',description:'Return plain text',inputSchema:{type:'object'},annotations:{readOnlyHint:true},execute:()=> 'plain text'});
        document.modelContext.registerTool({name:'large.read',description:'Return an oversized result',inputSchema:{type:'object'},annotations:{readOnlyHint:true},execute:()=> 'x'.repeat(1024 * 1024 + 1)});
        window.__registerDynamicTool = () => document.modelContext.registerTool({name:'dynamic.read',description:'Dynamically registered',inputSchema:{type:'object'},annotations:{readOnlyHint:true},execute:()=>({dynamic:true})});
      </script>`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture server did not bind.');
    origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    await page.addInitScript(polyfill);
    await page.goto(origin);
    await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.readyState === 'complete');
  });

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  // A request, as a host runs it: once, in the page's world, its result the script's.
  function run(target: Page, operation: 'discover' | 'invoke', request: Record<string, unknown>): Promise<Record<string, unknown>> {
    return target.evaluate(({ source, operation, request }) => (0, eval)(source)(operation, request), { source: bridge, operation, request });
  }

  let discovered: Record<string, unknown>;
  const tool = (name: string) => (discovered.tools as Array<Record<string, unknown>>).find((candidate) => candidate.name === name)!;
  const call = (target: Page, descriptor: Record<string, unknown>, request: Record<string, unknown> = {}) => run(target, 'invoke', { name: descriptor.name, origin: descriptor.origin, descriptor, arguments: {}, ...request });

  it('discovers imperative, declarative, and same-origin descendant tools', async () => {
    discovered = await run(page, 'discover', { requestId: 'discover', focusMainOnResult: true });
    expect(discovered).toMatchObject({ kind: 'integration-webmcp-tools', requestId: 'discover', focusMainOnResult: true });
    expect((discovered.tools as Array<{ name: string }>).map((candidate) => candidate.name)).toEqual(expect.arrayContaining(['account.read', 'form.submit', 'child.read']));
  });

  it('leaves nothing of its own in the page', async () => {
    expect(await page.evaluate(() => Object.getOwnPropertyNames(window).filter((key) => /hvy|galaxy/i.test(key)))).toEqual([]);
  });

  it('invokes JSON and declarative tools and rejects changed descriptors', async () => {
    expect((await call(page, tool('account.read'), { requestId: 'read', arguments: { id: '42' } })).value).toEqual({ id: '42', ok: true });
    expect(await call(page, tool('text.read'), { requestId: 'text' })).toMatchObject({ value: 'plain text', isJson: false });
    expect((await call(page, tool('form.submit'), { requestId: 'form', arguments: { message: 'hello' } })).value).toEqual({ submitted: 'hello' });
    expect(await call(page, { ...tool('account.read'), description: 'Changed' }, { requestId: 'stale' })).toMatchObject({ kind: 'integration-webmcp-error', requestId: 'stale', code: 'WebMcpDescriptorChangedError' });
  });

  it('rediscovers dynamically registered tools after toolchange', async () => {
    const before = await page.evaluate(() => (window as unknown as { __toolChangeCount: number }).__toolChangeCount);
    await page.evaluate(() => (window as unknown as { __registerDynamicTool(): Promise<unknown> }).__registerDynamicTool());
    await page.waitForFunction((count) => (window as unknown as { __toolChangeCount: number }).__toolChangeCount > count, before);
    const again = await run(page, 'discover', { requestId: 'dynamic' });
    expect((again.tools as Array<{ name: string }>).some((candidate) => candidate.name === 'dynamic.read')).toBe(true);
  });

  it('waits for an asynchronously registered tool during initial page discovery', async () => {
    const delayedPage = await browser.newPage();
    await delayedPage.addInitScript(polyfill);
    await delayedPage.goto(`${origin}/delayed`);
    expect(await run(delayedPage, 'discover', { requestId: 'wait-for-tool', waitForTools: true })).toMatchObject({
      kind: 'integration-webmcp-tools',
      tools: [expect.objectContaining({ name: 'late.read' })],
    });
    await delayedPage.close();
  });

  it('waits for an asynchronously registered tool before invoking on a fresh page', async () => {
    const delayedPage = await browser.newPage();
    await delayedPage.addInitScript(polyfill);
    await delayedPage.goto(`${origin}/delayed`);
    const descriptor = {
      origin,
      name: 'late.read',
      description: 'Registered after page load',
      inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
    };
    expect(await call(delayedPage, descriptor, { requestId: 'wait-for-invocation-tool', waitForTools: true })).toMatchObject({ kind: 'integration-webmcp-result', value: { late: true } });
    await delayedPage.close();
  });

  it('rejects output beyond the limit', async () => {
    expect(await call(page, tool('large.read'), { requestId: 'large' })).toMatchObject({ kind: 'integration-webmcp-error', message: 'The WebMCP tool result exceeded the 1 MB limit.' });
  });

  it('says when the page has no WebMCP', async () => {
    const plainPage = await browser.newPage();
    await plainPage.goto(`${origin}/plain`);
    expect(await run(plainPage, 'discover', { requestId: 'none' })).toMatchObject({ kind: 'integration-webmcp-error', requestId: 'none', message: 'This page does not provide a WebMCP model context.' });
    await plainPage.close();
  });

  it("uses the browser's own WebMCP as it is, finding tools across origins and passing arguments unchanged", async () => {
    const nativePage = await browser.newPage();
    // The browser's own functions print as native code, as bound functions do.
    await nativePage.addInitScript(`
      window.__nativeContext={
        getTools: (async options => options?.fromOrigins?.length ? [{origin:'https://tools.example',name:'native.read',description:'Native cross-origin tool',inputSchema:{type:'object'},outputSchema:{type:'object',properties:{native:{type:'boolean'}}},annotations:{readOnlyHint:true}}] : []).bind(null),
        executeTool: (async (_tool, input) => { window.__nativeInput = input; return JSON.stringify({native:true}); }).bind(null),
      };
      Object.defineProperty(Document.prototype, 'modelContext', { configurable:true, get:() => window.__nativeContext });
    `);
    await nativePage.goto(`${origin}/plain`);
    const nativeResult = await run(nativePage, 'discover', { requestId: 'native', fromOrigins: ['https://tools.example'] });
    const nativeTool = (nativeResult.tools as Array<Record<string, unknown>>)[0];
    expect(nativeTool).toMatchObject({ origin: 'https://tools.example', name: 'native.read', outputSchema: { type: 'object', properties: { native: { type: 'boolean' } } } });
    expect(await call(nativePage, nativeTool, { requestId: 'native-call', fromOrigins: ['https://tools.example'], arguments: { id: '42' } })).toMatchObject({ kind: 'integration-webmcp-result', value: { native: true } });
    expect(await nativePage.evaluate(() => (window as unknown as { __nativeInput: unknown }).__nativeInput)).toEqual({ id: '42' });
    await nativePage.close();
  });
});
