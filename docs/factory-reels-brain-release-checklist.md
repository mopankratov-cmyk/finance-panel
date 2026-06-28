# Reels Brain Release Checklist

## Core Checks

- `source-run` works for `tiktok`, `instagram`, `youtube`
- `bake-off` returns provider ranking and stable winner
- `loop` can auto-relearn when intake is weak
- `summary` returns readiness, drift, queries, incidents
- `alerts` API returns current incident feed
- `digest` API returns compact operational snapshot
- `digest-all` returns multi-niche portfolio state
- `ops` returns `reels_brain` portfolio verdict and weakest niches
- `digest` / `digest-all` expose `provider_shift` and `retry_signal` per platform
- `ops` exposes `reels_brain.retry_queue` and owner-level shifted-provider pressure
- `digest-all` exposes `corpus_goal` progress toward `10,000` videos

## UI Checks

- `/agent/reels-brain` loads without runtime errors
- health cards render for all platforms
- `Mini bake-off` works
- `Source refresh` works
- query leaderboard populates
- incident feed renders
- if `/agent/reels-brain` redirects to `/login`, verify auth separately; login/runtime fixes are outside the current Railway worker mandate
- preview browser QA confirmed on June 27, 2026:
  - login page opens without server crash
  - post-login navigation reaches `/agent/reels-brain`

## Read-only Checks

- `/inferno/vendor/reels-brain-demo` still works
- `/inferno/vendor/reels-brain-report?niche=...` renders live read-only state
- `/inferno/vendor/reels-brain-portfolio` renders live multi-niche queue with priorities, reasons, platform and query
- portfolio report renders lane-shift and retry hints inline for weak platforms

## Technical Checks

- `npx eslint ...`
- `npx tsc --noEmit`
- targeted test files pass
- smoke script supports `--platform`
- smoke script supports `--check-ops`
- smoke script can validate `digest-all` against a chosen niche set
- local API smoke is executed through `npx next dev --webpack` until Turbopack route registration is fixed

## Operator Workflow Smoke

- daily route works with `Authorization: Bearer $CRON_SECRET`
- weekly route works with `Authorization: Bearer $CRON_SECRET`
- growth route works with `Authorization: Bearer $CRON_SECRET`
- `ops` highlights weakest niches and recommended actions
- `ops` prefers `retry_reels_brain_shifted_provider` when the brain already selected a new provider lane
- portfolio route shows actionable queue, not only aggregate counts
- portfolio route shows `10k` corpus progress and per-platform target split
- preview operator entry path is verified:
  - `/agent/reels-brain` -> auth redirect -> login -> live operator console

## Rollout Stages

- Stage 1: branch-only validation on webpack dev
- Stage 2: owner internal usage on read-only routes plus `/agent/reels-brain`
- Stage 3: limited rollout on `toys`, `clothing`, `cosmetics`
- Stage 4: wider internal rollout after provider drift and incident rate stay acceptable for one week

## Deferred By Design

- SQL migrations for dedicated incidents/history tables
- product-wide auth or middleware changes
- shared infra refactors outside content-factory zone
