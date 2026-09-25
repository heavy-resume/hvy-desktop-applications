import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/formControls.browser.test.ts', 'src/integration-inspector.test.ts', 'src/documentViewState.browser.test.ts', 'src/templateExamples.browser.test.ts', 'src/integrationWebMcp.browser.test.ts', 'src/rawHvy.browser.test.ts', 'src/textCleanup.browser.test.ts', 'src/hvyMeta.browser.test.ts'],
    exclude: configDefaults.exclude,
    fileParallelism: false,
  },
});
