import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/integration-inspector.test.ts'],
    exclude: configDefaults.exclude,
  },
});
