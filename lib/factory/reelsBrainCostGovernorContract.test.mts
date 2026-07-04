// Reels Brain cost governor contract.
// Run: npx tsx lib/factory/reelsBrainCostGovernorContract.test.mts
import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const economics = readFileSync("app/api/factory/reels-brain/learning-economics/route.ts", "utf8");
const actions = readFileSync("app/api/factory/reels-brain/autopilot-actions/route.ts", "utf8");
const governor = readFileSync("app/api/factory/reels-brain/cost-governor/route.ts", "utf8");
const report = readFileSync("app/api/factory/reels-brain/report/route.ts", "utf8");
const learningPlan = readFileSync("app/api/factory/reels-brain/learning-plan/route.ts", "utf8");
const creativeExports = readFileSync("app/api/factory/reels-brain/creative-exports/route.ts", "utf8");
const readinessAudit = readFileSync("app/api/factory/reels-brain/readiness-audit/route.ts", "utf8");
const decisionSnapshot = readFileSync("app/api/factory/reels-brain/decision-snapshot/route.ts", "utf8");
const decisionSnapshotBuilder = readFileSync("lib/factory/reelsBrainDecisionSnapshot.ts", "utf8");
const segmentSolutions = readFileSync("app/api/factory/reels-brain/segment-solutions/route.ts", "utf8");
const segmentSolutionsBuilder = readFileSync("lib/factory/reelsBrainSegmentSolutions.ts", "utf8");
const segmentStabilityAudit = readFileSync("app/api/factory/reels-brain/stability-audit/route.ts", "utf8");
const segmentStabilityAuditBuilder = readFileSync("lib/factory/reelsBrainSegmentStabilityAudit.ts", "utf8");
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
ok(/\/api\/factory\/reels-brain\/health/.test(cockpit) && /Live Ops/.test(cockpit) && /incidentTimeline/.test(cockpit), "cockpit surfaces health state and incident timeline");

