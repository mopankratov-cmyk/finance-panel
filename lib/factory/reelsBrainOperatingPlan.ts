import { buildAudioIntelligenceFromPlaybooks } from "./reelsBrainAudioIntelligence";
import { buildCreativeMemoryFromPlaybooks } from "./reelsBrainCreativeMemory";
import { buildGeneratorHandoffFromPlaybooks } from "./reelsBrainGeneratorHandoff";
import { buildHumanizationBrainFromPlaybooks } from "./reelsBrainHumanization";
import { buildPortfolioManagerFromPlaybooks } from "./reelsBrainPortfolioManager";
import { buildVisualIntelligenceFromPlaybooks } from "./reelsBrainVisualIntelligence";
import { reelsPatternBrain } from "./reelsBrainCreativeBriefs";

export type ReelsBrainCapabilityStatus = "live" | "foundation" | "needs_worker" | "needs_data";

export type ReelsBrainCapability = {
  id: string;
  label: string;
  status: ReelsBrainCapabilityStatus;
  progress: number;
  evidence: string[];
  next_task: string;
};

export type ReelsBrainOperatingPlan = {
  generated_at: string;
  mode: "reels_brain_only";
  summary: {
    capabilities: number;
    live: number;
    foundation: number;
    needs_worker: number;
    needs_data: number;
    avg_progress: number;
  };
  capabilities: ReelsBrainCapability[];
  pipeline: string[];
  guardrails: string[];
};

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function status(progress: number, worker = false, data = false): ReelsBrainCapabilityStatus {
  if (data && progress < 45) return "needs_data";
  if (worker && progress < 70) return "needs_worker";
  if (progress >= 70) return "live";
  return "foundation";
}

function patternStats(rows: { niche?: string; playbook?: unknown }[]) {
  let patterns = 0;
  let generatorReady = 0;
  let antiSignals = 0;
  let examples = 0;
  for (const row of rows) {
    const brain = reelsPatternBrain(row.playbook);
    const all = brain?.meta_brain?.patterns || [];
    const ready = brain?.meta_brain?.generator_ready_patterns || [];
    patterns += all.length;
    generatorReady += ready.length;
    antiSignals += all.filter((pattern) => pattern.quality_label === "noise" || pattern.quality_label === "needs_cleanup").length;
    examples += [...ready, ...all].reduce((sum, pattern) => sum + (pattern.examples?.length || 0), 0);
  }
  return { patterns, generatorReady, antiSignals, examples };
}

