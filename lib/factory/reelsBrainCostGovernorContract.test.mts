// Reels Brain cost governor contract.
// Run: npx tsx lib/factory/reelsBrainCostGovernorContract.test.mts
import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const economics = readFileSync("app/api/factory/reels-brain/learning-economics/route.ts", "utf8");
const actions = readFileSync("app/api/factory/reels-brain/autopilot-actions/route.ts", "utf8");
const governor = readFileSync("app/api/factory/reels-brain/cost-governor/route.ts", "utf8");
const report = readFileSync("app/api/factory/reels-brain/report/route.ts", "utf8");
const learningPlan = readFileSync("app/api/factory/reels-brain/learning-plan/route.ts", "utf8");
const cockpit = readFileSync("app/agent/reels-brain/ReelsBrainPixelCockpit.tsx", "utf8");
const feedback = readFileSync("app/api/factory/reels-brain/feedback/route.ts", "utf8");
const cron = readFileSync("app/api/factory/jobs/reels-brain-cron/route.ts", "utf8");
const scheduler = readFileSync("lib/factory/reelsBrainScheduler.ts", "utf8");

ok(/function buildCostGovernor/.test(economics), "learning-economics builds a cost governor");
ok(/REELS_BRAIN_MAX_DAILY_SPEND_USD/.test(economics), "cost governor has daily spend env guard");
ok(/REELS_BRAIN_MAX_USEFUL_VIDEO_USD/.test(economics), "cost governor has useful-video cost env guard");
ok(/low_signal_rate > 20/.test(economics), "cost governor pauses on low-signal corpus");
ok(/cost_governor: costGovernor/.test(economics), "learning-economics returns cost_governor");
ok(/autopilot_actions: autopilotActions/.test(economics), "learning-economics returns autopilot_actions");
ok(/next_intelligence_layers: nextIntelligenceLayers/.test(economics), "learning-economics returns next intelligence layers");
ok(/buildReelsBrainOperatingSystem/.test(economics), "learning-economics builds the operating-system layers");
ok(/feedback_loop/.test(economics) && /product_brain/.test(economics) && /experiment_brain/.test(economics), "learning-economics returns advanced intelligence layers");
ok(/outcome_memory_brain/.test(economics) && /outcome_memory/.test(economics), "learning-economics exposes outcome memory schema before publication loop");
ok(/const chronologicalRuns = \[\.\.\.runs\]\.sort/.test(economics) && /const timeline = chronologicalRuns\.map/.test(economics), "learning-economics normalizes automation history into chronological timeline");
ok(/function buildAudioVisualReadiness/.test(economics) && /audio_visual_readiness: audioVisualReadiness/.test(economics), "learning-economics exposes audio/deep-worker readiness from corpus metadata");
ok(/ready_for_worker/.test(cockpit) && /with_media_locators/.test(cockpit) && /audioVisualSummary/.test(cockpit), "cockpit surfaces audio/deep-worker readiness summary");
ok(/\/api\/factory\/reels-brain\/progress/.test(cockpit) && /Platform Backlogs/.test(cockpit) && /pipelinePlatforms/.test(cockpit), "cockpit surfaces pipeline progress and per-platform backlog health");

ok(/internalFetch/.test(actions), "autopilot-actions reads learning-economics internally");
ok(/\/api\/factory\/reels-brain\/learning-economics/.test(actions), "autopilot-actions points at learning-economics route");
ok(/autopilot_actions/.test(actions) && /cost_governor/.test(actions), "autopilot-actions exposes operator-ready fields");
ok(!/POST\s*\(/.test(actions), "autopilot-actions is read-only");

ok(/internalFetch/.test(governor) && /cost_governor/.test(governor), "cost-governor route exposes budget state");
ok(/daily_costs/.test(governor) && /totals/.test(governor), "cost-governor route includes cost context");
ok(!/POST\s*\(/.test(governor), "cost-governor route is read-only");

ok(/daily_report/.test(report) && /autopilot_actions/.test(report), "report route exposes operator report fields");
ok(/anti_pattern_brain/.test(report) && /discovery_brain/.test(report), "report route includes learning context");
ok(/feedback_loop/.test(report) && /portfolio_manager/.test(report) && /audio_visual_readiness/.test(report) && /outcome_memory_brain/.test(report), "report route exposes operating-system intelligence, audio readiness and outcome memory");
ok(/\/api\/factory\/reels-brain\/progress/.test(report) && /pipeline_progress/.test(report), "report route exposes compact pipeline progress");
ok(!/POST\s*\(/.test(report), "report route is read-only");

ok(/corpusProgress/.test(learningPlan) && /corpusExecutionPlan/.test(learningPlan), "learning-plan computes 10k corpus progress");
ok(/next_tick/.test(learningPlan) && /max_backlog_before_analyze/.test(learningPlan), "learning-plan chooses the next safe training tick");
ok(/can_run_paid_collection/.test(learningPlan) && /cost_governor/.test(learningPlan), "learning-plan respects paid collection guard");
ok(!/POST\s*\(/.test(learningPlan), "learning-plan route is read-only");

ok(/buildReelsBrainFeedbackLoop/.test(feedback), "feedback route summarizes publication metrics");
ok(/\/api\/factory\/post-metrics/.test(feedback), "feedback route writes through post-metrics");
ok(/function loadAutopilotGuard/.test(cron), "cron has an autopilot guard");
ok(/original_task/.test(cron) && /can_run_paid_collection/.test(cron), "cron reports guard enforcement");
ok(/function loadPipelineProgress/.test(cron) && /pipeline_preflight/.test(cron) && /reels-brain-audio-backfill/.test(cron), "cron runs pipeline preflight for media and audio backlog");
ok(/use_autopilot_guard/.test(scheduler), "scheduler marks paid collection as guarded");

ok(/costGovernor/.test(cockpit) && /autopilotActions/.test(cockpit), "cockpit reads cost governor and autopilot actions");
ok(/learningPlan/.test(cockpit) && /Learning Mission/.test(cockpit), "cockpit exposes the standalone learning mission");
ok(/nextLayers/.test(cockpit), "cockpit reads next intelligence layers");
ok(/selectedPattern/.test(cockpit) && /rb-drawer/.test(cockpit), "cockpit exposes pattern creative brief drawer");
ok(/rb-click/.test(cockpit) && /setSelectedPattern/.test(cockpit), "cockpit pattern cards are inspectable");
ok(/sort\(\(a, b\) => String\(a\.created_at \|\| \"\"\)\.localeCompare\(String\(b\.created_at \|\| \"\"\)\)\)\s*\.slice\(-8\)\s*\.reverse\(\)/.test(cockpit), "cockpit stores latest learning runs first");
ok(/vm\.timeline\.slice\(0, 6\)/.test(cockpit), "cockpit renders newest six learning runs instead of stale tail");

console.log("reelsBrainCostGovernorContract: passed");
