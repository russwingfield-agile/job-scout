# Runbook

Skeleton — filled out progressively; completed in M10.

## Local setup

```sh
pnpm install
cp apps/worker/.dev.vars.example apps/worker/.dev.vars   # then add REED_API_KEY
pnpm dev                                                  # http://localhost:5173 (needs `wrangler login`; or `REMOTE_BINDINGS=false pnpm dev` offline)
pnpm check                                                # typecheck + lint + test + build
```

`apps/worker/.dev.vars` is gitignored. Never commit secrets.

## Placeholder resource IDs

`apps/worker/wrangler.jsonc` ships with a placeholder D1 `database_id` (all zeros). Create the real database with
`wrangler d1 create job_scout_db` and replace the id before any remote migration or deploy.
The `AI` and `VEC` bindings are marked `"remote": true`, so `pnpm dev` talks to real Workers AI / Vectorize
(requires `wrangler login`).

## One-time Cloudflare setup (M10)

TODO: D1, R2, Vectorize (+ metadata indexes), queues + DLQ, secrets, Access application.

## Deploy / rotate keys / inspect DLQ / replay a run / tune thresholds

TODO (M10).
