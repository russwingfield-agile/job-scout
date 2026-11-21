# Runbook

Skeleton — filled out progressively; completed in M10.

## Local setup

```sh
pnpm install
cp apps/worker/.dev.vars.example apps/worker/.dev.vars   # then add REED_API_KEY
pnpm db:migrate:local                                        # create/upgrade the local D1 (run once, and after new migrations)
pnpm dev                                                  # http://localhost:5173 (needs `wrangler login`; or `REMOTE_BINDINGS=false pnpm dev` offline)
pnpm check                                                # typecheck + lint + test + build
```

`apps/worker/.dev.vars` is gitignored. Never commit secrets.

> `pnpm deploy` is a built-in pnpm command, not our script. Always use `pnpm run deploy`.

## Cloudflare hosting (Workers Free plan)

Live site: https://job-scout.russ-wingfield.workers.dev (first deployed 2026-11-19).

Currently enabled bindings: **D1** (`DB`) and **Workers AI** (`AI`). R2, Vectorize and Queues are
commented out in `apps/worker/wrangler.jsonc` until the milestone that needs them (M4 and M5), because a
deploy fails if a bound resource does not exist.

### 1. Log in and create the database

```sh
wrangler login
wrangler d1 create job_scout_db        # copy the printed database_id into apps/worker/wrangler.jsonc
pnpm db:migrate:remote
```

The `database_id` is not a secret; commit it.

### 2. First deploy (manual)

```sh
pnpm run deploy                        # prints https://job-scout.<your-subdomain>.workers.dev
```

Until Access is configured (step 4) every `/api` route except `/api/health` returns 401 — this is intentional
(fail closed). The SPA shell itself is static and loads regardless.

### 3. Deploy from `main` (GitHub Actions)

`.github/workflows/deploy.yml` runs on every push to `main`: `pnpm check` → remote D1 migrations → deploy.
Add two repository secrets (GitHub → Settings → Secrets and variables → Actions):

| Secret | Where to get it |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → right-hand sidebar |
| `CLOUDFLARE_API_TOKEN` | My Profile → API Tokens → Create Token → use the **Edit Cloudflare Workers** template, then add **Account → D1 → Edit** |

Add further permissions (R2, Vectorize, Queues → Edit) when those milestones turn the bindings on.
The workflow's `production` environment can be given required reviewers if you want a manual approval gate.

### 4. Protect the site with Cloudflare Access

A `*.workers.dev` hostname cannot be added as a normal self-hosted Access application (it is not a zone in
your account). Enable Access from the Worker itself:

1. Workers & Pages → `job-scout` → Settings → Domains & Routes → the `workers.dev` row →
   **Enable Cloudflare Access**. The policy allows Cloudflare account members (i.e. you). With "All traffic"
   every URL, including `/api/health`, redirects to the Access sign-in page.
2. Find the values the Worker needs. The team domain and AUD tag are visible (non-secret) in the sign-in
   redirect: `curl -sI https://<host>/inbox` shows `Location: https://<team>.cloudflareaccess.com/...`, and the
   `meta` JWT payload's `aud` is the application AUD tag. Or: Zero Trust → Access → Applications → the Worker's
   application → Overview.
