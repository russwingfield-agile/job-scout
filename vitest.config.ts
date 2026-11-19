import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'apps/worker/vitest.unit.config.ts',
      'apps/worker/vitest.integration.config.ts',
      'apps/web/vitest.config.ts',
    ],
  },
});
