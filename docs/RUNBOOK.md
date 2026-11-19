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

1. Zero Trust → Access → Applications → Add application → Self-hosted. Application domain = the
   `job-scout.<subdomain>.workers.dev` hostname. Policy: Allow, include your email only.
2. Copy the application's **Audience (AUD) tag** and your **team domain** (`<team>.cloudflareaccess.com`).
3. Set Worker secrets:

```sh
wrangler secret put ACCESS_AUD --config apps/worker/wrangler.jsonc
wrangler secret put ACCESS_TEAM_DOMAIN --config apps/worker/wrangler.jsonc
wrangler secret put OWNER_EMAIL --config apps/worker/wrangler.jsonc
```

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
