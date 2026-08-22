import { _electron as electron } from 'playwright';

const electronEnv = {
  ...process.env,
  ELECTRON_RENDERER_URL: 'http://127.0.0.1:1420',
  ELECTRON_ENABLE_LOGGING: '1',
};
delete electronEnv.ELECTRON_RUN_AS_NODE;
delete electronEnv.NODE_OPTIONS;

const app = await electron.launch({
  executablePath: '.electron-dev/HVY Galaxy-darwin-arm64/HVY Galaxy.app/Contents/MacOS/HVY Galaxy',
  args: [],
  env: electronEnv,
});

try {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const homepageError = page.getByRole('dialog', { name: 'Homepage Could Not Be Opened' });
  if (await homepageError.isVisible().catch(() => false)) {
    await homepageError.getByRole('button', { name: 'No Homepage' }).click();
    await homepageError.waitFor({ state: 'detached' });
  }
  console.log(JSON.stringify({ url: page.url(), title: await page.title(), body: (await page.locator('body').innerText()).slice(0, 500) }));
  await page.getByTitle('New HVY document').click();
  await page.locator('.document-tab-name', { hasText: 'Untitled.hvy' }).waitFor();
  await page.locator('[data-action="set-mode"][data-mode="editor"]').click();
  const addSection = page.locator('[data-action="add-top-level-section"][data-section-location="main"]');
  await addSection.click();
  const section = page.locator('.editor-section-card').last();
  const title = section.locator('[data-field="section-title"]');
  const focus = await title.evaluate((element) => ({
    focused: element === document.activeElement,
    activeTag: document.activeElement?.tagName,
    activeClass: document.activeElement?.className,
  }));
  const before = await section.locator('.editor-block').count();
  await section.locator('.component-picker-trigger').click();
  await section.locator('[data-action="add-block"][data-component="text"]').click();
  const after = await section.locator('.editor-block').count();
  console.log(JSON.stringify({ focus, before, after }));
} finally {
  await app.close();
}
