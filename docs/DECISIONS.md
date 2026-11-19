# Decisions log

One entry per deviation from the plan/spec or verified external fact. Newest last.

## M0

- **wrangler.jsonc location.** SPEC §13.1 shows repo-root-relative paths; the plan's layout puts the file at `apps/worker/wrangler.jsonc`. Paths are relative to that file (`main: src/index.ts`, assets `../web/dist/client`). Plan wins on structure.
- **Pinned versions (2026-11-19).** TypeScript 6.0.3 (not 7.x: project references and tooling are better exercised on 6), Vitest 4.1.12 (required by `@cloudflare/vitest-pool-workers` 0.23.0 peer range), Vite 8.3.8.
- **`ENV` var.** Added `ENV` to `vars` (default `production`); `.dev.vars` sets `ENV=dev` so dev-only routes and `DEV_BYPASS_AUTH` can be gated later (M3, M10).
- **Placeholder D1 id.** `database_id` is an all-zero placeholder until the real database is created (see RUNBOOK).
- **Stub commands.** `db:generate`, `seed:local`, `run:local` exist from M0 as scripts that fail loudly with the milestone they arrive in.
- **Test plugin renamed.** `@cloudflare/vitest-pool-workers` is deprecated in favour of `@cloudflare/vitest-plugin` (1.8.5); M0 uses the new package. Integration tests set `remoteBindings: false` so `pnpm check` needs no Cloudflare login.
- **Remote bindings in dev.** `AI` and `VEC` are `"remote": true`, so `pnpm dev` needs `wrangler login` (or `CLOUDFLARE_API_TOKEN`). `REMOTE_BINDINGS=false pnpm dev` runs the SPA + Worker offline; verified `/api/health` and the SPA shell that way.
- **Deploy.** The Vite plugin emits the deployable config under `apps/web/dist`; `pnpm deploy` runs `wrangler deploy` from `apps/worker` so the generated redirect is used.
- **Windows path length.** The scratch checkout path exceeded 260 chars and broke esbuild's postinstall; the repo lives at `C:\Users\russw\code\job-scout`.
