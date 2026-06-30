import { buildAudioIntelligenceFromPlaybooks } from "./reelsBrainAudioIntelligence";
import { buildCreativeMemoryFromPlaybooks } from "./reelsBrainCreativeMemory";
import { buildFeedbackSummary } from "./reelsBrainFeedback";
import { buildGeneratorHandoffFromPlaybooks } from "./reelsBrainGeneratorHandoff";
import { buildHumanizationBrainFromPlaybooks } from "./reelsBrainHumanization";
import { buildReelsBrainOperatingPlan } from "./reelsBrainOperatingPlan";
import { buildVisualIntelligenceFromPlaybooks } from "./reelsBrainVisualIntelligence";

export type ReelsBrainClosureStatus = "closed_foundation" | "closed_live" | "closed_needs_worker";

export type ReelsBrainClosureTrack = {
  id: string;
  label: string;
  status: ReelsBrainClosureStatus;
  owner_layer: string;
  deliverables: string[];
  internal_next_tick: string;
  guardrails: string[];
};

export type ReelsBrainClosure = {
  generated_at: string;
  scope: "reels_brain_only";
  total_tracks: number;
  closed_live: number;
  closed_foundation: number;
  closed_needs_worker: number;
  tracks: ReelsBrainClosureTrack[];
  global_guardrails: string[];
};

export function buildReelsBrainClosure(rows: { niche?: string; playbook?: unknown }[], corpusCurrent = 0, corpusTarget = 10000): ReelsBrainClosure {
  const audio = buildAudioIntelligenceFromPlaybooks(rows, 80);
  const visual = buildVisualIntelligenceFromPlaybooks(rows, 80);
  const feedback = buildFeedbackSummary(rows);
  const creative = buildCreativeMemoryFromPlaybooks(rows, 80);
  const human = buildHumanizationBrainFromPlaybooks(rows, 50);
  const packets = buildGeneratorHandoffFromPlaybooks(rows, 20);
  const operating = buildReelsBrainOperatingPlan(rows, corpusCurrent, corpusTarget);

  const tracks: ReelsBrainClosureTrack[] = [
    {
      id: "audio_worker",
      label: "2. Audio Intelligence Worker",
      status: audio.patterns.length ? "closed_needs_worker" : "closed_foundation",
      owner_layer: "audio_intelligence",
      deliverables: [
        `${audio.patterns.length} rule-based audio strategies`,
        "worker spec: FFmpeg -> WhisperX -> Librosa/Essentia -> beat map",
        "outputs: speech speed, pauses, BPM, drops, loudness, first sound event",
      ],
      internal_next_tick: "Запустить offline audio worker только для анализа референсов, без генерации.",
      guardrails: ["Не скачивать/использовать аудио как ассет.", "Хранить только признаки и тайминги."],
    },
    {
      id: "visual_worker",
      label: "3. Visual / Editing Worker",
      status: visual.patterns.length ? "closed_needs_worker" : "closed_foundation",
      owner_layer: "visual_intelligence",
      deliverables: [
        `${visual.patterns.length} visual patterns`,
        "worker spec: frame sampling -> cut detection -> first-frame classifier -> proof-shot detector",
        "outputs: camera, cuts, zoom/pop/freeze, first 3 sec map, proof confidence",
      ],
      internal_next_tick: "Добавить offline frame/cut analyzer для референсов.",
      guardrails: ["Не копировать кадры.", "Сохранять только признаки, не ассеты."],
    },
    {
      id: "internal_packets",
      label: "4. Internal Creative Packets",
      status: packets.total_payloads ? "closed_live" : "closed_foundation",
      owner_layer: "creative_packets",
      deliverables: [`${packets.total_payloads} internal packets`, "brief + humanization + simulation + experiment + safety"],
      internal_next_tick: "Использовать packets только как аналитическую витрину Reels Brain.",
      guardrails: ["Не вызывать produce/scenario/director.", "Не автозапускать производство."],
    },
    {
      id: "outcome_feedback",
      label: "5. Outcome Feedback",
      status: feedback.total_outcomes ? "closed_live" : "closed_foundation",
      owner_layer: "feedback_loop",
      deliverables: [`${feedback.total_outcomes} outcomes`, `${feedback.winners} winners`, "score/verdict policy"],
      internal_next_tick: "При появлении post_metrics обновлять Reels Brain feedback, не генерацию.",
      guardrails: ["Не усиливать паттерн без достаточного outcome evidence."],
    },
    {
      id: "discovery_economics",
      label: "6. Discovery Brain / Cost",
      status: "closed_live",
      owner_layer: "discovery_learning",
      deliverables: ["source memory", "bake-off policy", "small-account breakout preference", "bad-query suppression"],
      internal_next_tick: "Ранжировать источники по cost_per_relevant и breakout_rate.",
      guardrails: ["Не добирать объём дорогими пустыми запросами.", "Scale только источники с релевантностью."],
    },
    {
      id: "product_brain",
      label: "7. Product Brain",
      status: creative.product_brain.length ? "closed_live" : "closed_foundation",
      owner_layer: "creative_memory",
      deliverables: [`${creative.product_brain.length} product brains`, "taxonomy: toys/clothing/cosmetics/gifts/impulse", "fit rules per product type"],
      internal_next_tick: "Разделять выводы по product_type перед сравнением hook/edit/audio.",
      guardrails: ["Не переносить механику между товарами без product fit."],
    },
    {
      id: "anti_pattern",
      label: "8. Anti-pattern Brain",
      status: creative.anti_patterns.length ? "closed_live" : "closed_foundation",
      owner_layer: "creative_memory",
      deliverables: [`${creative.anti_patterns.length} anti-patterns`, "taxonomy: long intro, AI-face, text overload, no proof, weak CTA"],
      internal_next_tick: "Добавлять weak outcomes как anti-signal для похожих паттернов.",
      guardrails: ["Не масштабировать паттерн с high AI-slop/trust risk."],
    },
    {
      id: "insight_showcase",
      label: "9. Insight Showcase",
      status: human.total_recipes ? "closed_live" : "closed_foundation",
      owner_layer: "dashboard",
      deliverables: [`${human.total_recipes} humanized recipes`, "hooks/formats/retention/audio/visual/risk cards"],
      internal_next_tick: "Показывать выводы без логов и настроек.",
      guardrails: ["Витрина объясняет, но не запускает производство."],
    },
    {
      id: "daily_loop",
      label: "10. Daily Auto-learning Loop",
      status: "closed_foundation",
      owner_layer: "scheduler",
      deliverables: ["collect/analyze/memory/packets/report pipeline", `${operating.summary.avg_progress}% avg operating readiness`],
      internal_next_tick: "Сделать read-only daily report: что изменилось в памяти и источниках.",
      guardrails: ["Daily loop не вызывает контент-завод.", "Только сбор, анализ, память и отчёт."],
    },
  ];

  return {
    generated_at: new Date().toISOString(),
    scope: "reels_brain_only",
    total_tracks: tracks.length,
    closed_live: tracks.filter((track) => track.status === "closed_live").length,
    closed_foundation: tracks.filter((track) => track.status === "closed_foundation").length,
    closed_needs_worker: tracks.filter((track) => track.status === "closed_needs_worker").length,
    tracks,
    global_guardrails: [
      "Не добираем видео в этом прогоне.",
      "Не связываем Reels Brain с контент-заводом.",
      "Не вызываем produce, scenario, director или publish.",
      "Все результаты являются внутренними аналитическими слоями Reels Brain.",
    ],
  };
}
