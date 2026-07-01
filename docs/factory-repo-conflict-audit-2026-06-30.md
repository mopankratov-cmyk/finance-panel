# Аудит конфликтов репозитория finance-panel

_Дата: 2026-06-30 · ветка `feat/factory-v2-product-broll` · многоагентный аудит (59 агентов, 8 направлений)_

_Находок: 50 · подтверждено: 44 · опровергнуто/понижено: 6_

## Статус на 2026-07-01

Этот файл оставлен как исторический аудит и чеклист решений, а не как актуальное описание `main`.

Закрыто после аудита:

- Product Twin baseline влит в `main` через PR #92.
- Reels Brain cost governor, cockpit polish и paid autopilot guard влиты через PR #93, #95, #98.
- FAL billing-key fallback для frames влит через PR #94.
- HeyGen visual/audio modes влиты через PR #96.
- `frames_unavailable` soft OTK signal влит через PR #97.
- Remote branch graveyard частично очищен на сервере; локальный `git fetch --prune` удалил старые remote refs.

Осталось как активные follow-up темы:

- не blind-merge старые graphRun/runtime ветки;
- rescue только точечных уникальных модулей из divergent branches;
- marketplace/migration ветки только через владельца;
- унифицировать quality canon и generic-opener blocklist;
- держать Product Twin как prepared-tier source и запускать b-roll маленькими paid smoke batch после visual QA.

См. также:

- `docs/factory-quality-canon.md`
- `docs/factory-product-twin-broll-operator.md`
- `docs/factory-product-twin-visual-qa.md`


## Резюме

HEAD (feat/factory-v2-product-broll) is a clean, build-green, in-mandate 27-commit superset of production (gitea/main): tsc passes, 125/125 contract tests pass, lint is clean, and HEAD..gitea/main is empty. There are ZERO merge collisions, broken contracts, or scope violations introduced BY HEAD — it is safe to merge as the new prod baseline. The real risks live around it, in three forms. (1) BRANCH GRAVEYARD: ~40 local branches, ~28 fully contained in HEAD (safe-delete), but ~10 divergent branches carry genuinely-stranded in-mandate work AND collide hard with HEAD's now-shipped files (worker-runtime-cleanup, reels-brain-m1-m3, codex/factory-m1-m3). Merging any of them blindly REVERTS HEAD's watchdog/poll-stuck hardening — the single most dangerous action available. (2) PRODUCT-TWIN + REELS-BRAIN ISLANDS: HEAD's own flagship Product-Twin / clean-first B-roll pipeline (+5760 lines, 8 routes) is shipped dark — graphRun, batch, studio.html and the console never call it; this is intentional Month-1 phasing per the 6-month design doc, but reviewers will mistake it for live. Separately, feat/reels-brain-source-economics is a complete ~27-module intelligence layer that merges CLEANLY today and is the single highest-value clean rescue available. (3) QUALITY-GATE FRAGILITY: the OTK bank gate requires basis='model', so one missing/misconfigured env key (FAL_KEY or ANTHROPIC_API_KEY — and extractFrames doesn't even honor FAL_BILLING_KEY) forces every video to a non-banked 'warning' state, fully explaining the prior-audit '0 passed OTK' as a config/runtime issue, NOT a code defect (build-health refutes the 'broken autofill/fal/artifact-check' memory note). The factory also runs 3+ independent rubric/scoring systems and triplicated opener-blocklists that have drifted, and artifact-check is implemented twice with the richer prompt living in the DEAD HTTP route while the live pipeline uses the lib copy. Net: merge HEAD, prune the 28 contained branches, make explicit ship/abandon calls on ~10 divergent branches (escalating owner-only migration/vercel work), rescue source-economics cleanly, and treat the env-key/OTK starvation as the top operational fix.


## Группы конфликтов


### 🔴 CRITICAL — Worker/runtime collisions on graphRun.ts (revert risk)

