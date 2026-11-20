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

## Hosting (Workers Free plan)

- **Lean `wrangler.jsonc` until needed.** User is on the Workers Free plan. R2, Vectorize and Queues bindings are commented out (with the exact blocks preserved) because a deploy fails when a bound resource is missing and nothing uses them before M4 (R2, Vectorize) and M5 (Queues). Deviation from SPEC §13.1; re-enable per milestone.
- **Verified (2026-11-19, Cloudflare docs):** Queues are available on Workers Free (10,000 ops/day, 24 h retention); Workers AI gives 10,000 neurons/day on Free (this matches the `aiDailyNeuronBudget` default of 10,000 — the M1 assumption is now confirmed); Workers Free limits are 100k requests/day, 50 subrequests and 10 ms CPU per invocation.
- **UNVERIFIED:** Vectorize on the Free plan — Cloudflare's pricing page says paid-only while other pages list Free allowances. Confirm before M4. Also check whether 10 ms CPU per invocation is enough for queue consumers (M5); a paid plan may be required then.
- **Fail-closed auth.** `/api/*` (except `/api/health`) requires a valid Cloudflare Access JWT; with Access unconfigured every such call is 401. `OWNER_EMAIL` optionally restricts to one identity.
- **`pnpm run deploy`.** `pnpm deploy` is a pnpm built-in; the script must be invoked with `run`. CLAUDE.md's command list shows the short form.

## Access on workers.dev (2026-11-20)

- **Access is enabled from the Worker's Domains & Routes settings**, not as a self-hosted Access application (workers.dev is not a zone in the account). With "All traffic", `/api/health` is also behind Access; the Worker's own `/api/health` exemption only matters for local/dev or a future custom domain.
- **Verified:** unauthenticated requests to `/`, `/inbox`, `/api/settings` and `/api/health` return 302 to `<team>.cloudflareaccess.com`; after sign-in the site and `/api/settings` work (confirmed by the owner). Worker secrets `ACCESS_AUD`, `ACCESS_TEAM_DOMAIN`, `OWNER_EMAIL` are set.
- **API token** `job-scout-github-deploy` (Workers Scripts Edit, Account Settings Read, D1 Edit) is stored only as a GitHub Actions secret. Rotate it and update the secret before it expires.

## M2

- **Reed fixtures are synthetic.** The five files in `apps/worker/test/fixtures/reed/` are hand-written to match SPEC §4.1, not recorded from the live API. M3 records real responses and must re-check every field name below; replace or supplement these then.
- **ASSUMPTION (verify in M3): Reed dates are day-first (`dd/MM/yyyy`)**, as I recall from the real API, not ISO as SPEC §4.1 implies. `parseSourceDate` accepts both. Also unverified: `salary` / `salaryType` text on `jobs/{id}`, `applicationCount` vs `applications`, `datePosted` vs `date`. The shared `ReedJobDetailsSchema` is loose so a mismatch degrades parsing rather than failing.
- **`ReedJobDetailsSchema` lives in `packages/shared`** (not an adapter) because `core/normalise.ts` must stay free of adapter imports. `NormaliseContext` gained `now: Date` (fallback posted date) so normalisation stays pure.
- **New setting `working.hoursPerDay` (default 8)** for annualising hourly rates; M1 only had `workingDaysPerYear`.
- **Pay parsing rules** (`core/parse/pay.ts`):
  - Confidence is `high` (explicit period), `medium` (period inferred from size), `low` (amount but period unknowable) or `none`.
  - Inference follows SPEC §4.4: ≥ £10,000 is a year; below £2,000 is a day rate for contract/temp/unknown — and, my refinement, an hourly rate below £100; permanent amounts under £2,000 stay `unknown`; £2,000–£9,999 is `unknown`.
  - "up to £X" gives max only. A single figure sets min = max. A reversed range is swapped. A k-suffixed partner scales a bare number under 1,000 ("80-95k").
  - Bare numbers ("2 days a week") count only when a period keyword follows them directly, so day counts and years of experience are not read as pay; `£`/`k` amounts may find their period within ~25 characters.
  - Reed's structured min/max are used only when the text has no amount. A rate quoted in the advert body is used only with an explicit period (`high`), never from magnitude, to avoid "£50m turnover" false positives.
- **IR35:** contradictory wording ("outside IR35 … some roles inside IR35") and undecided wording ("TBC") return `unknown` so the hard filter passes the job (SPEC §7.1). PAYE/umbrella leans inside (`medium`); "Ltd company" leans outside (`low`). Permanent roles get no IR35 value.
- **Work mode:** stated office days win over keywords (≥ 5 days = onsite, otherwise hybrid); monthly figures are converted to days per week (1 day/month ≈ 0.23). Plain "onsite" alone is `low` confidence. These regexes are a first pass for the LLM to refine.
- **Titles:** "Lead" counts as seniority only as the first word, so "Delivery Lead" keeps its role word. `tokenSetRatio` follows the fuzzywuzzy method (subset ⇒ 1.0); the dedupe step (M6) also requires cosine ≥ 0.92.
- **Coverage gate.** `pnpm test:coverage` (part of `pnpm check`) enforces 100% on `core/parse/**` and ≥ 90% elsewhere in `core/`, measured on the `worker-unit` project (the Workers pool does not support v8 coverage). Coverage config must live in the root `vitest.config.ts`.
- **Parser constants.** The magnitude thresholds (10,000 / 2,000 / 100 / 1,000) are named constants in `pay.ts`, not settings: they define how a number is read, not how a job is ranked.
