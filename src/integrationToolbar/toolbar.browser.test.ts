import fs from 'node:fs';
import { transform } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { IntegrationToolbarBrowserState, IntegrationToolbarInspectionState, IntegrationToolbarMessage } from './toolbar';

// The toolbar module, as the page runs it: compiled to a script that leaves `IntegrationToolbar` on the window.
let toolbarScript = '';
let browser: Browser;
let page: Page;

declare global {
  interface Window {
    IntegrationToolbar: { mountIntegrationToolbar: (root: HTMLElement, send: (message: IntegrationToolbarMessage) => void) => { setBrowserState(state?: IntegrationToolbarBrowserState): void; setInspectionState(state?: IntegrationToolbarInspectionState): void } };
    mountedToolbar: ReturnType<Window['IntegrationToolbar']['mountIntegrationToolbar']>;
    sent: IntegrationToolbarMessage[];
  }
}

beforeAll(async () => {
  const source = fs.readFileSync(new URL('./toolbar.ts', import.meta.url), 'utf8');
  toolbarScript = (await transform(source, { loader: 'ts', format: 'iife', globalName: 'IntegrationToolbar' })).code;
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
});

beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 1000, height: 52 } });
  await page.setContent('<div id="integration-toolbar"></div>');
  await page.addScriptTag({ content: toolbarScript });
  await page.evaluate(() => {
    window.sent = [];
    window.mountedToolbar = window.IntegrationToolbar.mountIntegrationToolbar(document.getElementById('integration-toolbar')!, (message) => window.sent.push(message));
  });
});

describe('integration browser toolbar', () => {
  it('shows the address, whether it is secure, and whether it is an allowed site', async () => {
    await page.evaluate(() => window.mountedToolbar.setBrowserState({ url: 'https://mail.google.com/mail/u/0/', allowed: ['https://mail.google.com'] }));
    expect(await page.locator('.integration-toolbar-host').textContent()).toBe('mail.google.com');
    expect(await page.locator('.integration-toolbar-url').inputValue()).toBe('https://mail.google.com/mail/u/0/');
    expect(await page.locator('.integration-toolbar-security').getAttribute('data-secure')).toBe('true');
    expect(await page.locator('.integration-toolbar-security').getAttribute('data-allowed')).toBe('true');

    await page.evaluate(() => window.mountedToolbar.setBrowserState({ url: 'http://elsewhere.test/', allowed: ['https://mail.google.com'] }));
    expect(await page.locator('.integration-toolbar-security').getAttribute('data-secure')).toBe('false');
    expect(await page.locator('.integration-toolbar-security').getAttribute('data-allowed')).toBe('false');
  });

  it('sends what is clicked: the browser buttons, a typed address, the page menu, and close', async () => {
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('button', { name: 'Reload' }).click();
    await page.getByLabel('Address').fill('example.com/jobs');
    await page.getByLabel('Address').press('Enter');
    await page.getByRole('button', { name: 'Page actions' }).click();
    await page.getByRole('menuitem', { name: 'Define record type' }).click();
    expect(await page.getByRole('menu').isHidden()).toBe(true);
    await page.getByRole('button', { name: 'Close' }).click();
    expect(await page.evaluate(() => window.sent)).toEqual([
      { kind: 'browser', command: 'back' },
      { kind: 'browser', command: 'reload' },
      // An address typed with no scheme is https.
      { kind: 'navigate', url: 'https://example.com/jobs' },
      { kind: 'toolbar-action', action: 'define-record-type' },
      { kind: 'browser', command: 'close' },
    ]);
  });

  it('shows picking in place of the address and menu, and sends its buttons by id', async () => {
    await page.evaluate(() => window.mountedToolbar.setInspectionState({
      active: true,
      status: 'Select fields, or choose Done to cancel',
      buttons: [
        { id: 'navigate', label: 'Navigate page' },
        { id: 'undo', label: 'Undo last', disabled: true },
        { id: 'done', label: 'Done', primary: true },
      ],
    }));
    expect(await page.locator('.integration-toolbar-status').textContent()).toBe('Select fields, or choose Done to cancel');
    expect(await page.getByLabel('Address').isHidden()).toBe(true);
    expect(await page.getByRole('button', { name: 'Page actions' }).isHidden()).toBe(true);
    expect(await page.getByRole('button', { name: 'Undo last' }).isDisabled()).toBe(true);
    await page.getByRole('button', { name: 'Done' }).click();
    expect(await page.evaluate(() => window.sent)).toEqual([{ kind: 'inspector-control', id: 'done' }]);

    // A site setup's fields, as pills: filled once picked; one not yet picked answers which field a pick is.
    await page.evaluate(() => window.mountedToolbar.setInspectionState({
      active: true,
      status: 'Which field is this? “$140,000 a year”',
      buttons: [{ id: 'field-skip', label: 'Skip' }],
      fields: [
        { id: 'field-0', label: 'Title', picked: true, disabled: true },
        { id: 'field-1', label: 'Pay' },
      ],
    }));
    expect(await page.locator('.integration-toolbar-field.is-picked').allTextContents()).toEqual(['Title']);
    expect(await page.getByRole('button', { name: 'Title' }).getAttribute('aria-pressed')).toBe('true');
    expect(await page.getByRole('button', { name: 'Title' }).isDisabled()).toBe(true);
    await page.getByRole('button', { name: 'Pay' }).click();
    expect(await page.evaluate(() => window.sent.at(-1))).toEqual({ kind: 'inspector-control', id: 'field-1' });

    // Picking over: the address and the menu are back.
    await page.evaluate(() => window.mountedToolbar.setInspectionState({}));
    expect(await page.getByLabel('Address').isVisible()).toBe(true);
    expect(await page.locator('.integration-toolbar-inspection').isHidden()).toBe(true);
  });
});
