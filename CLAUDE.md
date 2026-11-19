# Job Scout — agent instructions

Read docs/SPEC.md (behaviour) and docs/IMPLEMENTATION_PLAN.md (structure, order) before any work.

## Workflow
- Work milestone by milestone (IMPLEMENTATION_PLAN Part 3). Do not skip ahead.
- Before finishing any task run `pnpm check`; it must pass. Never disable, skip or weaken a test to make it pass.
- Commit after each task with conventional commit messages.
- Record any deviation from the plan/spec, and every verified external fact (Reed fields, model IDs), in docs/DECISIONS.md.

## Architecture rules
- core/ is pure: no env, no fetch, no Cloudflare types. Put all logic you can here and test it table-driven.
- Bindings only via ports/ interfaces; real implementations in adapters/; wired only in container.ts.
- All DB access via db/repos. Schema changes only via drizzle schema + `pnpm db:generate`; never edit an applied migration.
- Every queue handler must be idempotent and must update run counters exactly once (processed_messages).
- Every tunable value comes from settings (config/defaults.ts), never a magic number inline.
- LLM calls only via ai/structured.ts (or the cover-note helper); prompts are versioned; bump PROMPT_VERSION on change.
- Zod schemas live in packages/shared; infer types, don't hand-write duplicates.

## Style
- TypeScript strict; no `any` (use `unknown` + parse). Biome formatting.
- Small functions; name things after the domain (group, posting, profile, run).
- UI: Tailwind, components in components/ui; every async action has loading, error and empty states; optimistic updates with undo for triage actions.

## Commands
pnpm dev | pnpm check | pnpm test | pnpm db:generate | pnpm db:migrate:local | pnpm cf:types | pnpm run deploy

## Never
- Scrape websites. Only official APIs/RSS.
- Commit secrets (.dev.vars is gitignored).
- Send CV contents anywhere except Workers AI.
