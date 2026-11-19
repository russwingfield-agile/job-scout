import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        remoteBindings: false,
        // Deterministic test env: do not depend on a developer's local .dev.vars (absent in CI).
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, ENV: 'dev', DEV_BYPASS_AUTH: 'true' },
        },
      }),
    ],
    test: {
      name: 'worker-integration',
      include: ['test/integration/**/*.test.ts'],
      setupFiles: ['./test/integration/setup.ts'],
      // Each file boots its own workerd runner; starting them in parallel can exceed Vitest's
      // fixed 90s runner-start timeout on slower machines.
      fileParallelism: false,
      root: import.meta.dirname,
    },
  };
});