ok(/internalFetch/.test(actions), "autopilot-actions reads learning-economics internally");
ok(/\/api\/factory\/reels-brain\/learning-economics/.test(actions), "autopilot-actions points at learning-economics route");
ok(/autopilot_actions/.test(actions) && /cost_governor/.test(actions), "autopilot-actions exposes operator-ready fields");
ok(!/POST\s*\(/.test(actions), "autopilot-actions is read-only");

ok(/internalFetch/.test(governor) && /cost_governor/.test(governor), "cost-governor route exposes budget state");
ok(/daily_costs/.test(governor) && /totals/.test(governor), "cost-governor route includes cost context");
ok(!/POST\s*\(/.test(governor), "cost-governor route is read-only");

ok(/internalFetch/.test(creativeExports) && /segment_creative_exports/.test(creativeExports), "creative-exports route reads creative export bundles from learning-economics");
ok(/lane/.test(creativeExports) && /niche/.test(creativeExports) && /platform/.test(creativeExports), "creative-exports route supports lane, niche and platform filters");
ok(!/POST\s*\(/.test(creativeExports), "creative-exports route is read-only");

ok(/internalFetch/.test(readinessAudit) && /segment_readiness_audit/.test(readinessAudit), "readiness-audit route reads readiness audit from learning-economics");
ok(/verdict/.test(readinessAudit) && /niche/.test(readinessAudit) && /platform/.test(readinessAudit), "readiness-audit route supports verdict, niche and platform filters");
ok(!/POST\s*\(/.test(readinessAudit), "readiness-audit route is read-only");

ok(/creative-exports/.test(decisionSnapshot) && /readiness-audit/.test(decisionSnapshot), "decision-snapshot route combines creative exports and readiness audit");
ok(/lane/.test(decisionSnapshot) && /niche/.test(decisionSnapshot) && /platform/.test(decisionSnapshot), "decision-snapshot route supports lane, niche and platform filters");
ok(/buildReelsBrainDecisionSnapshot/.test(decisionSnapshot) && /filtered_total/.test(decisionSnapshotBuilder), "decision-snapshot route delegates merge logic to a reusable builder");
ok(!/POST\s*\(/.test(decisionSnapshot), "decision-snapshot route is read-only");
ok(/decision-snapshot/.test(segmentSolutions) && /buildReelsBrainSegmentSolutions/.test(segmentSolutions), "segment-solutions route derives operator outputs from the decision snapshot");
ok(/buildReelsBrainSegmentStabilityAudit/.test(segmentSolutionsBuilder) && /creative_brief/.test(segmentSolutionsBuilder) && /content_decision/.test(segmentSolutionsBuilder) && /trust_summary/.test(segmentSolutionsBuilder), "segment-solutions builder produces brief, content decision and trust layers on top of a stability audit");
ok(!/POST\s*\(/.test(segmentSolutions), "segment-solutions route is read-only");
ok(/decision-snapshot/.test(segmentStabilityAudit) && /buildReelsBrainSegmentStabilityAudit/.test(segmentStabilityAudit), "stability-audit route derives trust evidence from the decision snapshot");
ok(/evidence_band/.test(segmentStabilityAuditBuilder) && /high_trust_segment/.test(segmentStabilityAuditBuilder) && /blockers/.test(segmentStabilityAuditBuilder), "stability-audit builder proves whether a segment is actually high-trust");
ok(!/POST\s*\(/.test(segmentStabilityAudit), "stability-audit route is read-only");

ok(/daily_report/.test(report) && /autopilot_actions/.test(report), "report route exposes operator report fields");
ok(/anti_pattern_brain/.test(report) && /discovery_brain/.test(report), "report route includes learning context");
ok(/top_opportunities/.test(report) && /pattern_atlas/.test(report) && /segment_playbook/.test(report) && /evidence_ledger/.test(report), "report route exposes segment decision layers");
ok(/segment_output_banks/.test(report), "report route exposes segment-specific output banks");
ok(/segment_decision_deck/.test(report), "report route exposes segment decision deck");
ok(/segment_priority_queue/.test(report), "report route exposes segment priority queue");
ok(/segment_generation_packs/.test(report), "report route exposes segment generation packs");
ok(/segment_creative_exports/.test(report), "report route exposes segment creative exports");
ok(/segment_readiness_audit/.test(report), "report route exposes segment readiness audit");
ok(/segment_stability_audit/.test(report) && /segment_solutions/.test(report), "report route exposes segment stability audit and operator-ready solutions");
ok(/portfolio_readiness/.test(report), "report route exposes portfolio readiness coverage");
ok(/feedback_loop/.test(report) && /portfolio_manager/.test(report) && /audio_visual_readiness/.test(report) && /outcome_memory_brain/.test(report), "report route exposes operating-system intelligence, audio readiness and outcome memory");
ok(/\/api\/factory\/reels-brain\/progress/.test(report) && /pipeline_progress/.test(report), "report route exposes compact pipeline progress");
ok(!/POST\s*\(/.test(report), "report route is read-only");

ok(/corpusProgress/.test(learningPlan) && /corpusExecutionPlan/.test(learningPlan), "learning-plan computes 10k corpus progress");
ok(/next_tick/.test(learningPlan) && /max_backlog_before_analyze/.test(learningPlan), "learning-plan chooses the next safe training tick");
ok(/buildReelsBrainSegmentGapPlanner/.test(learningPlan) && /segment_plan/.test(learningPlan), "learning-plan exposes segment-level gap planner toward stable trust");
ok(/buildReelsBrainSegmentPriorityQueue/.test(learningPlan) && /segment_priority_queue/.test(learningPlan), "learning-plan exposes segment priority queue on top of gap plan");
ok(/can_run_paid_collection/.test(learningPlan) && /cost_governor/.test(learningPlan), "learning-plan respects paid collection guard");
ok(!/POST\s*\(/.test(learningPlan), "learning-plan route is read-only");

ok(/buildReelsBrainFeedbackLoop/.test(feedback), "feedback route summarizes publication metrics");
ok(/\/api\/factory\/post-metrics/.test(feedback), "feedback route writes through post-metrics");
ok(/function loadAutopilotGuard/.test(cron), "cron has an autopilot guard");
ok(/original_task/.test(cron) && /can_run_paid_collection/.test(cron), "cron reports guard enforcement");
ok(/function loadPipelineProgress/.test(cron) && /pipeline_preflight/.test(cron) && /reels-brain-audio-backfill/.test(cron), "cron runs pipeline preflight for media and audio backlog");
ok(/media_ticks/.test(cron) && /audio_ticks/.test(cron) && /platform\",\s*String\(target\.platform/.test(cron), "cron preflight fans out media and audio backlog across top platforms");
ok(/use_autopilot_guard/.test(scheduler), "scheduler marks paid collection as guarded");

ok(/costGovernor/.test(cockpit) && /autopilotActions/.test(cockpit), "cockpit reads cost governor and autopilot actions");
ok(/learningPlan/.test(cockpit) && /Learning Mission/.test(cockpit), "cockpit exposes the standalone learning mission");
ok(/segment_plan/.test(cockpit) && /segment-gap:/.test(cockpit), "cockpit surfaces segment-level training gaps inside learning mission");
ok(/segment-priority:/.test(cockpit) && /missionPriorityCards/.test(cockpit), "cockpit surfaces priority segment lane inside learning mission");
ok(/nextLayers/.test(cockpit), "cockpit reads next intelligence layers");
ok(/Top Opportunities/.test(cockpit) && /Pattern Atlas/.test(cockpit) && /Segment Playbook/.test(cockpit) && /Evidence Ledger/.test(cockpit), "cockpit surfaces segment opportunity, atlas, playbook and evidence layers");
ok(/segment_output_banks/.test(economics) && /Segment Output Banks/.test(cockpit) && /segment-output:/.test(cockpit), "learning-economics and cockpit expose segment-specific brief/action/hypothesis outputs");
ok(/buildReelsBrainSegmentDecisionDeck/.test(economics) && /segment_decision_deck/.test(economics) && /Segment Decision Deck/.test(cockpit) && /segment-decision:/.test(cockpit), "learning-economics and cockpit expose a trust-ranked segment decision deck");
ok(/buildReelsBrainSegmentPriorityQueue/.test(economics) && /segment_priority_queue/.test(economics), "learning-economics exposes a segment priority queue for autopilot");
ok(/buildReelsBrainSegmentGenerationPacks/.test(economics) && /segment_generation_packs/.test(economics) && /Segment Generation Packs/.test(cockpit) && /segment-generation:/.test(cockpit), "learning-economics and cockpit expose quality-gated generation packs for strong segments");
ok(/buildReelsBrainSegmentCreativeExports/.test(economics) && /segment_creative_exports/.test(economics) && /Segment Creative Exports/.test(cockpit) && /segment-export:/.test(cockpit), "learning-economics and cockpit expose operator-ready creative export bundles");
ok(/buildReelsBrainSegmentReadinessAudit/.test(economics) && /segment_readiness_audit/.test(economics) && /Segment Readiness Audit/.test(cockpit) && /segment-audit:/.test(cockpit), "learning-economics and cockpit expose a transparent readiness audit for segment verdicts");
ok(/buildReelsBrainSegmentStabilityAudit/.test(economics) && /segment_stability_audit/.test(economics), "learning-economics exposes segment stability audit for high-trust verification");
ok(/buildReelsBrainSegmentSolutions/.test(economics) && /segment_solutions/.test(economics), "learning-economics exposes operator-ready segment solutions");
ok(/buildReelsBrainPortfolioReadiness/.test(economics) && /portfolio_readiness/.test(economics), "learning-economics exposes portfolio readiness for 10k coverage tracking");
ok(/segmentStabilityAudit/.test(learningPlan) && /segment_stability/.test(learningPlan), "learning-plan uses segment stability audit in the main loop");
ok(/portfolio_readiness/.test(learningPlan), "learning-plan exposes portfolio readiness in the mission loop");
ok(/\/api\/factory\/reels-brain\/readiness-audit\?verdict=/.test(cockpit), "cockpit exposes standalone readiness-audit endpoint per segment");
ok(/\/api\/factory\/reels-brain\/decision-snapshot\?lane=/.test(cockpit), "cockpit exposes unified decision-snapshot endpoint per segment");
ok(/\/api\/factory\/reels-brain\/segment-solutions\?lane=/.test(cockpit), "cockpit exposes operator-ready segment-solutions endpoint per segment");
ok(/\/api\/factory\/reels-brain\/stability-audit\?lane=/.test(cockpit), "cockpit exposes segment stability-audit endpoint per segment");
ok(/Portfolio readiness/.test(cockpit) && /high-trust coverage/.test(cockpit), "cockpit surfaces portfolio readiness toward full niche/platform coverage");
ok(/selectedPattern/.test(cockpit) && /rb-drawer/.test(cockpit), "cockpit exposes pattern creative brief drawer");
ok(/rb-click/.test(cockpit) && /setSelectedPattern/.test(cockpit), "cockpit pattern cards are inspectable");
ok(/sort\(\(a, b\) => String\(a\.created_at \|\| \"\"\)\.localeCompare\(String\(b\.created_at \|\| \"\"\)\)\)\s*\.slice\(-8\)\s*\.reverse\(\)/.test(cockpit), "cockpit stores latest learning runs first");
ok(/vm\.runTimeline\.slice\(0, 6\)/.test(cockpit), "cockpit renders newest six live run events instead of stale tail");

console.log("reelsBrainCostGovernorContract: passed");
