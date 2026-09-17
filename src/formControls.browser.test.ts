import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';

describe('shared form control sizing', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser.close(); });

  it('keeps single-line inputs and dropdowns equal at normal and enlarged font sizes', async () => {
    const page = await browser.newPage();
    const styles = await readFile(new URL('./styles/base.css', import.meta.url), 'utf8');
    await page.setContent(`<style>${styles}</style>
      <div style="width:320px;display:grid;gap:14px">
        <label>Format<select class="hvy-galaxy-select"><option>THVY template (.thvy)</option></select></label>
        <label>Name<input class="hvy-galaxy-input" value="heavy-resume-linear"></label>
        <label>Save location<select class="hvy-galaxy-select"><option>Workspace</option><option>App Templates</option></select></label>
      </div>`);
    for (const fontSize of [14, 20]) {
      await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, fontSize);
      const bounds = await page.locator('.hvy-galaxy-input, .hvy-galaxy-select').evaluateAll(elements => elements.map(element => {
        const { width, height } = element.getBoundingClientRect();
        return { width, height };
      }));
      expect(bounds[0]).toEqual(bounds[1]);
      expect(bounds[2]).toEqual(bounds[1]);
    }
    await page.locator('.hvy-galaxy-select').last().selectOption({ label: 'App Templates' });
    await expect.poll(() => page.locator('.hvy-galaxy-select').last().inputValue()).toBe('App Templates');
    await page.screenshot({ path: '/tmp/hvy-form-controls.png' });
    await page.close();
  });
});
