import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare({
      configPath: '../worker/wrangler.jsonc',
      // Share local D1/R2/Queue state with `pnpm db:migrate:local` (which writes next to the worker).
      persistState: { path: '../worker/.wrangler/state' },
      // Set REMOTE_BINDINGS=false to run offline (no `wrangler login`); AI/Vectorize are then unavailable.
      remoteBindings: process.env.REMOTE_BINDINGS !== 'false',
    }),
  ],
});
