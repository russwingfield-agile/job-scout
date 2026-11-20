import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'apps/worker/vitest.unit.config.ts',
      'apps/worker/vitest.integration.config.ts',
      'apps/web/vitest.config.ts',
    ],
    // Coverage is measured on the worker-unit project only (`pnpm test:coverage`); the Workers
    // pool does not support the v8 provider. Plan Part 4: 100% branches on core/parse, >= 90% elsewhere in core.
    coverage: {
      provider: 'v8',
      include: ['apps/worker/src/core/**'],
      reporter: ['text'],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
        'apps/worker/src/core/parse/**': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
