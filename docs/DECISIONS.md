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

## M3 — Reed API, verified against the live API (2026-11-20)

Verified with a real key (Basic auth, key as username, empty password). Recorded responses are in `apps/worker/test/fixtures/reed/real/` (recorded with `scripts/record-reed-fixture.mjs`; no key or contact details in them). The earlier synthetic fixtures in `fixtures/reed/*.json` are kept for parser edge cases.

- **Confirmed M2 assumptions:** dates are day-first `dd/MM/yyyy`; `jobs/{id}` has `salary` ("£640.00 - £850.00 per day"), `salaryType` ("per day" / "per annum"), `datePosted`, `contractType` ("Contract" / "Permanent"), `externalUrl`, `fullTime`/`partTime`, and `yearlyMinimumSalary`/`yearlyMaximumSalary` (Reed annualises days × 260).
- **Search shape:** `{ results[], ambiguousLocations[], totalResults }`; each result has `jobId, employerId, employerName, jobTitle, locationName, minimumSalary, maximumSalary, currency, expirationDate, date, jobDescription (truncated snippet ending "..."), applications, jobUrl`. Full HTML is only on `jobs/{id}`.
- **Unknown job id returns HTTP 200 with a blank record** (`jobId: 0`, all other fields null), not a 404. `ReedAdapter.details` converts this to a non-retryable `NOT_FOUND`.
- **Nulls:** text fields can be `null`; the shared schemas read them as `''`.
- **Bad key → HTTP 401** with an empty body (non-retryable). No rate-limit headers were observed; limits remain undocumented, so the daily budget (default 900) and per-run cap (60) stay as the safeguard.
- **Paging:** `resultsToTake` is capped at 100 (101 returns 100); `resultsToSkip` past the end returns an empty page with the real `totalResults`. A broad query ("project manager", London) has ~2,600 hits, so `maxPagesPerQuery` (3) means only the newest ~300 are seen.
- **Filters:** `contract`, `permanent`, `temp` OR together; none sent means all types; `contract=false` is ignored (so only `true` flags are sent, and all three = none). `distanceFromLocation` changes the result set materially (default is narrower than 25 miles).
- **`minimumSalary`/`maximumSalary` units are not stated** (a contract can carry 640–850 as day rates or 50,000 as an annual figure). Pay is parsed from the `salary` text first; the numbers are only a fallback, and `minimumSalary` is sent as a search filter for permanent-only queries.
- **`applicationCount` on `jobs/{id}` was 0** where the search result showed 21–83 `applications`; treat the details value as unreliable. (Not fixed: low value, and normalisation has no access to the search hit.)
- **Parser fix found by real data:** `salary` already contains the period, so `salaryType` is appended only when the text does not already include it (previously produced "per day per day").
- **Decisions:** `SourceAdapter` takes an optional `{ runId }` so call records can be attributed to a run; `ReedClient` reports every request, including failures and timeouts, to a recorder that writes `source_calls` and increments `usage_daily.reed_calls`; recorder failures never fail the request. Network errors, timeouts, 429 and 5xx are retryable; 401/403, other 4xx and unexpected response shapes are not.
- **Recorder script is `.mjs`**, not `.ts` as the plan says, so it runs with plain Node and needs no type-checking setup.
- **Deployment:** the deployed Worker has no `REED_API_KEY` yet. Set it before M5 with `wrangler secret put REED_API_KEY --config apps/worker/wrangler.jsonc`.

## M4 — CVs, profiles, embeddings

