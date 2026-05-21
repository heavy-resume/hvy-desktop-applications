import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:1420/';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const messages = [];

page.on('console', (message) => {
  messages.push(`${message.type()}: ${message.text()}`);
});
page.on('pageerror', (error) => {
  messages.push(`pageerror: ${error.stack || error.message}`);
});

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
  await Promise.race([
    page.locator('.app-shell').waitFor({ timeout: 10_000 }),
    page.locator('.error-banner').waitFor({ timeout: 10_000 }),
    page.getByText('Startup error').waitFor({ timeout: 10_000 }),
  ]);
  const text = await page.locator('body').innerText({ timeout: 5_000 });
  const hasErrorBanner = await page.locator('.error-banner').count() > 0;
  const failed = messages.some((message) => message.startsWith('pageerror:'))
    || hasErrorBanner
    || /Startup error|Could not load|Cannot read properties|not allowed/i.test(text);
  console.log(text.split('\n').slice(0, 20).join('\n'));
  if (messages.length > 0) {
    console.log('\nConsole:');
    console.log(messages.join('\n'));
  }
  if (failed) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
