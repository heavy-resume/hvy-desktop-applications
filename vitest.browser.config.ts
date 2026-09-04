import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/integration-inspector.test.ts', 'src/documentViewState.browser.test.ts', 'src/integrationWebMcp.browser.test.ts'],
    exclude: configDefaults.exclude,
    fileParallelism: false,
  },
});
