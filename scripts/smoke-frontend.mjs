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
    await assertAppShellFillsViewport(page, viewport, 'empty document state');
    await assertWorkspaceZoomFillsViewport(page, viewport);
    await page.getByTitle('New HVY document').click();
    await page.locator('.document-tab-name', { hasText: 'Untitled.hvy' }).waitFor({ timeout: 10_000 });
    await page.locator('.dirty-indicator', { hasText: 'Unsaved' }).waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: 'View' }).waitFor({ timeout: 10_000 });
    await assertModalPreservesDocumentMount(page, viewport);

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

async function assertWorkspaceZoomFillsViewport(page, viewport) {
  for (const appZoom of [0.5, 0.67, 0.8, 0.9, 1.1, 1.25, 1.5, 1.75, 2]) {
    await page.evaluate((zoom) => {
      localStorage.setItem('hvy-galaxy:zoom', JSON.stringify({ appZoom: zoom, documentZoom: 1 }));
    }, appZoom);
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.app-shell').waitFor({ timeout: 10_000 });
    const layout = await page.evaluate(() => {
      const bounds = (selector) => {
        const element = document.querySelector(selector);
        if (!(element instanceof HTMLElement)) return null;
        const rect = element.getBoundingClientRect();
        return { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
      };
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        body: bounds('body'),
        app: bounds('#app'),
        shell: bounds('.app-shell'),
        sidebar: bounds('.workspace-sidebar'),
        documentShell: bounds('.document-shell'),
        bodyStyle: document.body.getAttribute('style'),
      };
    });
    const fillsViewport = (rect) => rect
      && Math.abs(rect.top) <= 1
      && Math.abs(rect.left) <= 1
      && Math.abs(rect.right - layout.viewport.width) <= 1
      && Math.abs(rect.bottom - layout.viewport.height) <= 1;
    const fillsViewportHeight = (rect) => rect
      && Math.abs(rect.top) <= 1
      && Math.abs(rect.bottom - layout.viewport.height) <= 1;
    if (!fillsViewport(layout.shell) || !fillsViewportHeight(layout.sidebar) || !fillsViewportHeight(layout.documentShell)) {
      throw new Error(`Workspace zoom ${appZoom} does not fill ${viewport.width}x${viewport.height}: ${JSON.stringify(layout)}`);
    }
  }
  await page.evaluate(() => {
    localStorage.setItem('hvy-galaxy:zoom', JSON.stringify({ appZoom: 1, documentZoom: 1 }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.app-shell').waitFor({ timeout: 10_000 });
}

async function assertAppShellFillsViewport(page, viewport, stateName) {
  const layout = await page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) return null;
      const bounds = element.getBoundingClientRect();
      return {
        bottom: bounds.bottom,
        height: bounds.height,
      };
    };
    return {
      viewportHeight: window.innerHeight,
      shell: rect('.app-shell'),
      sidebar: rect('.workspace-sidebar'),
      documentShell: rect('.document-shell'),
      host: rect('#hvyMount'),
    };
  });
  const reachesViewportBottom = (rect) => rect && Math.abs(rect.bottom - layout.viewportHeight) <= 1;
  if (
    !reachesViewportBottom(layout.shell)
    || !reachesViewportBottom(layout.sidebar)
    || !reachesViewportBottom(layout.documentShell)
    || !layout.host
    || layout.host.height <= 0
  ) {
    throw new Error(`App shell does not fill viewport in ${stateName} at ${viewport.width}x${viewport.height}: ${JSON.stringify(layout)}`);
  }
}

async function assertModalPreservesDocumentMount(page, viewport) {
  await page.locator('button[data-action="set-mode"][data-mode="editor"]').click();
  await page.locator('button[data-action="set-mode"][data-mode="hvy"]').click();
  const rawTextarea = page.locator('.raw-hvy-textarea');
  await rawTextarea.waitFor({ timeout: 10_000 });
  await page.evaluate(() => {
    const mount = document.querySelector('#hvyMount');
    if (!(mount instanceof HTMLElement)) {
      throw new Error('Could not find HVY mount for modal preservation smoke.');
    }
    window.__hvySmokeMount = mount;
    const fixture = document.createElement('div');
    fixture.className = 'hvy-smoke-scroll-fixture';
    fixture.style.cssText = 'position:absolute;left:-9999px;top:0;width:120px;height:80px;overflow:auto;';
    fixture.innerHTML = '<div style="height:600px"></div>';
    mount.append(fixture);
    fixture.scrollTop = 240;
    window.__hvySmokeScrollTop = fixture.scrollTop;
  });
  await page.getByTitle('New workspace').click();
  await page.locator('form[data-form="new-workspace"]').waitFor({ timeout: 10_000 });
  const workspaceName = page.locator('input[name="workspaceName"]');
  const createWorkspace = page.getByRole('button', { name: 'Create' });
  if (await createWorkspace.isEnabled()) {
    throw new Error('Create workspace button is enabled before a workspace name is entered.');
  }
  await workspaceName.fill('Workspace button smoke');
  if (!(await createWorkspace.isEnabled())) {
    throw new Error('Create workspace button did not enable after a workspace name was entered.');
  }
  const preservation = await page.evaluate(() => {
    const mount = document.querySelector('#hvyMount');
    const fixture = document.querySelector('.hvy-smoke-scroll-fixture');
    return {
      sameMount: mount === window.__hvySmokeMount,
      scrollTop: fixture instanceof HTMLElement ? fixture.scrollTop : -1,
      previousScrollTop: window.__hvySmokeScrollTop ?? -1,
    };
  });
  if (!preservation.sameMount || Math.abs(preservation.scrollTop - preservation.previousScrollTop) > 1) {
    throw new Error(`Modal did not preserve HVY mount at ${viewport.width}x${viewport.height}: ${JSON.stringify(preservation)}`);
  }
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.locator('form[data-form="new-workspace"]').waitFor({ state: 'detached', timeout: 10_000 });
  await page.locator('button[data-action="set-mode"][data-mode="viewer"]').click();
}