export function buildReelsBrainOperatingPlan(rows: { niche?: string; playbook?: unknown }[], corpusCurrent = 0, corpusTarget = 10000): ReelsBrainOperatingPlan {
  const pattern = patternStats(rows);
  const creative = buildCreativeMemoryFromPlaybooks(rows, 80);
  const audio = buildAudioIntelligenceFromPlaybooks(rows, 80);
  const visual = buildVisualIntelligenceFromPlaybooks(rows, 80);
  const human = buildHumanizationBrainFromPlaybooks(rows, 50);
  const portfolio = buildPortfolioManagerFromPlaybooks(rows, 50);
  const packets = buildGeneratorHandoffFromPlaybooks(rows, 20);
  const corpusProgress = corpusTarget ? clamp((corpusCurrent / corpusTarget) * 100) : 0;

  const capabilities: ReelsBrainCapability[] = [
    {
      id: "data_corpus",
      label: "Data Corpus 10k",
      status: status(corpusProgress, false, true),
      progress: corpusProgress,
      evidence: [`corpus ${corpusCurrent}/${corpusTarget}`, `${pattern.examples} reference examples in memory`],
      next_task: corpusCurrent < corpusTarget ? "Продолжать дешёвый discovery и добор русскоязычного корпуса." : "Перейти к регулярному daily refresh вместо bulk-добора.",
    },
    {
      id: "audio_worker",
      label: "Audio Intelligence",
      status: status(audio.patterns.length ? 58 : 20, true),
      progress: audio.patterns.length ? 58 : 20,
      evidence: [`${audio.patterns.length} rule-based audio patterns`, `${audio.top_sound_titles.length} sound titles`],
      next_task: "Добавить worker-spec: FFmpeg/Whisper/beat-map как отдельный offline контур Reels Brain.",
    },
    {
      id: "visual_worker",
      label: "Visual / Editing Intelligence",
      status: status(visual.patterns.length ? 58 : 20, true),
      progress: visual.patterns.length ? 58 : 20,
      evidence: [`${visual.patterns.length} visual patterns`, `${visual.editor_payloads.length} editor payloads`],
      next_task: "Добавить frame/cut detector worker-spec без подключения к производству.",
    },
    {
      id: "internal_packets",
      label: "Internal Creative Packets",
      status: status(packets.total_payloads ? 78 : 35),
      progress: packets.total_payloads ? 78 : 35,
      evidence: [`${packets.total_payloads} internal packets`, `${packets.ready} ready analytical packets`],
      next_task: "Держать packets как внутреннюю витрину Reels Brain, без автозапуска завода.",
    },
    {
      id: "outcome_feedback",
      label: "Outcome Feedback",
      status: status(portfolio.summary.outcomes ? 72 : 42, false, !portfolio.summary.outcomes),
      progress: portfolio.summary.outcomes ? 72 : 42,
      evidence: [`${portfolio.summary.outcomes} outcomes`, `${portfolio.summary.winners} winners`],
      next_task: "Подгружать реальные post_metrics в feedback-loop после публикаций, без изменения генерации.",
    },
    {
      id: "discovery_economics",
      label: "Discovery Brain / Cost",
      status: "live",
      progress: 74,
      evidence: ["source memory + bake-off есть", "learning economics есть"],
      next_task: "Усилить маленькие аккаунты с залётами и stop-list дорогих/пустых запросов.",
    },
    {
      id: "product_brain",
      label: "Product Brain",
      status: status(creative.product_brain.length ? 68 : 35),
      progress: creative.product_brain.length ? 68 : 35,
      evidence: [`${creative.product_brain.length} product brains`, `${creative.audience_brain.length} audience brains`],
      next_task: "Развести правила по типам товаров: toys/clothing/cosmetics/gifts/impulse.",
    },
    {
      id: "anti_pattern",
      label: "Anti Pattern Brain",
      status: status(creative.anti_patterns.length ? 70 : 38),
      progress: creative.anti_patterns.length ? 70 : 38,
      evidence: [`${creative.anti_patterns.length} anti-patterns`, `${pattern.antiSignals} weak/noise signals`],
      next_task: "Отдельно считать причины слабых роликов: intro, AI-face, text overload, no proof, weak CTA.",
    },
    {
      id: "insight_showcase",
      label: "Insight Showcase",
      status: status(pattern.generatorReady ? 76 : 44),
      progress: pattern.generatorReady ? 76 : 44,
      evidence: [`${pattern.generatorReady} generator-ready patterns`, `${human.total_recipes} humanized recipes`],
      next_task: "Продолжать упрощать витрину: winners, hooks, mechanics, OP-combos, risks.",
    },
    {
      id: "auto_loop",
      label: "Daily Auto-Learning Loop",
      status: "foundation",
      progress: 62,
      evidence: ["scheduler routes есть", "bulk/analyze/weekly jobs есть"],
      next_task: "Собрать один read-only монитор daily loop: collect -> analyze -> memory -> packets -> report.",
    },
  ];

  const summary = {
    capabilities: capabilities.length,
    live: capabilities.filter((item) => item.status === "live").length,
    foundation: capabilities.filter((item) => item.status === "foundation").length,
    needs_worker: capabilities.filter((item) => item.status === "needs_worker").length,
    needs_data: capabilities.filter((item) => item.status === "needs_data").length,
    avg_progress: clamp(capabilities.reduce((sum, item) => sum + item.progress, 0) / Math.max(1, capabilities.length)),
  };

  return {
    generated_at: new Date().toISOString(),
    mode: "reels_brain_only",
    summary,
    capabilities,
    pipeline: [
      "1. Collect RU references and source economics.",
      "2. Analyze backlog into Pattern Brain.",
      "3. Build Creative Memory, Audio, Visual, Simulation, Humanization.",
      "4. Build internal creative packets for Reels Brain review.",
      "5. Wait for real outcome feedback, then update memory.",
    ],
    guardrails: [
      "Не вызывать контент-завод, produce, scenario или director из этого слоя.",
      "Creative packets являются аналитическим артефактом, не производственным запуском.",
      "Референсы используются только как механика: не копировать видео, музыку, лица, текст или бренд.",
    ],
  };
}
