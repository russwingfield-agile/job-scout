import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' }, remoteBindings: false }),
  ],
  test: {
    name: 'worker-integration',
    include: ['test/integration/**/*.test.ts'],
    root: import.meta.dirname,
  },
});