**Workers AI facts (from Cloudflare docs, checked 2026-11-20 — NOT yet exercised against the live service):**
- `llama-3.3-70b-instruct-fp8-fast` costs 26,668 neurons per million input tokens and 204,805 per million output tokens (verified, pricing page). The rates for `llama-3.1-8b-instruct` (25,608 / 75,147) and `bge-base-en-v1.5` (6,058 input) are from memory and **unverified**; they are marked as such in `config/neuronRates.ts`. Unknown models are costed like the 70B so the budget never under-counts.
- `env.AI.toMarkdown([{ name, blob }])` returns an array of `{ name, format: 'markdown' | 'text' | 'error', data, tokens, error? }`. The docs spell the MIME field both `mimeType` and `mimetype`; the adapter does not read it.
- JSON mode: `response_format: { type: 'json_schema', json_schema: <schema> }` on a non-streaming call; the schema is passed directly under `json_schema`. `run()` returns `{ response, usage: { prompt_tokens, completion_tokens } }`, and `response` can already be a parsed object, so the adapter accepts a string, an object, or the OpenAI chat shape.
- The adapters were written to these documented shapes and tested against fakes of them. **Exit criterion still open:** upload real CVs in dev with remote AI and confirm summaries, embeddings and profiles (needs `wrangler login` and the Vectorize/R2 resources).

**Decisions:**
- **R2 and Vectorize bindings are optional at runtime.** `createContainer` builds `R2Blobs`/`VectorizeStore` only if `env.CVS`/`env.VEC` exist; otherwise those ports fail with `NOT_CONFIGURED` (HTTP 503) naming what is missing. This lets the code deploy before the resources exist (a missing binding in `wrangler.jsonc` would otherwise fail the deploy). Uploads fail before anything is stored.
- **A CV is never lost to an AI failure.** Storage and the row are written first; text extraction, summary and embedding each degrade to a `warnings[]` entry, and "Re-analyse" retries them. An unreadable document becomes a CV with empty text so the user can paste it in. A new profile falls back to the CV label as its only job title when there is no summary.
- **`structured()`** (plan §2.5) is in `ai/structured.ts`: budget check → primary model (cheap model if >80% of the neuron budget is spent) → one repair call quoting the error → one fallback-model call → `{ ok: false, reason: 'budget' | 'invalid_output' | 'llm_error' }`. Every call is counted in `usage_daily` using reported token usage or a chars/4 estimate. `reason: 'budget'` lets M7 mark work `deferred`.
- **Upload validation:** declared type must be PDF/DOCX and the first bytes must agree (`%PDF-` / `PK\x03\x04`); a generic `application/octet-stream` defers to the sniffed type. Size limit is `settings.cvs.maxUploadBytes` (5 MB), enforced in the service; a fixed 16 MB body cap protects memory before the file is read. Stored file names are sanitised.
- **Active CVs:** max `settings.cvs.maxActive` (4); both uploading and re-activating over the limit return 409. Inactive CVs keep their vector but must be excluded by scoring (M5/M7).
- **Embedding model is fixed at container construction** from `DEFAULT_SETTINGS.models`: changing it would invalidate every stored vector, so it is deliberately not hot-swappable through Settings.
- **The web app uses `fetch` + shared Zod schemas, not the Hono RPC client** the plan names: importing the Worker's types into the web project would pull Cloudflare globals into a DOM project. Response shapes are still validated against the shared schemas, so client and server cannot drift silently.
- **Embedding text** is the summary's headline, seniority, skills, sectors and roles followed by the CV text, truncated to 2,000 characters (≈500 tokens, SPEC §3.3).

### M4 follow-up (2026-11-20)

- **Vectorize filtering moved into the adapter.** Server-side filters need metadata indexes created up front with the Wrangler CLI (`create-metadata-index`), which is fragile to run and impossible to add after vectors exist. `VectorizeStore.query` now over-fetches (4× `topK`, capped at Vectorize's 20-match limit when metadata is requested) and filters by `kind` and `postedTsGte` locally. Same results for our tiny neighbour sets; no CLI step. Metadata is still written (`kind`, `posted_ts`, `group_id`), so server-side indexes can be added later if volumes ever need them. The `posted_ts`/`kind` index step is removed from the setup docs.
- **Setup is dashboard-only.** The project owner is not technical: operational steps are written as dashboard clicks, not terminal commands.
