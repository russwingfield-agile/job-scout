import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'worker-unit',
    environment: 'node',
    include: ['test/unit/**/*.test.ts'],
    root: import.meta.dirname,
  },
});
