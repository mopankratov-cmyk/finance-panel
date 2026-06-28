# Reels Brain Roadmap

## Current State In Branch

- Platform-specific brains exist for `tiktok`, `instagram`, `youtube`.
- `source-run` remembers preferred providers by platform in `niche_playbooks.playbook.reels_brain_sources`.
- `loop` can auto-relearn weak intake with bake-off and retry.
- `digest`, `digest-all`, `summary`, `alerts`, `studio`, `ops` and the operator console are wired together.
- Daily and weekly automation routes exist:
  - `GET/POST /api/factory/jobs/reels-brain-daily`
  - `GET/POST /api/factory/jobs/reels-brain-weekly`
- Read-only owner surfaces exist:
  - `/inferno/vendor/reels-brain-demo`
  - `/inferno/vendor/reels-brain-report?niche=...`
  - `/inferno/vendor/reels-brain-portfolio`

## Hard Blocker First

- Current local `next dev` runtime returns `404` for `app/api/factory/*` routes, including old existing routes.
- Until that is fixed, no honest end-to-end runtime validation is possible for the new Reels Brain routes.
- This is the first critical path item because every later milestone depends on live route execution.

## Month Objective

- Move Reels Brain from “branch-level operator prototype” to “owner-safe internal system” with:
  - stable runtime
  - reliable multi-provider intake
  - platform-specific learning loops
  - owner-level ops visibility
  - rollout readiness without product-wide auth or infra changes

## Corpus Growth Objective

- Grow the active viral corpus to `10,000` videos as the first real nasmotrennost milestone.
- Default platform allocation:
  - `TikTok`: `4,000`
  - `Instagram`: `3,500`
  - `YouTube`: `2,500`
- Default niche allocation is split evenly across the active niche set.
- Stage gates:
  - `300`: seed corpus
  - `1,500`: learning baseline
  - `4,000`: operator-grade brain
  - `10,000`: full corpus target
- Daily/weekly automation should be most aggressive while each platform is below `25%` of its target.
- Default execution horizon:
  - plan against a `42-day` ramp
  - expose daily and weekly intake quotas in owner-facing read models

## Week 1: Runtime And Control Plane

### Goals

- Restore live execution of `app/api/factory/*` routes in local dev/runtime.
- Close the gap between code-level readiness and runtime truth.
- Stabilize the control plane for daily/weekly learning loops.

### Tasks

- Investigate why `next dev` does not register `app/api/factory/*`.
- Re-run smoke for:
  - `/api/factory/ops`
  - `/api/factory/studio`
  - `/api/factory/reels-brain/providers`
  - `/api/factory/reels-brain/digest-all`
  - `/api/factory/jobs/reels-brain-daily`
  - `/api/factory/jobs/reels-brain-weekly`
- Validate that `ops` and `studio` include the new `reels_brain` snapshots at runtime, not only by typecheck.
- Verify `/agent/reels-brain` loads and can call the new automation buttons without runtime exceptions.
- Capture any route-level errors and normalize them into actionable operator diagnostics.

### Deliverables

- Runtime fix or documented root cause with exact reproduction.
- Green smoke for core Reels Brain routes.
- Updated release checklist with real runtime evidence.

### Exit Criteria

- Existing and new factory API routes return live JSON in local runtime.
- Owner console and read-only reports can fetch live Reels Brain data.

## Week 2: Intake Reliability And Provider Selection

### Goals

- Make intake reliable enough that daily learning is not dominated by empty or weak runs.
- Pick provider winners per platform based on quality and operational cost.

### Tasks

- Run bake-off comparisons on real niches for:
  - `TikTok`
  - `Instagram`
  - `YouTube`
- Evaluate providers on:
  - relevance
  - inserted volume
  - latency
  - timeout frequency
  - failure frequency
  - cost tier
- Confirm that the preferred provider memory does not flap on weak margins.
- Expand query rotation so the system does not overuse the same query lane.
- Add more niche-aware query seeds from:
  - winner hooks
  - top formats
  - platform defaults
- Tighten weak-intake handling:
  - empty intake
  - low yield
  - stale provider
  - repeated provider drift

### Deliverables

- Per-platform provider shortlist.
- Better default query packs for main niches.
- Stable provider memory behavior under repeated runs.

### Exit Criteria

- Daily runs produce non-trivial intake on core niches often enough to sustain learning.
- Provider winner choice is defensible per platform, not just globally.

## Week 3: Learning Quality And Brain Depth

### Goals

- Improve the quality of what the brain learns, not only the amount of data it ingests.
- Separate platform-specific pattern memory more clearly.

### Tasks

- Review analyze output quality for hook/format/sound extraction.
- Tighten corpus quality gates per platform:
  - minimum videos
  - analyzed coverage
  - pattern density
  - winners density
- Improve pattern build confidence:
  - cleaner top hooks
  - stronger pattern frequency signals
  - less noisy cross-platform transfer
- Add clearer separation between:
  - platform brain
  - meta brain
  - cross-platform reusable ideas
- Review whether playbook-backed history is still enough for:
  - provider history
  - query leaderboard
  - incidents
  - automation learnings

### Deliverables

- More trustworthy platform-specific brains.
- Better readiness scoring tied to actual corpus quality.
- Decision on whether persistent tables are needed next.

### Exit Criteria

- Readiness signals correlate with actual corpus depth.
- Pattern memory for `TikTok`, `Instagram`, `YouTube` is not visibly collapsed into one average short-form style.

## Week 4: Ops Productization And Rollout Readiness

### Goals

- Make Reels Brain operable by an owner without ad hoc debugging.
- Prepare staged rollout without touching forbidden zones.

### Tasks

- Finalize owner-facing monitoring paths:
  - `ops`
  - `studio`
  - `/agent/reels-brain`
  - read-only portfolio/report routes
- Add daily/weekly owner workflow documentation:
  - when to run daily loop
  - when to run weekly retrain
  - when to inspect incidents
  - when to escalate provider changes
- Browser QA on:
  - operator console
  - report route
  - portfolio route
- Update release checklist with:
  - API smoke
  - UI smoke
  - operator workflow smoke
- Define rollout stages:
  - branch-only validation
  - owner internal usage
  - limited niches
  - wider internal rollout

### Deliverables

- Owner-safe operational flow.
- Release-ready checklist and rollout sequence.
- Explicit list of deferred items outside the current worker mandate.

### Exit Criteria

- Owner can inspect health, trigger retrain, and read portfolio state without code changes.
- Rollout can happen niche-by-niche with low blast radius.

## Critical Path

1. Runtime route registration must work.
2. Provider selection must be stable enough for daily intake.
3. Learning quality must be high enough that new data improves the brain.
4. Ops visibility must be clear enough that failures are obvious before rollout.

## Deferred Outside Current Mandate

- Auth, middleware, proxy changes.
- Shared infra refactors outside content-factory zone.
- SQL migrations outside approved scope.
- Product-wide UI rollout outside content-factory surfaces.

## Success Definition At Month End

- Reels Brain runs daily and weekly loops with live runtime validation.
- Each main platform has a defensible preferred provider and fallback behavior.
- Owner-facing ops surfaces show readiness, incidents, drift, and weakest niches.
- The system is ready for controlled internal rollout without a painful product merge.
