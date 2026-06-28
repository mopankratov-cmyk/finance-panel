# Reels Brain Ops Runbook

## Daily Check

1. Open `/agent/reels-brain`.
2. Review `Reels Brain Health` for all three platforms.
3. Watch for:
   - `weak` readiness
   - stale preferred provider
   - provider drift
   - empty / low-yield incidents
4. If a platform is weak:
   - run `Mini bake-off`
   - then run `Source refresh`
   - then run `Loop`

## Owner Decision Rules

- `inspect_incidents`: open alerts first; use this when critical incidents are present
- `weekly_retrain`: use when niche average readiness is structurally low across platforms
- `mini_bake_off`: use when provider drift is detected or provider quality feels unstable
- `source_refresh`: use when preferred provider age is stale but the lane is otherwise understandable
- `loop`: use when the lane mostly works but corpus depth is still weak
- `monitor`: no manual action needed beyond periodic review

## Healthy State

- readiness score is high
- no recent `critical` incidents
- preferred provider is not stale
- query leaderboard has at least a few proven queries
- corpus has enough videos / analyzed rows / patterns / winners

## When Intake Is Weak

1. Check incident feed.
2. Check current preferred provider.
3. Run `Mini bake-off` on the weak platform.
4. Confirm provider memory updated.
5. Run `Source refresh` with the top recommended query.
6. If needed, run `Loop` to rebuild pattern memory.

## Local Runtime Note

- Current local split:
  - `next dev` on Turbopack returns false `404` for `app/api/*` in this repo
  - `npx next dev --webpack` serves the same routes correctly
- Until that repo-level issue is fixed, local API smoke should be run against webpack dev.
- Practical command:
  - `npx next dev --webpack --port 3008`

## Daily Automation Loop

- Route: `GET /api/factory/jobs/reels-brain-daily`
- Auth: `Authorization: Bearer $CRON_SECRET`
- Safe defaults:
  - `max_niches=3`
  - `platforms=tiktok,instagram,youtube`
  - `query_count=2`
  - `source_limit=18`
  - `analyze_limit=6`
- What it does:
  - pulls the next recommended queries per niche/platform
  - runs platform-specific `reels-brain/loop`
  - lets auto-relearn fire when intake is weak
  - returns a fresh digest snapshot for each niche
- Recommended cron:
  - every day, one lightweight pass
  - example: `0 4 * * *`

## Growth Automation Loop

- Route: `GET/POST /api/factory/jobs/reels-brain-growth`
- Auth: `Authorization: Bearer $CRON_SECRET`
- `GET` returns the prioritized weakest `niche x platform` queue.
- `POST` executes that queue unless `dry_run=true`.
- Safe defaults:
  - `max_lanes=3`
  - `platforms=tiktok,instagram,youtube`
  - `mode=daily`
- Use when:
  - corpus is far below the `10k` target
  - `/api/factory/ops` reports `reels_brain_corpus_gap_large`
  - owner wants volume growth before deeper quality tuning
- Useful params:
  - `niches=toys,clothing,cosmetics,default`
  - `platforms=tiktok,instagram,youtube`
  - `max_lanes=3`
  - `mode=daily`

## Weekly Deep Retrain

- Route: `GET /api/factory/jobs/reels-brain-weekly`
- Auth: `Authorization: Bearer $CRON_SECRET`
- Safe defaults:
  - `max_niches=2`
  - `platforms=tiktok,instagram,youtube`
  - `query_count=4`
  - `source_limit=24`
  - `analyze_limit=12`
  - `persist_memory=true`
- What it does:
  - runs a platform bake-off before the learning loop
  - persists the winner back into provider memory
  - runs a deeper loop with broader query coverage
  - returns a post-run digest per niche
- Recommended cron:
  - once a week for deep refresh
  - example: `0 3 * * 1`

## When Provider Drift Happens

- Drift is not automatically bad.
- If the new champion is close to the old one, anti-flap keeps memory stable.
- If drift keeps repeating, monitor:
  - query leaderboard
  - stale age
  - incident frequency

## Weekly Check

1. Review `/api/factory/reels-brain/digest?niche=...`.
2. Review `/api/factory/reels-brain/alerts?niche=...`.
3. Confirm `reels-brain-daily` is landing fresh intake each day.
4. Confirm `reels-brain-weekly` is refreshing provider memory with bake-offs.
4. Check public read-only report:
   - `/inferno/vendor/reels-brain-report?niche=...`
5. Check portfolio report:
   - `/inferno/vendor/reels-brain-portfolio`
   - if a platform shows `shift old->new` and `retry retry_shifted_provider`, the lane already relearned and should be rechecked on the new provider before running a broader retrain
6. Run smoke:
   - `CRON_SECRET=... node lib/factory/reelsBrainSmoke.mjs --base-url http://127.0.0.1:3008 --check-ops`
7. Check owner ops snapshot:
   - `/api/factory/ops`
   - verify `reels_brain.retry_queue` and `suggested_actions`
   - if present, `retry_reels_brain_shifted_provider` takes priority over generic daily loop

## Rollout Sequence

1. Branch-only validation:
   - API smoke on webpack dev
   - UI smoke on `/agent/reels-brain`, report, portfolio
2. Owner internal usage:
   - daily cron enabled
   - weekly retrain run manually first, then scheduled
3. Limited niches:
   - keep `toys`, `clothing`, `cosmetics`
   - watch drift and incident rate for one week
4. Wider rollout:
   - add more niches only if queue remains manageable and provider winners stay stable

## Preview QA Result

- On June 27, 2026, preview browser QA confirmed:
  - `/login` opens normally
  - `/agent/reels-brain` redirects into auth correctly
  - after login, the live `Self-learning Reels Intelligence Brain` console opens in preview
- This closes the week-4 auth/access concern for operator usage on preview.

## Escalation Notes

- Separate DB tables for incidents/history are intentionally deferred.
- Current persistence is playbook-backed.
- If history depth becomes too small or analytics gets noisy, the next owner step is dedicated migrations and long-lived history storage.
