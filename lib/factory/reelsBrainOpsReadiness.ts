import { buildAudioIntelligenceFromPlaybooks } from "./reelsBrainAudioIntelligence";
import { discoverySources } from "./reelsBrainDiscovery";
import { buildFeedbackSummary } from "./reelsBrainFeedback";
import { buildGeneratorHandoffFromPlaybooks } from "./reelsBrainGeneratorHandoff";
import { buildReelsBrainOperatingPlan } from "./reelsBrainOperatingPlan";
import { buildVisualIntelligenceFromPlaybooks } from "./reelsBrainVisualIntelligence";

export type ReelsBrainOpsTrackId =
  | "offline_workers"
  | "outcome_metrics"
  | "cheap_discovery"
  | "daily_report"
  | "dashboard_qa";

export type ReelsBrainOpsReadinessTrack = {
  id: ReelsBrainOpsTrackId;
  label: string;
  status: "closed_live" | "closed_foundation" | "closed_needs_external_runtime";
  readiness_score: number;
  evidence: string[];
  deliverables: string[];
  next_internal_tick: string;
  no_factory_guardrail: string;
};

export type ReelsBrainOpsReadiness = {
  generated_at: string;
  scope: "reels_brain_only";
  summary: {
    tracks: number;
    closed_live: number;
    closed_foundation: number;
    closed_needs_external_runtime: number;
    avg_readiness: number;
  };
  tracks: ReelsBrainOpsReadinessTrack[];
  worker_contracts: {
    audio: {
      runtime: "offline_worker";
      input: string[];
      output: string[];
      queue_policy: string[];
    };
    visual: {
      runtime: "offline_worker";
      input: string[];
      output: string[];
      queue_policy: string[];
    };
  };
  daily_report_template: string[];
  dashboard_qa: {
    must_show_first: string[];
    hide_or_collapse: string[];
    success_criteria: string[];
  };
  global_guardrails: string[];
};

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function sourceStats(rows: { niche?: string; playbook?: unknown }[]) {
  const sources = rows.flatMap((row) => {
    const niche = row.niche || "default";
    return ["tiktok", "instagram", "youtube"].flatMap((platform) =>
      discoverySources(row.playbook, { niche, platform, includePaused: true })
    );
  });
  const scale = sources.filter((source) => source.status === "active" && source.yield_score >= 65 && source.cost_per_relevant <= 2.5);
  const avoid = sources.filter((source) => source.yield_score < 45 || source.cost_per_relevant > 6);
  const smallAccount = sources.filter((source) => source.type === "account" && source.breakout_rate >= 0.1);
  return { sources, scale, avoid, smallAccount };
}

