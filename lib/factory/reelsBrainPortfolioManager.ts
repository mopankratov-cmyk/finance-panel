import { buildExperimentBrainFromPlaybooks, type ReelExperiment } from "./reelsBrainExperiment";
import { buildFeedbackSummary, feedbackSignals } from "./reelsBrainFeedback";
import { buildSimulationBrainFromPlaybooks } from "./reelsBrainSimulation";

export type PortfolioSlotType = "ship_winner" | "ab_test" | "fix_and_retry" | "discovery_refresh" | "hold";

export type PortfolioSlot = {
  id: string;
  niche: string;
  slot_type: PortfolioSlotType;
  priority_score: number;
  recommended_format: string;
  reason: string;
  source_pattern_id?: string | null;
  experiment_id?: string | null;
  metrics_to_watch: string[];
  guardrails: string[];
};

export type PortfolioManagerBrain = {
  generated_at: string;
  summary: {
    outcomes: number;
    winners: number;
    promising: number;
    weak: number;
    launch_experiments: number;
    ship_candidates: number;
  };
  slots: PortfolioSlot[];
  weekly_mix: {
    slot_type: PortfolioSlotType;
    count: number;
    rationale: string;
  }[];
  learning_loop: string[];
  escalation: string[];
};

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function metricsForSlot(slot: PortfolioSlotType) {
  if (slot === "ship_winner") return ["views", "watch_rate", "saves", "orders"];
  if (slot === "ab_test") return ["hook_rate", "watch_rate", "save_rate"];
  if (slot === "fix_and_retry") return ["watch_rate", "completion_rate", "ctr"];
  if (slot === "discovery_refresh") return ["relevant_rate", "inserted", "cost_per_useful"];
  return ["manual_review"];
}

function experimentSlot(exp: ReelExperiment): PortfolioSlot {
  return {
    id: `experiment:${exp.id}`,
    niche: exp.niche,
    slot_type: exp.readiness === "ship" ? "ab_test" : "fix_and_retry",
    priority_score: exp.priority_score,
    recommended_format: `${exp.axis} test -> ${exp.variant.change_to}`,
    reason: exp.hypothesis,
    source_pattern_id: exp.source_pattern_id,
    experiment_id: exp.id,
    metrics_to_watch: exp.success_metrics,
    guardrails: [exp.stop_rule, `risk: ${exp.risk}`],
  };
}

export function buildPortfolioManagerFromPlaybooks(rows: { niche?: string; playbook?: unknown }[], limit = 50): PortfolioManagerBrain {
  const feedback = buildFeedbackSummary(rows);
  const experiments = buildExperimentBrainFromPlaybooks(rows, limit);
  const simulation = buildSimulationBrainFromPlaybooks(rows, limit);
  const outcomeSignals = rows.flatMap((row) => feedbackSignals(row.playbook).map((signal) => ({
    ...signal,
    niche: signal.niche || row.niche || "default",
  })));

  const slots: PortfolioSlot[] = [];

  for (const pattern of feedback.top_patterns.slice(0, 5)) {
    if (pattern.winners <= 0) continue;
    slots.push({
      id: `winner:${pattern.pattern_id}`,
      niche: outcomeSignals.find((signal) => (signal.source_pattern_id || signal.creative_brief_id || "unknown") === pattern.pattern_id)?.niche || "portfolio",
      slot_type: "ship_winner",
      priority_score: clamp(72 + pattern.winners * 8 + pattern.avg_score * 0.15),
      recommended_format: "scale winning mechanic with a new product angle",
      reason: `${pattern.winners} winner outcomes, avg score ${pattern.avg_score}, views ${pattern.views}.`,
      source_pattern_id: pattern.pattern_id,
      experiment_id: null,
      metrics_to_watch: metricsForSlot("ship_winner"),
      guardrails: ["Не копировать исходный ролик, масштабировать только механику.", "Сохранить proof и audience fit."],
    });
  }

  for (const sim of simulation.top_ship_candidates.slice(0, 6)) {
    slots.push({
      id: `ship:${sim.id}`,
      niche: sim.niche,
      slot_type: "ship_winner",
      priority_score: clamp(sim.score),
      recommended_format: "generate from top simulation candidate",
      reason: sim.strongest_reason,
      source_pattern_id: sim.source_pattern_id,
      experiment_id: null,
      metrics_to_watch: metricsForSlot("ship_winner"),
      guardrails: sim.generator_guardrails.slice(0, 4),
    });
  }

  for (const exp of experiments.launch_queue.slice(0, 8)) slots.push(experimentSlot(exp));

  for (const exp of experiments.hold_queue.slice(0, 4)) {
    slots.push({
      ...experimentSlot(exp),
      slot_type: "hold",
      priority_score: Math.min(40, exp.priority_score),
      guardrails: ["Не запускать без правки риска Simulation Brain.", `risk: ${exp.risk}`],
    });
  }

  if (feedback.total_outcomes < 5) {
    slots.push({
      id: "feedback:first-5-outcomes",
      niche: "portfolio",
      slot_type: "discovery_refresh",
      priority_score: 80,
      recommended_format: "collect first outcome signals for published reels",
      reason: "Нужно минимум 5 outcome-сигналов, чтобы Portfolio Manager начал усиливать победителей рыночными данными.",
      source_pattern_id: null,
      experiment_id: null,
      metrics_to_watch: metricsForSlot("discovery_refresh"),
      guardrails: ["Не делать выводы о winning hooks без реальных публикационных метрик."],
    });
  }

  const sortedSlots = slots
    .filter((slot, index, all) => all.findIndex((candidate) => candidate.id === slot.id) === index)
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, 30);

  return {
    generated_at: new Date().toISOString(),
    summary: {
      outcomes: feedback.total_outcomes,
      winners: feedback.winners,
      promising: feedback.promising,
      weak: feedback.weak,
      launch_experiments: experiments.launch_queue.length,
      ship_candidates: simulation.top_ship_candidates.length,
    },
    slots: sortedSlots,
    weekly_mix: [
      { slot_type: "ship_winner", count: 2, rationale: "масштабировать лучшие confirmed/simulated механики" },
      { slot_type: "ab_test", count: 2, rationale: "одна переменная за тест, чтобы понять causal effect" },
      { slot_type: "fix_and_retry", count: 1, rationale: "чинить promising, где Simulation нашёл конкретный риск" },
      { slot_type: "discovery_refresh", count: 1, rationale: "обновлять источники и не застревать в старых паттернах" },
    ],
    learning_loop: [
      "Publish slot -> collect post_metrics -> POST feedback-loop -> update outcomes.",
      "Winner outcomes повышают приоритет Creative DNA и будущих ship slots.",
      "Weak outcomes становятся anti-signal и уходят в revise/hold.",
      "A/B winner возвращается в Creative Memory как доказанная комбинация.",
    ],
    escalation: [
      feedback.total_outcomes < 5 ? "Нужно добрать первые 5 outcome signals." : "",
      feedback.weak > feedback.winners && feedback.total_outcomes >= 5 ? "Слабых outcome больше winners: снизить генерацию и усилить critic/proof." : "",
      !experiments.launch_queue.length ? "Нет launch experiments: пересобрать Creative Memory/Simulation." : "",
    ].filter(Boolean),
  };
}