- codex/factory-worker-runtime-cleanup (106 ahead / 70 behind HEAD) is a stale near-rewrite of the same ops files and does NOT contain HEAD's watchdog-hardening commit 79a1b344. Its graphWatchdog.ts REMOVES RENDER_POLL_FORCE_RELEASE_MS (240s), GEN_POLL_FORCE_RELEASE_MS (540s) and the pollStepOverdue() force-release loop HEAD added to free recipes hung in render-poll/gen-poll. A naive take-branch merge SILENTLY reverts that production fix. 22 merge-tree conflicts. It also DELETES ~64 tests (62 vs HEAD's 126), so there is nothing net-new to cherry-pick — the recommendation to salvage opsWorkerInfraStatus/workerStateFailOpenObservability was wrong (those were added on HEAD's side).
- graphRun.ts (1629 lines) is the single hottest file: it collides with SIX divergent branches (worker-runtime-cleanup 12 conflict regions, codex/m1-m3 9, runtime-fixes-small 7, data-retention-audit 6, reels-brain-m1-m3 3, factory-quality-pass 3); graph-run/route.ts collides with three. Any parallel auto-merge of two graphRun-touching branches will compound.
- codex/factory-m1-m3 & runtime-fixes-small lack HEAD's render-poll wall-clock guard (MAX_RENDER_POLL_MS=180000 + timedOutByWallClock). They predate it (not a deliberate revert); a careless merge produces a LOUD compile error (constant referenced but undeclared), not a silent regression — lower risk than worker-runtime-cleanup.
- DISPUTED/downgraded: worker-runtime-cleanup's graph-run/cron diff was framed as a 'design contradiction' dropping HEAD's reels-brain coupling + maxDuration=120; verified it merely predates both (added on HEAD post-fork). Resolve toward HEAD; no owner decision needed. Not a contradiction.

**Что делать:** Do NOT merge worker-runtime-cleanup as-is — it is strictly older than HEAD's graphRun/graphWatchdog/observability. Close it or fully rebase on HEAD; do not cherry-pick (no net-new tests). Serialize all runtime-branch integration: land at most one graphRun-touching branch at a time, rebase each onto the prior HEAD, and re-run graphRunBatchIdContract / graphRunInternalFetchContract / autofillTickTimeout between merges. Never auto-merge two graphRun branches in parallel.


### 🟠 HIGH — Branch graveyard & stranded in-mandate work

- ~28 of ~40 local branches are fully contained in HEAD (superseded, zero stranded files) — safe to delete; feat/factory-quality-pass is one such: +12/-129 vs HEAD, ZERO files absent from HEAD, all 13 merge-tree conflicts are stale dups, and merging it would resurrect an INFERIOR migration (supabase/migrations/20260627_gen_source_url_uniq.sql lacks HEAD's kind='video' btree-size guard that prevents carousel base64 overflow).
- codex/factory-runtime-fixes-small is a strict linear ANCESTOR of codex/factory-m1-m3 (its tip == m1-m3's parent); it carries nothing m1-m3 lacks. Duplicate branch — delete it, consolidate rescue on m1-m3.
- feat/reels-brain-m1-m3 (141 ahead / 80 behind HEAD) strands ~46 in-mandate files absent from HEAD (lib/factory/hookJudge.ts, costEstimate.ts, recipeDraft.ts, decomposeRouting.ts, winnerPreset.ts + ~30 *FailOpen/*Contract.test.mts) — real wired logic. But HEAD already pursues the same fail-open theme MORE extensively (63 such files vs branch's 23) and the branch produces 31 real merge-tree collisions including add/add on the reels-brain core. Rescue = deliberate cherry-pick of the unique modules, not a clean merge.
- Two stranded NON-factory marketplace branches carry work in NEITHER prod NOR HEAD: feat/wb-ad-docking (migration 20260627_advert_docking.sql + adverts dock cron + lib/adverts/*) and feat/wb-ctrtest (migration 20260628_ctrtest_engine.sql + ctrtest engine + cron). These encode schema intent that is lost if pruned. (Note: the report's other 3 cited finance branches — wb-repricer, wb-signals, unit-price-solver — are already shipped to prod via PR #18 etc.; their 'stranded' framing was a stale-base artifact.)

**Что делать:** Triage in three buckets. DELETE the 28 contained branches and codex/factory-runtime-fixes-small + feat/factory-quality-pass after a confirmation glance. RESCUE-DECISION the divergent in-mandate branches (m1-m3, worker-runtime-cleanup, source-economics, the codex archive branches) per the per-branch actions below. ESCALATE the two genuinely-stranded marketplace branches (wb-ad-docking, wb-ctrtest) to the owner since they carry owner-only migrations + vercel.json crons.


### 🟠 HIGH — Reels-Brain sprawl & stranded intelligence layer

- feat/reels-brain-source-economics merges into HEAD with EXIT 0 / zero conflicts (independently re-verified) yet strands a complete, self-contained ~27-module intelligence layer (14 new routes incl. audio/visual-intelligence, experiment-brain, portfolio-manager, simulation + 13 lib modules, +6411/-165). All imports resolve against in-HEAD modules. Highest-value clean rescue available — but currently stranded.
- feat/reels-brain-m1-m3 independently re-created HEAD's foundational reels-brain core (add/add conflicts on reelsBrain.ts/reelsBrainSources.ts/reelsBrainPatterns.ts + 6 routes). HEAD is a strict superset (PR-merged #53-#85 line); a whole-branch merge would regress production reels-brain.
- Two parallel ingest pipelines write viral_videos via makeViralVideoRows with divergent cost protection: bulk-ingest is budget-gated (reelsBrainBudget); source-run / corpus-tick fallback are NOT. Bounded by url-keyed idempotent upsert (no data corruption) and per-tick budget caps — inconsistent cost surface, not a data bug.
- reels-brain-cron runs on TWO overlapping schedules: vercel */5 directly AND graph-run/cron */2 piggybacks it via internalFetch. No lease/dedupe (unlike graphRun's CAS lease), so overlapping ticks double-SPEND provider budget (the dedupe upsert prevents double-INSERT). Three routes are genuinely dead in production automation: reels-brain-daily, reels-brain-weekly, and the entire scheduler tier (reelsBrainScheduler.ts is a never-executed second control plane). reelsBrainCronGate.ts is superseded dead code (time-slot selector replaced by inline backlog selector). 7 reels-brain ops routes (alerts, discovery/learn|plan, patterns/build-all, provider-debug, reset, score) are orphaned from both consoles; discovery/replay IS wired (deploy.yml) making learn/plan dangling trio members.
- deploy/reels-brain-chat-first-dashboard collides on exactly the two LIVE cron files (reels-brain-cron, reels-brain-bulk-ingest) with contradictory throughput/cost knobs and an opposite design (it DELETED the playbook-learning system HEAD keeps).

**Что делать:** Land feat/reels-brain-source-economics as a dedicated PR SOON (it merges clean today but will conflict once HEAD next edits ReelsBrainConsole.tsx). Treat m1-m3's reels-brain core as superseded — cherry-pick only its unique non-reels modules. Pick ONE ingest path and route corpus-tick/source-run through reelsBrainBudget (or add a short lease). Remove one of the two reels-brain-cron triggers or add a lease/dedupe key. Delete daily/weekly/scheduler/reelsBrainCronGate dead code or document as intentional. Cherry-port wanted cron tuning from the deploy/* branch then retire it.


### 🟠 HIGH — Quality-gate fragility & OTK env-key starvation

- OTK bank gate (graphRun.ts:99-108 isFramesGroundedOtkVerdictPass) banks to the catalog only when basis NOT in {text,fallback,storyboard} AND score>=7 AND artifactOk. basis='model' requires frames>0 (qaGates.ts:154); extractFrames returns [] when FAL_KEY is unset (serverMedia.ts verified — reads ONLY process.env.FAL_KEY, ignores FAL_BILLING_KEY despite falVideo/falImageEdit honoring it); the critic returns 'fallback' when ANTHROPIC_API_KEY is null. So one missing/misconfigured key strands 100% of videos to non-banked 'warning'/draft state regardless of true quality — fully explaining prior-audit '0 passed OTK'. NOT a total loss (videos persist as drafts) and observability.ts:443 + ops/route.ts ALREADY raise graded alerts (critic_text_prefilter_dominates etc.), so it is diagnosable.
- artifact-check implemented twice with divergent prompts: the live pipeline calls runArtifactCheck from lib/factory/qaGates.ts (graphRun.ts:1413, verified) with a SHORT prompt; the richer, more detailed prompt lives in the ORPHANED HTTP route app/api/factory/artifact-check/route.ts that nothing calls. A maintainer editing the obvious route file has zero effect on production gating — silent trap.
- Three+ independent scoring systems over overlapping axes: rubric.ts 5-axis post-render (QA_PASS=7) vs scenarioQuality.ts 7-axis pre-render (QA_THRESHOLD=7, different weights) — same 'hook'/'retention' names, different formulas that flip a script across threshold 7. They run on SEPARATE pipelines (graph vs ugc-creatify) so no single render is double-judged, but the taxonomy collision is a real maintainability hazard. Triplicated (actually quadruplicated) generic-opener blocklists that have drifted: a hook with 'рекомендую' is rejected by candidateSelect but passes hookPolicy and scenarioQuality.
- Pre-render scenario economics gate (analyzeScenarioQuality/selectRenderCandidates) is NOT wired into graphRun — the money-spending producer can reach paid submit/render with only the POST-render OTK gate, exactly the expensive-failure mode the pre-gate was built to prevent. scripts/route.ts is read-only/advisory, so the gate is bypassable on the main path.
- productTwinQuality gate is non-blocking: pickBestTwinAsset (productTwin.ts:147-163) falls back to the best of the FAILING assets when none pass (commit 8c15b9f6 deliberately changed `candidates[0]||null` to a non-service fallback pool), so a twin failing every pixel threshold still yields a paid broll render. Mitigated by kind/risk ordering + independent reject classification, but the gate is illusory.
- DISPUTED/downgraded (do not act): ugcReady is NOT decoupled from quality (production callers derive it from brollReady); the gate/dashboard do NOT disagree on empty OTK basis (both treat empty as pass); canonicalNiche divergence example ('beauty') was factually wrong — the two HEAD copies are byte-identical.

**Что делать:** Top operational fix: add a startup health-check asserting FAL_KEY (or extend extractFrames to honor FAL_BILLING_KEY) and ANTHROPIC_API_KEY; make 'frames-grounded' a soft signal so an infra-starved-but-artifact-OK video banks with a 'frames_unavailable' flag rather than silently routing to warning. Collapse artifact-check to one source (route imports runArtifactCheck or delete the route). Single-source the GENERIC_OPENERS blocklist in standard.ts; unify or explicitly document the two rubric taxonomies. Enforce selectRenderCandidates inside graphRun before the submit step. Decide whether twin readiness flags gate (return null/quarantine) or are advisory.


### 🟡 MEDIUM — Product-Twin integration island (HEAD flagship shipped dark)

- The entire Product-Twin / clean-first B-roll pipeline (8 routes: product-twin/{build,classify,source-pick,smoke,[twin_id],by-article}, product-broll-batch, product-clean-source; +5760 lines) is self-contained with ZERO callers — graphRun, batch/route.ts, studio.html, ReelsBrainConsole all return zero matches. Only entry points are direct HTTP POSTs; the only non-test exerciser is the manual smoke route. This is INTENTIONAL Month-1 phasing per docs/factory-product-digital-twin-6mo-pipeline.md (autonomous wiring scheduled M3, studio UI M4.3), so it is by-design dark for this slice, not a defect — but reviewers will assume autopilot integration that does not exist.
- Twin assets are written under disk='product_twin'. DISPUTED finding corrected: they are NOT 'invisible/dropped' by assetBind.classifyAssets — isReal is true for product_twin so they land in realImages and CAN be coincidentally bound by autopilot as generic raw footage (graphRun has no disk filter). The real (low) issue is missed prioritization: twins get no prepared/canonical priority and product_twin is unregistered in contentDisks.ts/sourceReadiness, so a twin-only article is mis-tiered as 'real' not 'prepared'.
- Genuine duplication (low): two 'clean product source' systems — pre-existing sourcePrep.ts (Nano Banana + Seedream fallback, persists disk='prepared') vs new falImageEdit.runNanoBananaEdit (Nano-only, no Seedream fallback) with a parallel prompt builder. They coexist by explicit design (product-broll-batch branches twinId/cleanFirst/legacy). The FAL queue/poll plumbing is byte-duplicated.
- Latent (low): yandex-stored twin asset.url is a non-fetchable 'yandex-disk:' pseudo-URL; every CURRENT consumer goes through rehostImageForFal which dereferences it, but the build/[twin_id] routes emit the raw pseudo-URL in JSON undocumented — a footgun for any future <img>/video consumer. 'broll' naming overload (Remotion text cards vs product motion video) is orthogonal, low.
- DISPUTED/downgraded: product-clean-source 'persists nothing' is by-design (stateless primitive; persistence lives in the wrappers product-broll-batch/productTwinBuild which DO write content_assets); the route has zero callers.

**Что делать:** Before relying on twins in autopilot, wire pickProductTwin into autoBindAssets with prepared-tier priority and register product_twin in contentDisks.ts/sourceReadiness, OR explicitly document the pipeline as a standalone Month-1 tool so reviewers don't assume integration. Consolidate the FAL nano-banana submit/poll into one shared helper and either give the new path Seedream fallback or document why it drops it. Normalize ProductTwinAsset.url to a real href at read time (resolve via getYandexDiskDownloadHref) or document the pseudo-URL contract.


### 🟡 MEDIUM — Orphaned routes vs live UI surface

- Route surface is ~3x the live UI: studio.html (V3) drives only 33 of ~150 factory routes. 34 routes have no caller anywhere (true orphans).
- Substantive composition/QA routes are dead despite real logic: broll (Remotion b-roll agent) and reel-recompose (reuse amortizer) are end-to-end orphaned; assemble is a redundant reimplementation over the live shotstack lib; /improvement and /scenario-quality are orphaned HTTP shells over logic that IS called directly (batch calls loadImprovementSnapshot from the lib; ugc-creatify calls analyzeScenarioQuality).
- 11 routes are 'disabled for Sprint 1 stability' no-op stubs returning {ok:true,disabled:true} on live HTTP surface (variations, recipe-variants, hook-judge, scenario-rewrite, self-heal, batch-build(+tick), jobs/enqueue|list|tick, graph-run/watchdog). Intentional and self-documented in the UI, but ok:true can mask future-caller integration bugs. The whole hook-pick tournament path is dormant.
- A large route band is reachable ONLY from patrick-legacy.html (190KB legacy console), which sits one click off the patrick.html 'Завод обновлён до V3' redirect (linked from the dashboard tile). ~19 exclusive routes (produce, hybrid-compose, scenario, scripts, director, etc.) several of which overlap V3 equivalents (produce vs graph-run) with no shared contract — two UIs driving two route families.

**Что делать:** Per-route decision: wire broll/reel-recompose into graph-run or mark experimental; drop the /improvement and /scenario-quality HTTP shells (logic is called directly). Delete the 11 Sprint-1 stubs or track them in one 'intentionally disabled' doc. Make an explicit retirement call on patrick-legacy.html and its exclusive routes, or document them legacy-only so contributors don't treat produce/hybrid-compose/scenario as live.


### ⚪ LOW — Yandex-archive triple lineage

- HEAD's lib/factory/yandexArchive.ts (415 lines, 5 exports) is the canonical superset, already merged via PR #86/#89. codex/factory-data-retention-audit carries the PRE-squash 323-line version (1 export, obsolete) and add/add conflicts; codex/factory-yandex-disk-connect carries a 425-line version that auto-merges CLEANLY (shares lineage b98395bf). NOT three independent designs — stale-branch/squash hygiene.
- yandex-disk-connect carries genuinely-unique unmerged value absent from HEAD: app/api/factory/source-prep/backlog/route.ts + commits gating video gen on prepared product sources / skipping failed prep / hardening source-prep fal queue.

**Что делать:** Keep HEAD's 415-line yandexArchive as canonical. Cherry-pick yandex-disk-connect's source-prep hardening (backlog route + gating commits) before deleting it. Delete data-retention-audit's obsolete archive lineage (review its quality-regen-guard commits first). Both branches are in-mandate, low-risk cleanup.


### ⚪ LOW — Scope/mandate & build hygiene (mostly clean)

- HEAD's 27 commits are fully in-mandate: all 47 files inside the factory zone, zero finance-tab/owner-only paths, only importing already-shipped shared infra. No mandate breach by HEAD.
- The only cross-zone touch runs the OTHER way and is low: marketplace branches (wb-repricer/signals/unit-price-solver) each authored their own inline fork of factory-zone app/api/factory/observer/route.ts, contradicting HEAD's observerPulse-backed version and producing add/add conflicts. Verified these branches trace to the OWNER's own repricer work (exempt from contributor mandate), and the fork is a superseded earlier version, not a behavioral rival.
- New factory code imports 'sharp' which is undeclared in package.json (resolves only as a transitive dep of next@16.2.7). Follows existing prod precedent (canonicalFrame/serverMedia/sourcePrep already import it the same way); owner-only fix. Claude model id 'claude-sonnet-4-6' is hardcoded in ~14 routes instead of importing CLAUDE_MODEL — all values currently match, pure maintainability nit.
- BUILD-HEALTH GREEN: tsc --noEmit exit 0, 125/125 contract tests pass, lint clean. The prior-audit 'broken autofill/artifact-check/fal' memory note is REFUTED at code level — all three are complete, contract-tested implementations. '0 passed OTK / 237 gens/day' is a runtime/config/output-quality observation, not a code defect.

**Что делать:** Owner: add explicit 'sharp' dependency to harden against a next minor bump dropping its transitive sharp. When any marketplace branch is rebased, drop its inline observer fork and keep HEAD's observerPulse version. Optional: import CLAUDE_MODEL where the same value is intended. Re-audit the OTK runtime against live DB/keys, not the test suite. Do NOT block HEAD's merge on any of this.


## Действия по веткам

- **`feat/factory-v2-product-broll (HEAD)`** → `merge-now`
  - Clean 27-commit in-mandate superset of prod; HEAD..gitea/main empty; tsc/tests/lint all green; zero collisions introduced. This is the new prod baseline.
- **`feat/reels-brain-source-economics`** → `rescue-then-merge`
  - Merges into HEAD with exit 0 / zero conflicts today; strands a complete ~27-module reels-brain intelligence layer (+6411). Highest-value clean rescue — land as a dedicated PR before HEAD next edits ReelsBrainConsole.tsx and breaks the clean merge.
- **`feat/reels-brain-m1-m3`** → `rescue-then-merge`
  - Reels-brain core is superseded by HEAD (31 collisions incl. add/add), but ~46 in-mandate files are genuinely stranded (hookJudge/costEstimate/recipeDraft/winnerPreset + fail-open suite). Cherry-pick only the unique non-reels modules; discard reels-brain/graphRun/studio collisions.
- **`codex/factory-m1-m3`** → `rescue-then-merge`
  - Most of its 'v2 foundation' is already byte-identical in HEAD; genuinely-new surface is narrow (reelsBrainPicker.ts, telegram/send-review, gen-save/reconcile + a few tests). graphRun/improvementLoop collide. Cherry-pick the narrow net-new set; do not bulk-merge. Single carrier of this lineage.
- **`codex/factory-yandex-disk-connect`** → `rescue-then-merge`
  - Archive lineage is already in HEAD (auto-merges clean), but carries unique unmerged source-prep hardening (source-prep/backlog route + gate-on-prepared-sources commits). Cherry-pick those, then delete.
- **`deploy/reels-brain-chat-first-dashboard-20260628`** → `rescue-then-merge`
  - Collides on the two LIVE cron files with contradictory cost knobs and an opposite (learning-deleted) design. Diff and cherry-port any wanted cron tuning into HEAD as a small PR; do not blind-merge onto live crons; then retire.
- **`codex/factory-data-retention-audit`** → `investigate`
  - Its yandexArchive lineage is obsolete (pre-squash, 1 export vs HEAD's 5). Review its quality-regen-guard / require-strong-sources commits for unique value; rescue those if wanted, then delete the obsolete archive work.
- **`feat/reels-brain-railway-offline-workers`** → `investigate`
  - Adds a SECOND always-on Railway scheduler overlapping HEAD's vercel reels-brain cron with no shared lease. Paid bulk is gated OFF by default (REELS_BRAIN_ENABLE_BULK=false), so cost-doubling is conditional, but analyze/patterns contention is real. Owner decides one canonical scheduler before shipping.
- **`feat/wb-ad-docking`** → `investigate`
  - Genuinely stranded marketplace work in NEITHER prod nor HEAD (migration 20260627_advert_docking.sql + dock cron + lib/adverts/*). Owner-only migration/vercel content. Escalate ship/abandon to owner; encodes schema intent that is lost if pruned.
- **`feat/wb-ctrtest`** → `investigate`
  - Genuinely stranded marketplace work absent from prod/HEAD (migration 20260628_ctrtest_engine.sql + ctrtest engine + cron). Owner-only. Escalate ship/abandon to owner before pruning.
- **`feat/wb-repricer`** → `investigate`
  - Mostly shipped to prod via PR #18 (lib/auth/roles.ts byte-identical to prod); only genuinely-unmerged content is a 2-line RLS idempotency fix + a stale inline observer fork. Produces add/add conflicts (observer route + owner-only migration/vercel.json). If rebased, drop the inline observer fork and keep HEAD's observerPulse version. Owner-scoped.
- **`codex/factory-worker-runtime-cleanup`** → `abandon`
  - Stale near-rewrite (70 behind HEAD); lacks watchdog-hardening 79a1b344; a take-branch merge silently reverts RENDER/GEN_POLL_FORCE_RELEASE + pollStepOverdue. Deletes ~64 tests, nothing net-new to cherry-pick. Close or fully rebase; do not merge.
- **`codex/factory-runtime-fixes-small`** → `delete-superseded`
  - Strict linear ANCESTOR of codex/factory-m1-m3 (tip == m1-m3's parent); carries nothing m1-m3 lacks. Delete to avoid resolving the same conflicts twice.
- **`feat/factory-quality-pass`** → `delete-superseded`
  - +12/-129 vs HEAD, ZERO stranded files; all 13 conflicts are stale dups; merging resurrects an inferior unguarded migration (carousel btree overflow). Fully superseded — must NOT merge.
- **`feat/wb-signals / feat/unit-price-solver`** → `delete-superseded`
  - Both already shipped to prod (app/api/signals + /api/unit/price-solver present in gitea/main with their crons). 'Stranded' framing was a stale-base artifact. Safe to delete after confirming no unique unmerged commits.
- **`~28 fully-contained branches + reelsBrainCronGate-era branches`** → `delete-superseded`
  - Verified contained in HEAD (HEAD is a clean superset of gitea/main). Stale single-commit PR branches likely already squash-merged. Bulk-delete after a confirmation glance to clear the graveyard.

## Приоритеты (по порядку)

1. MERGE HEAD (feat/factory-v2-product-broll) to gitea/main now — it is a clean, build-green, in-mandate 27-commit superset of prod with zero collisions. Everything else is post-merge cleanup.
2. Fix the OTK env-key starvation (the real '0 passed OTK' cause): add a startup health-check for FAL_KEY + ANTHROPIC_API_KEY, make extractFrames honor FAL_BILLING_KEY, and make 'frames-grounded' a soft signal so artifact-OK videos still bank with a 'frames_unavailable' flag instead of silently routing to 'warning'.
3. DO NOT merge codex/factory-worker-runtime-cleanup (or any graphRun-touching branch) as-is — it silently reverts HEAD's render/gen-poll force-release hardening. Close or fully rebase it. Establish a serialize-one-runtime-branch-at-a-time integration rule.
4. Rescue feat/reels-brain-source-economics as a dedicated PR while it still merges clean (exit 0 today) — a complete ~27-module intelligence layer that will conflict the moment HEAD edits ReelsBrainConsole.tsx.
5. Collapse artifact-check to one source of truth (live lib vs orphaned route with the richer prompt) and single-source the drifted GENERIC_OPENERS blocklist + the two rubric taxonomies — quality gates are silently inconsistent.
6. Prune the branch graveyard: delete the ~28 contained branches + runtime-fixes-small + factory-quality-pass; consolidate codex rescue work on m1-m3 only.
7. Escalate the two genuinely-stranded marketplace branches (wb-ad-docking, wb-ctrtest) — they carry owner-only DB migrations + vercel crons not in prod that are lost if pruned; make an explicit ship/abandon call.
8. Decide Product-Twin's status explicitly: either wire pickProductTwin into autoBindAssets (with prepared-tier priority + register disk='product_twin') or document it as an intentional Month-1 standalone tool so it isn't mistaken for live autopilot integration.
9. Lower-priority hygiene: pick one reels-brain scheduler/ingest path and add a lease/dedupe to reels-brain-cron; delete the dead daily/weekly/scheduler/reelsBrainCronGate control plane; retire-or-document patrick-legacy.html and the Sprint-1 stub routes; owner adds explicit 'sharp' dependency to package.json.