3. The team domain and AUD tag are **not secrets**: they live in `apps/worker/wrangler.jsonc` under `vars`
   (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`). If the Access application is ever re-created, copy its new Audience tag there and push.
   Optionally restrict to one identity with a Worker secret `OWNER_EMAIL` (Workers & Pages → job-scout → Settings →
   Variables and Secrets → Add → Secret); without it, any valid sign-in to this Access application is accepted.

Verify: an unauthenticated `curl https://<host>/api/settings` is blocked by Access (or 401 from the Worker),
while the signed-in browser session works.

### Free-plan limits to keep in mind (checked 2026-11-19)

- Queues are available on Free: 10,000 operations/day, 24 h message retention.
- Workers AI: 10,000 neurons/day free; over that, requests fail with HTTP 429 (error 3036).
- Workers Free: 100,000 requests/day, 50 subrequests and 10 ms CPU per invocation.
- Vectorize: Cloudflare's docs disagree on Free-plan availability — confirm with `wrangler vectorize create`
  before M4.

## Remaining setup (M10)

TODO: R2 bucket, Vectorize index + metadata indexes (`kind` string, `posted_ts` number), queues + DLQ,
secrets rotation, inspecting the DLQ, replaying a run, tuning thresholds.

## Trying the Reed probe locally (dev only)

With `REED_API_KEY` in `apps/worker/.dev.vars` and the dev server running, a real search plus the first few
adverts, normalised:

```sh
curl -X POST http://localhost:5173/api/dev/reed-probe -H "Content-Type: application/json" \
  -d '{"keywords":"agile coach","location":"London","employmentTypes":["contract"],"detailsCount":3}'
```

The route returns 404 unless `ENV=dev`. Every call counts against the daily Reed budget. To record a new fixture:
`node scripts/record-reed-fixture.mjs details <name> <jobId>` (or `search <name> key=value ...`).

## Enabling CV storage (R2)

The CV upload endpoint returns 503 `NOT_CONFIGURED` until an R2 bucket exists and its binding is enabled.
Create the bucket in the Cloudflare dashboard (no command line needed):

1. Storage & databases → R2 object storage → Create bucket → name `job-scout-cvs` (leave defaults).
2. Uncomment the `r2_buckets` block in `apps/worker/wrangler.jsonc`, run `pnpm cf:types`, and push.

If the Deploy workflow then fails with an authentication error, add **Workers R2 Storage → Edit** to the
`CLOUDFLARE_API_TOKEN` (Cloudflare → My Profile → API Tokens → edit the token). R2 needs a payment method on file.

CV and job fingerprints (embeddings) are stored in D1 — **no Vectorize index is needed** (see DECISIONS.md).

## Enabling the job pipeline (queues + Reed key)

"Run now" and the scheduled scans need two queues and the Reed key on the live site. All of it is dashboard clicks:

1. **Queues** (Cloudflare → Workers & Pages → Queues → Create queue; leave jurisdiction at the default, which cannot be
   changed later): create `fetch-q`, `process-q` and `job-scout-dlq` (the dead-letter queue for failed messages).
2. **Token permission:** My Profile → API Tokens → edit `job-scout-github-deploy` → add **Account → Queues → Edit**.
3. **Reed key:** Workers & Pages → `job-scout` → Settings → Variables and Secrets → Add → type **Secret**, name
   `REED_API_KEY`, paste the key → Deploy.
4. Uncomment the `queues` block in `apps/worker/wrangler.jsonc` and push.

Until then, "Run now" shows "Job queues is not configured" and scheduled slots record a failed run saying the same.

## Enabling AI assessment (M7: `score-q`)

The AI-assessment step needs one more queue. Cloudflare → Workers & Pages → Queues → Create queue → name it exactly
`score-q` (default jurisdiction). The deploy token already has Queues permission. It must exist **before** the M7 code is
deployed, because `wrangler.jsonc` binds it and a deploy fails if the queue is missing.

## Day-to-day

- **Scans** run on the schedule in Settings (UK time). **Run now** on the Runs page starts one by hand.
- **Start fresh** after changing a CV, profile or filters: Inbox → *Clear all found jobs*, then Run now. Jobs you shortlisted, applied for or skipped are kept.
- **Delete everything** (jobs, CVs, files, history; settings stay): Settings → Danger zone, type `DELETE EVERYTHING`.
- **AI allowance:** the header shows today's AI use. When it is spent, jobs wait ("deferred") and are assessed in the next scan after the allowance resets (midnight UTC).
- **Reed key:** rotate it in Cloudflare → Workers & Pages → `job-scout` → Settings → Variables and Secrets → `REED_API_KEY`.
- **Failed messages** end up in the `job-scout-dlq` queue; the Runs page shows each run's errors.

## Adding Adzuna as a second job source

1. Create a free account at developer.adzuna.com and copy the **Application ID** and **Application Key** (Dashboard / API Access).
2. Cloudflare → Workers & Pages → `job-scout` → Settings → Variables and Secrets → Add: type **Secret**, name `ADZUNA_APP_ID`, paste the ID; add a second secret `ADZUNA_APP_KEY` with the key; Deploy.
3. Click **Run now**. The Runs page "Reed calls" column counts Reed only; Adzuna's calls are in each run's detail. Jobs from Adzuna show "via Adzuna" on their card.
4. To switch it off, delete either secret. To limit use, lower the Adzuna limits in the settings (`budgets.adzunaDailyRequestBudget`).
