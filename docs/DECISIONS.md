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

## M1

- **Migration naming.** drizzle-kit names the first migration `0000_init.sql` (plan said `0001_init.sql`); wrangler orders by filename so this is equivalent. Generated with `--name init`; later `pnpm db:generate` runs use drizzle's default names.
- **`jobs.vector_ids` skipped.** Vector IDs are deterministic (`job:{id}`, `cv:{id}`), so no column is needed. Revisit in M6 only if merges require it.
- **Extra group statuses.** `GroupStatus` adds `deferred` and `prefiltered` (used by the plan in M5/M7 but missing from SPEC §11's comment list).
- **Extra columns.** `job_groups.new_postings_since_action` (SPEC §8.5 / plan M6.3). `runs` uses `phase`, `pending_ingest`, `pending_score` instead of the spec's `pending_count`, per plan §2.4. `processed_messages` added.
- **Settings storage.** One `settings` row per section (`schedule`, `weights`, …) holding only the overridden fields; `getSettings` deep-merges over `config/defaults.ts`. Arrays replace rather than merge. An invalid stored section is ignored (defaults used) and logged, so one bad row cannot break every request. `PUT /api/settings` validates the merged result, so cross-field rules apply (final weights sum to 1; badge thresholds strictly ordered). Nested objects inside `cvs.profileDefaults` are replaced wholesale on update.
- **Settings keys.** Names are camelCase versions of the SPEC constants (`maxLlmPerRun`, `reedDailyRequestBudget`, `dedupe.similarity`, …).
- **ASSUMPTION: `aiDailyNeuronBudget` = 10,000** (Workers AI free daily allocation). Not verified against current Cloudflare pricing; adjust in Settings. Neuron rate table per model is deferred to M7.
- **Local D1 state.** The Vite plugin is configured with `persistState.path = ../worker/.wrangler/state` so `pnpm dev` and `pnpm db:migrate:local` use the same database. Without it the dev server created its own empty D1 under `apps/web/.wrangler` and every query failed with "no such table".
- **Vitest runner start.** Integration files run sequentially (`fileParallelism: false`); Vitest hard-codes a 90 s runner-start timeout and parallel workerd boots exceeded it on this machine.
