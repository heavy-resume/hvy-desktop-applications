import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:1420/';
const viewports = [
  { width: 920, height: 640 },
  { width: 1024, height: 640 },
  { width: 1280, height: 860 },
];

const browser = await chromium.launch({ headless: true });

try {
  for (const viewport of viewports) {
    await smokeViewport(viewport);
  }
} finally {
  await browser.close();
}

async function smokeViewport(viewport) {
  const page = await browser.newPage({ viewport });
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
    await page.getByTitle('New HVY document').click();
    await page.getByText('Untitled.hvy').waitFor({ timeout: 10_000 });
    await page.locator('.dirty-indicator', { hasText: 'Unsaved' }).waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: 'View' }).waitFor({ timeout: 10_000 });

    const text = await page.locator('body').innerText({ timeout: 5_000 });
    const layout = await page.evaluate(() => {
      const host = document.querySelector('#hvyMount');
      const shell = document.querySelector('.document-shell');
      const title = document.querySelector('.toolbar-title');
      const actions = document.querySelector('.toolbar-actions');
      const controls = document.querySelector('.mode-controls');
      const paddedDocument = document.querySelector('.reader-document, .editor-tree');
      if (
        !(host instanceof HTMLElement)
        || !(shell instanceof HTMLElement)
        || !(title instanceof HTMLElement)
        || !(actions instanceof HTMLElement)
      ) {
        return null;
      }
      const hostRect = host.getBoundingClientRect();
      const shellRect = shell.getBoundingClientRect();
      const titleRect = title.getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();
      const controlsRect = controls instanceof HTMLElement ? controls.getBoundingClientRect() : null;
      const paddedStyle = paddedDocument instanceof HTMLElement ? getComputedStyle(paddedDocument) : null;
      const intersect = (left, right) => !(
        left.right <= right.left
        || right.right <= left.left
        || left.bottom <= right.top
        || right.bottom <= left.top
      );
      return {
        hostBottom: hostRect.bottom,
        shellBottom: shellRect.bottom,
        hostHeight: hostRect.height,
        viewportHeight: window.innerHeight,
        toolbarOverlaps: intersect(titleRect, actionsRect),
        modeControlHeight: controlsRect?.height ?? 0,
        documentPaddingTop: paddedStyle ? Number.parseFloat(paddedStyle.paddingTop) : 0,
      };
    });
    if (!layout || layout.hostHeight <= 0 || Math.abs(layout.hostBottom - layout.shellBottom) > 1 || layout.shellBottom > layout.viewportHeight + 1) {
      throw new Error(`Document host does not fit shell at ${viewport.width}x${viewport.height}: ${JSON.stringify(layout)}`);
    }
    if (layout.toolbarOverlaps) {
      throw new Error(`Toolbar title overlaps actions at ${viewport.width}x${viewport.height}: ${JSON.stringify(layout)}`);
    }
    if (layout.modeControlHeight > 0 && layout.documentPaddingTop < layout.modeControlHeight + 8) {
      throw new Error(`Document content does not reserve mode control space at ${viewport.width}x${viewport.height}: ${JSON.stringify(layout)}`);
    }
    if (/Start writing here|#! Start/.test(text)) {
      throw new Error('New HVY document still contains starter section content.');
    }
    if (/Created blank HVY document/.test(text)) {
      throw new Error('Status text is leaking below the document.');
    }

    const compatibility = await page.evaluate(() => {
      document.documentElement.classList.add('hvy-compatibility-mode');
      const samples = ['dialog', 'workspace-action-popover', 'workspace-filter-dialog'].map((className) => {
        const element = document.createElement('div');
        element.className = className;
        document.body.append(element);
        const background = getComputedStyle(element).backgroundColor;
        element.remove();
        const alpha = background.startsWith('rgba(')
          ? Number.parseFloat(background.split(',').at(-1)?.replace(')', '').trim() ?? '1')
          : 1;
        return { className, background, alpha };
      });
      return samples;
    });
    const transparent = compatibility.find((sample) => sample.alpha < 1);
    if (transparent) {
      throw new Error(`Compatibility surface is transparent at ${viewport.width}x${viewport.height}: ${JSON.stringify(transparent)}`);
    }

    const hasErrorBanner = await page.locator('.error-banner').count() > 0;
    const failed = messages.some((message) => message.startsWith('pageerror:'))
      || hasErrorBanner
      || /Startup error|Could not load|Cannot read properties|not allowed/i.test(text);
    console.log(`Viewport ${viewport.width}x${viewport.height}`);
    console.log(text.split('\n').slice(0, 12).join('\n'));
    if (messages.length > 0) {
      console.log('\nConsole:');
      console.log(messages.join('\n'));
    }
    if (failed) {
      process.exitCode = 1;
    }
  } finally {
    await page.close();
  }
}