export function buildReelsBrainOpsReadiness(rows: { niche?: string; playbook?: unknown }[], corpusCurrent = 0, corpusTarget = 10000): ReelsBrainOpsReadiness {
  const audio = buildAudioIntelligenceFromPlaybooks(rows, 80);
  const visual = buildVisualIntelligenceFromPlaybooks(rows, 80);
  const feedback = buildFeedbackSummary(rows);
  const packets = buildGeneratorHandoffFromPlaybooks(rows, 20);
  const operating = buildReelsBrainOperatingPlan(rows, corpusCurrent, corpusTarget);
  const source = sourceStats(rows);

  const tracks: ReelsBrainOpsReadinessTrack[] = [
    {
      id: "offline_workers",
      label: "1. Offline Audio/Visual Workers",
      status: "closed_needs_external_runtime",
      readiness_score: audio.patterns.length || visual.patterns.length ? 68 : 42,
      evidence: [`${audio.patterns.length} audio strategies`, `${visual.patterns.length} visual strategies`],
      deliverables: [
        "Audio worker contract: FFmpeg -> WhisperX -> Librosa/Essentia -> feature JSON.",
        "Visual worker contract: frame sampling -> cut detector -> first-frame/proof classifier.",
        "Queue policy: analyze references only, store derived features only.",
      ],
      next_internal_tick: "Создать отдельный offline worker runtime вне Vercel; Reels Brain уже знает input/output contract.",
      no_factory_guardrail: "Worker анализирует только референсы и признаки, не создаёт ролики.",
    },
    {
      id: "outcome_metrics",
      label: "2. Outcome Metrics Loop",
      status: feedback.total_outcomes ? "closed_live" : "closed_foundation",
      readiness_score: feedback.total_outcomes ? 78 : 56,
      evidence: [`${feedback.total_outcomes} outcomes`, `${feedback.winners} winners`, `${feedback.weak} weak signals`],
      deliverables: [
        "Outcome score policy: views + saves + watch/completion + CTR + orders + revenue.",
        "Verdict policy: winner / promising / neutral / weak.",
        "Feedback summary ready for Pattern Brain weighting.",
      ],
      next_internal_tick: "Когда появляются post_metrics, писать их в Reels Brain feedback-loop и пересчитать memory.",
      no_factory_guardrail: "Outcome loop только обучает мозг, не запускает генерацию.",
    },
    {
      id: "cheap_discovery",
      label: "3. Cheap Discovery Policy",
      status: source.sources.length ? "closed_live" : "closed_foundation",
      readiness_score: source.sources.length ? 76 : 58,
      evidence: [`${source.sources.length} known sources`, `${source.scale.length} scale sources`, `${source.avoid.length} avoid sources`],
      deliverables: [
        "Scale list: sources with high yield and low cost_per_relevant.",
        "Avoid list: expensive/empty sources are suppressed.",
        "Small-account breakout preference is tracked separately.",
      ],
      next_internal_tick: "Before paid collection, run discovery action-plan and only then spend provider calls.",
      no_factory_guardrail: "Discovery только пополняет/оценивает референсы, не производит контент.",
    },
    {
      id: "daily_report",
      label: "4. Daily Reels Brain Report",
      status: "closed_foundation",
      readiness_score: 64,
      evidence: [`${operating.summary.avg_progress}% operating readiness`, `${packets.total_payloads} internal packets`],
      deliverables: [
        "Report template: corpus, analyzed memory, source economics, packets, risks, next internal tick.",
        "Read-only report can be generated without new collection.",
        "Daily loop boundaries explicitly exclude factory calls.",
      ],
      next_internal_tick: "Generate one daily report after scheduler/analyze/memory refresh.",
      no_factory_guardrail: "Daily report только сообщает состояние Reels Brain.",
    },
    {
      id: "dashboard_qa",
      label: "5. Dashboard QA / UX",
      status: "closed_foundation",
      readiness_score: 66,
      evidence: ["insight showcase exists", "10-track operating plan exists", "2-10 closure block exists"],
      deliverables: [
        "First screen should answer: corpus, memory, winners, risks, next action.",
        "Internal logs/settings stay collapsed below insight cards.",
        "QA checklist ready for visual pass.",
      ],
      next_internal_tick: "Run browser QA pass and collapse low-signal blocks if the page feels noisy.",
      no_factory_guardrail: "UX only changes Reels Brain dashboard.",
    },
  ];

  const summary = {
    tracks: tracks.length,
    closed_live: tracks.filter((track) => track.status === "closed_live").length,
    closed_foundation: tracks.filter((track) => track.status === "closed_foundation").length,
    closed_needs_external_runtime: tracks.filter((track) => track.status === "closed_needs_external_runtime").length,
    avg_readiness: clamp(tracks.reduce((sum, track) => sum + track.readiness_score, 0) / Math.max(1, tracks.length)),
  };

  return {
    generated_at: new Date().toISOString(),
    scope: "reels_brain_only",
    summary,
    tracks,
    worker_contracts: {
      audio: {
        runtime: "offline_worker",
        input: ["reference_video_url", "video_id", "niche", "platform", "source_pattern_id"],
        output: ["speech_transcript", "word_timings", "speech_speed", "pauses", "bpm", "beats", "drops", "energy", "first_sound_event"],
        queue_policy: ["process only stored references", "store derived features", "never reuse source audio as asset"],
      },
      visual: {
        runtime: "offline_worker",
        input: ["reference_video_url", "video_id", "niche", "platform", "source_pattern_id"],
        output: ["first_frame_type", "cut_map", "camera_style", "editing_moves", "proof_shots", "text_density", "ai_slop_risk"],
        queue_policy: ["sample frames for analysis only", "store labels/timings", "never store copied frames as creative assets"],
      },
    },
    daily_report_template: [
      `Corpus: ${corpusCurrent}/${corpusTarget}; no corpus growth required for this pass.`,
      `Memory: ${packets.total_payloads} internal packets; operating readiness ${operating.summary.avg_progress}%.`,
      `Outcomes: ${feedback.total_outcomes}; winners ${feedback.winners}; weak ${feedback.weak}.`,
      `Discovery: ${source.scale.length} scale sources; ${source.avoid.length} avoid sources; ${source.smallAccount.length} small-account breakout sources.`,
      "Next: run only Reels Brain internal ticks unless user explicitly asks for production work.",
    ],
    dashboard_qa: {
      must_show_first: ["corpus/analyzed progress", "winning hooks", "risks/anti-patterns", "internal packets", "next internal action"],
      hide_or_collapse: ["raw provider logs", "manual seed forms", "legacy runner controls", "long JSON-like payloads"],
      success_criteria: ["user understands status in 30 seconds", "no factory launch wording", "all expensive actions are explicit"],
    },
    global_guardrails: unique([
      "No corpus growth in this pass.",
      "No content-factory integration.",
      "No calls to produce/scenario/director/publish.",
      "Reels Brain stores insight, features, policies and reports only.",
    ]),
  };
}
