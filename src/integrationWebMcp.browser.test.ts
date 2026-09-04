import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

describe('integration WebMCP page bridge', () => {
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
      response.end(`<!doctype html><form toolname="form.submit" tooldescription="Submit the form" toolautosubmit><label>Message<input name="message" required></label><button type="submit">Submit</button></form><iframe src="/child"></iframe><script>
        document.querySelector('form').addEventListener('submit', event => { if (event.agentInvoked) { event.preventDefault(); event.respondWith({ submitted: event.target.elements.message.value }); } });
        window.__toolChangeCount = 0;
        document.modelContext.addEventListener('toolchange', () => { window.__toolChangeCount += 1; });
        document.modelContext.registerTool({name:'account.read',title:'Read account',description:'Read account data',inputSchema:{type:'object',properties:{id:{type:'string'}}},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:args=>({id:args.id,ok:true})});
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
    await page.addInitScript(`window.__webMcpResults=[]; window.__hvyGalaxyPublish=value=>window.__webMcpResults.push(value); window.__hvyGalaxyNativeWebMcp = typeof document.modelContext?.getTools === 'function';\n${polyfill}\n${bridge}`);
    await page.goto(origin);
    await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.readyState === 'complete');
  });

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  async function result(requestId: string): Promise<Record<string, unknown>> {
    await page.waitForFunction((id) => (window as unknown as { __webMcpResults: Array<{ requestId?: string }> }).__webMcpResults.some((item) => item.requestId === id), requestId);
    return page.evaluate((id) => (window as unknown as { __webMcpResults: Array<Record<string, unknown>> }).__webMcpResults.find((item) => item.requestId === id)!, requestId);
  }

  it('discovers imperative, declarative, and same-origin descendant tools', async () => {
    await page.evaluate(() => (window as unknown as { __hvyGalaxyWebMcp: { discover(value: unknown): void } }).__hvyGalaxyWebMcp.discover({ requestId: 'discover' }));
    const discovered = await result('discover');
    const names = (discovered.tools as Array<{ name: string }>).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['account.read', 'form.submit', 'child.read']));
  });

  it('invokes JSON and declarative tools and rejects changed descriptors', async () => {
    const discovery = await result('discover');
    const tools = discovery.tools as Array<Record<string, unknown>>;
    const read = tools.find((tool) => tool.name === 'account.read')!;
    await page.evaluate(({ descriptor }) => (window as unknown as { __hvyGalaxyWebMcp: { invoke(value: unknown): void } }).__hvyGalaxyWebMcp.invoke({ requestId: 'read', name: descriptor.name, origin: descriptor.origin, descriptor, arguments: { id: '42' } }), { descriptor: read });
    expect((await result('read')).value).toEqual({ id: '42', ok: true });
    const text = tools.find((tool) => tool.name === 'text.read')!;
    await page.evaluate(({ descriptor }) => (window as unknown as { __hvyGalaxyWebMcp: { invoke(value: unknown): void } }).__hvyGalaxyWebMcp.invoke({ requestId: 'text', name: descriptor.name, origin: descriptor.origin, descriptor, arguments: {} }), { descriptor: text });
    expect(await result('text')).toMatchObject({ value: 'plain text', isJson: false });
    const form = tools.find((tool) => tool.name === 'form.submit')!;
    await page.evaluate(({ descriptor }) => (window as unknown as { __hvyGalaxyWebMcp: { invoke(value: unknown): void } }).__hvyGalaxyWebMcp.invoke({ requestId: 'form', name: descriptor.name, origin: descriptor.origin, descriptor, arguments: { message: 'hello' } }), { descriptor: form });
    expect((await result('form')).value).toEqual({ submitted: 'hello' });
    await page.evaluate(({ descriptor }) => (window as unknown as { __hvyGalaxyWebMcp: { invoke(value: unknown): void } }).__hvyGalaxyWebMcp.invoke({ requestId: 'stale', name: descriptor.name, origin: descriptor.origin, descriptor: { ...descriptor, description: 'changed' }, arguments: {} }), { descriptor: read });
    expect((await result('stale')).kind).toBe('integration-webmcp-error');
  });

  it('cancels a correlated invocation', async () => {
    const discovery = await result('discover');
    const slow = (discovery.tools as Array<Record<string, unknown>>).find((tool) => tool.name === 'slow.action')!;
    await page.evaluate(({ descriptor }) => {
      const bridge = (window as unknown as { __hvyGalaxyWebMcp: { invoke(value: unknown): void; cancel(id: string): void } }).__hvyGalaxyWebMcp;
      bridge.invoke({ requestId: 'cancelled', name: descriptor.name, origin: descriptor.origin, descriptor, arguments: {} });
      setTimeout(() => bridge.cancel('cancelled'), 10);
    }, { descriptor: slow });
    expect((await result('cancelled')).kind).toBe('integration-webmcp-error');
  });

  it('rediscovers dynamically registered tools after toolchange', async () => {
    const before = await page.evaluate(() => (window as unknown as { __toolChangeCount: number }).__toolChangeCount);
    await page.evaluate(() => (window as unknown as { __registerDynamicTool(): Promise<unknown> }).__registerDynamicTool());
    await page.waitForFunction((count) => (window as unknown as { __toolChangeCount: number }).__toolChangeCount > count, before);
    await page.evaluate(() => (window as unknown as { __hvyGalaxyWebMcp: { discover(value: unknown): void } }).__hvyGalaxyWebMcp.discover({ requestId: 'dynamic' }));
    expect(((await result('dynamic')).tools as Array<{ name: string }>).some((tool) => tool.name === 'dynamic.read')).toBe(true);
  });

  it('waits for an asynchronously registered tool during initial page discovery', async () => {
    const delayedPage = await browser.newPage();
    await delayedPage.addInitScript(`window.__webMcpResults=[]; window.__hvyGalaxyPublish=value=>window.__webMcpResults.push(value); window.__hvyGalaxyNativeWebMcp = typeof document.modelContext?.getTools === 'function';\n${polyfill}\n${bridge}`);
    await delayedPage.goto(`${origin}/delayed`);
    await delayedPage.evaluate(() => (window as unknown as { __hvyGalaxyWebMcp: { discover(value: unknown): void } }).__hvyGalaxyWebMcp.discover({ requestId: 'wait-for-tool', waitForTools: true }));
    await delayedPage.waitForFunction(() => (window as unknown as { __webMcpResults: Array<{ requestId?: string }> }).__webMcpResults.some((item) => item.requestId === 'wait-for-tool'));
    const discovered = await delayedPage.evaluate(() => (window as unknown as { __webMcpResults: Array<Record<string, unknown>> }).__webMcpResults.find((item) => item.requestId === 'wait-for-tool'));
    expect(discovered).toMatchObject({
      kind: 'integration-webmcp-tools',
      tools: [expect.objectContaining({ name: 'late.read' })],
    });
    await delayedPage.close();
  });

  it('rejects output beyond the bridge limit', async () => {
    const discovery = await result('discover');
    const large = (discovery.tools as Array<Record<string, unknown>>).find((tool) => tool.name === 'large.read')!;
    await page.evaluate(({ descriptor }) => (window as unknown as { __hvyGalaxyWebMcp: { invoke(value: unknown): void } }).__hvyGalaxyWebMcp.invoke({ requestId: 'large', name: descriptor.name, origin: descriptor.origin, descriptor, arguments: {} }), { descriptor: large });
    expect(await result('large')).toMatchObject({ kind: 'integration-webmcp-error', message: 'The WebMCP tool result exceeded the 1 MB limit.' });
  });

  it('preserves a native implementation and delegates cross-origin discovery to it', async () => {
    const nativePage = await browser.newPage();
    await nativePage.addInitScript(`
      window.__webMcpResults=[];
      window.__hvyGalaxyPublish=value=>window.__webMcpResults.push(value);
      window.__nativeContext={
        getTools: async options => options?.fromOrigins?.length ? [{origin:'https://tools.example',name:'native.read',description:'Native cross-origin tool',inputSchema:{type:'object'},annotations:{readOnlyHint:true}}] : [],
        executeTool: async (_tool, input) => { window.__nativeInput = input; return JSON.stringify({native:true}); }
      };
      Object.defineProperty(Document.prototype, 'modelContext', { configurable:true, get:() => window.__nativeContext });
      window.__hvyGalaxyNativeWebMcp = typeof document.modelContext?.getTools === 'function';
      ${polyfill}
      ${bridge}
    `);
    await nativePage.goto(origin);
    expect(await nativePage.evaluate(() => (document as unknown as { modelContext: unknown }).modelContext === (window as unknown as { __nativeContext: unknown }).__nativeContext)).toBe(true);
    await nativePage.evaluate(() => (window as unknown as { __hvyGalaxyWebMcp: { discover(value: unknown): void } }).__hvyGalaxyWebMcp.discover({ requestId: 'native', fromOrigins: ['https://tools.example'] }));
    await nativePage.waitForFunction(() => (window as unknown as { __webMcpResults: Array<{ requestId?: string }> }).__webMcpResults.some((item) => item.requestId === 'native'));
    const nativeResult = await nativePage.evaluate(() => (window as unknown as { __webMcpResults: Array<Record<string, unknown>> }).__webMcpResults.find((item) => item.requestId === 'native')!);
    expect((nativeResult.tools as Array<{ origin: string; name: string }>)).toContainEqual(expect.objectContaining({ origin: 'https://tools.example', name: 'native.read' }));
    const nativeTool = (nativeResult.tools as Array<Record<string, unknown>>)[0];
    await nativePage.evaluate((descriptor) => (window as unknown as { __hvyGalaxyWebMcp: { invoke(value: unknown): void } }).__hvyGalaxyWebMcp.invoke({ requestId: 'native-call', name: descriptor.name, origin: descriptor.origin, descriptor, arguments: { id: '42' }, fromOrigins: ['https://tools.example'] }), nativeTool);
    await nativePage.waitForFunction(() => (window as unknown as { __webMcpResults: Array<{ requestId?: string }> }).__webMcpResults.some((item) => item.requestId === 'native-call'));
    expect(await nativePage.evaluate(() => (window as unknown as { __nativeInput: unknown }).__nativeInput)).toEqual({ id: '42' });
    await nativePage.close();
  });

  it('publishes an explicit navigation error and cancels pending page work', async () => {
    const navigationPage = await browser.newPage();
    await navigationPage.addInitScript(`
      window.__hvyGalaxyPublish=value=>{
        const values=JSON.parse(localStorage.getItem('__webMcpNavigationResults') || '[]');
        values.push(value);
        localStorage.setItem('__webMcpNavigationResults', JSON.stringify(values));
      };
      window.__hvyGalaxyNativeWebMcp = typeof document.modelContext?.getTools === 'function';
      ${polyfill}
      ${bridge}
    `);
    await navigationPage.goto(origin);
    await navigationPage.evaluate(() => (window as unknown as { __hvyGalaxyWebMcp: { discover(value: unknown): void } }).__hvyGalaxyWebMcp.discover({ requestId: 'navigation-discovery' }));
    await navigationPage.waitForFunction(() => JSON.parse(localStorage.getItem('__webMcpNavigationResults') || '[]').some((item: { requestId?: string }) => item.requestId === 'navigation-discovery'));
    const slow = await navigationPage.evaluate(() => {
      const values = JSON.parse(localStorage.getItem('__webMcpNavigationResults') || '[]') as Array<{ requestId?: string; tools?: Array<Record<string, unknown>> }>;
      return values.find((item) => item.requestId === 'navigation-discovery')?.tools?.find((tool) => tool.name === 'slow.action');
    });
    await navigationPage.evaluate((descriptor) => {
      (window as unknown as { __hvyGalaxyWebMcp: { invoke(value: unknown): void } }).__hvyGalaxyWebMcp.invoke({ requestId: 'navigated', name: descriptor!.name, origin: descriptor!.origin, descriptor, arguments: {} });
    }, slow);
    await navigationPage.goto(`${origin}/after`);
    const navigationResults = await navigationPage.evaluate(() => JSON.parse(localStorage.getItem('__webMcpNavigationResults') || '[]') as Array<Record<string, unknown>>);
    expect(navigationResults).toContainEqual(expect.objectContaining({ requestId: 'navigated', kind: 'integration-webmcp-error', code: 'NavigationError' }));
    await navigationPage.close();
  });
});
