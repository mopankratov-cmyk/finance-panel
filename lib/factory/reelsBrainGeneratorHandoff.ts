import { buildCreativeBriefsFromPlaybooks, type ReelsCreativeBrief } from "./reelsBrainCreativeBriefs";
import { buildExperimentBrainFromPlaybooks, type ReelExperiment } from "./reelsBrainExperiment";
import { buildHumanizationBrainFromPlaybooks, type HumanizedRecipe } from "./reelsBrainHumanization";
import { buildPortfolioManagerFromPlaybooks, type PortfolioSlot } from "./reelsBrainPortfolioManager";
import { buildSimulationBrainFromPlaybooks, type ReelSimulation } from "./reelsBrainSimulation";

export type GeneratorHandoffPayload = {
  id: string;
  niche: string;
  readiness: "ready_to_generate" | "needs_revision" | "hold";
  priority_score: number;
  source_pattern_id: string;
  brief: Pick<ReelsCreativeBrief, "title" | "hook" | "retention_mechanic" | "structure" | "second_by_second" | "visual_recipe" | "product_fit" | "copy_as_mechanic" | "do_not_copy">;
  humanization: {
    ai_slop_risk: HumanizedRecipe["ai_slop_risk"];
    moves: string[];
    prompt_patch: string;
    keep_human: string[];
    avoid_ai_slop: string[];
  } | null;
  experiment: {
    axis: string;
    hypothesis: string;
    variant: string;
    success_metrics: string[];
    stop_rule: string;
  } | null;
  portfolio_slot: {
    slot_type: string;
    recommended_format: string;
    metrics_to_watch: string[];
    guardrails: string[];
  } | null;
  simulation: {
    readiness: ReelSimulation["readiness"];
    strongest_reason: string;
    biggest_risk: string;
    recommended_iteration: string;
  } | null;
  generator_payload: {
    source: "reels_brain_generator_handoff";
    niche: string;
    hook: string;
    retention: string;
    structure: string;
    second_by_second: string[];
    visual_recipe: string[];
    product_fit: string[];
    humanization_patch?: string;
    experiment_axis?: string;
    experiment_variant?: string;
    metrics_to_watch: string[];
    copy_as_mechanic: string[];
    do_not_copy: string[];
    safety_guardrails: string[];
  };
};

export type GeneratorHandoffBrain = {
  generated_at: string;
  total_payloads: number;
  ready: number;
  needs_revision: number;
  hold: number;
  payloads: GeneratorHandoffPayload[];
  handoff_rules: string[];
};

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function byPatternId<T extends { source_pattern_id: string }>(items: T[]) {
  const map = new Map<string, T>();
  for (const item of items) if (!map.has(item.source_pattern_id)) map.set(item.source_pattern_id, item);
  return map;
}

function slotByPattern(slots: PortfolioSlot[]) {
  const map = new Map<string, PortfolioSlot>();
  for (const slot of slots) {
    if (slot.source_pattern_id && !map.has(slot.source_pattern_id)) map.set(slot.source_pattern_id, slot);
  }
  return map;
}

function experimentByPattern(experiments: ReelExperiment[]) {
  const map = new Map<string, ReelExperiment>();
  for (const exp of experiments) {
    if (!map.has(exp.source_pattern_id)) map.set(exp.source_pattern_id, exp);
  }
  return map;
}

function readiness(sim?: ReelSimulation, human?: HumanizedRecipe): GeneratorHandoffPayload["readiness"] {
  if (sim?.readiness === "hold" || human?.ai_slop_risk === "high") return "hold";
  if (sim?.readiness === "revise" || human?.ai_slop_risk === "medium") return "needs_revision";
  return "ready_to_generate";
}

function safetyGuardrails(brief: ReelsCreativeBrief, human?: HumanizedRecipe, sim?: ReelSimulation, slot?: PortfolioSlot) {
  return Array.from(new Set([
    ...brief.do_not_copy,
    ...(human?.avoid_ai_slop || []),
    ...(sim?.generator_guardrails || []),
    ...(slot?.guardrails || []),
    "Не использовать исходный референс как ассет: только механику.",
    "Если claim нельзя доказать нашим товаром, заменить claim на наблюдение/тест.",
  ])).slice(0, 12);
}

function score(brief: ReelsCreativeBrief, human?: HumanizedRecipe, sim?: ReelSimulation, slot?: PortfolioSlot, exp?: ReelExperiment) {
  return clamp(
    brief.op_score * 0.38
    + (human?.score || brief.op_score) * 0.18
    + (sim?.score || brief.op_score) * 0.2
    + (slot?.priority_score || brief.op_score) * 0.14
    + (exp?.priority_score || brief.op_score) * 0.1
    - (human?.ai_slop_risk === "high" ? 18 : human?.ai_slop_risk === "medium" ? 6 : 0)
  );
}

export function buildGeneratorHandoffFromPlaybooks(rows: { niche?: string; playbook?: unknown }[], limit = 20): GeneratorHandoffBrain {
  const briefs = buildCreativeBriefsFromPlaybooks(rows, Math.max(10, limit * 2));
  const humanization = buildHumanizationBrainFromPlaybooks(rows, Math.max(20, limit * 2));
  const simulation = buildSimulationBrainFromPlaybooks(rows, Math.max(20, limit * 2));
  const experiments = buildExperimentBrainFromPlaybooks(rows, Math.max(20, limit * 2));
  const portfolio = buildPortfolioManagerFromPlaybooks(rows, Math.max(20, limit * 2));

  const humanByPattern = byPatternId(humanization.recipes);
  const simByPattern = byPatternId(simulation.simulations);
  const expByPattern = experimentByPattern(experiments.launch_queue);
  const portfolioByPattern = slotByPattern(portfolio.slots);

  const payloads = briefs.map((brief) => {
    const human = humanByPattern.get(brief.source_pattern_id);
    const sim = simByPattern.get(brief.source_pattern_id);
    const exp = expByPattern.get(brief.source_pattern_id);
    const slot = portfolioByPattern.get(brief.source_pattern_id);
    const status = readiness(sim, human);
    const priority = score(brief, human, sim, slot, exp);
    const guardrails = safetyGuardrails(brief, human, sim, slot);
    return {
      id: `${brief.id}:handoff`,
      niche: brief.niche,
      readiness: status,
      priority_score: priority,
      source_pattern_id: brief.source_pattern_id,
      brief: {
        title: brief.title,
        hook: brief.hook,
        retention_mechanic: brief.retention_mechanic,
        structure: brief.structure,
        second_by_second: brief.second_by_second,
        visual_recipe: brief.visual_recipe,
        product_fit: brief.product_fit,
        copy_as_mechanic: brief.copy_as_mechanic,
        do_not_copy: brief.do_not_copy,
      },
      humanization: human ? {
        ai_slop_risk: human.ai_slop_risk,
        moves: human.moves,
        prompt_patch: human.generator_prompt_patch,
        keep_human: human.keep_human,
        avoid_ai_slop: human.avoid_ai_slop,
      } : null,
      experiment: exp ? {
        axis: exp.axis,
        hypothesis: exp.hypothesis,
        variant: exp.variant.change_to,
        success_metrics: exp.success_metrics,
        stop_rule: exp.stop_rule,
      } : null,
      portfolio_slot: slot ? {
        slot_type: slot.slot_type,
        recommended_format: slot.recommended_format,
        metrics_to_watch: slot.metrics_to_watch,
        guardrails: slot.guardrails,
      } : null,
      simulation: sim ? {
        readiness: sim.readiness,
        strongest_reason: sim.strongest_reason,
        biggest_risk: sim.biggest_risk,
        recommended_iteration: sim.recommended_iteration,
      } : null,
      generator_payload: {
        source: "reels_brain_generator_handoff",
        niche: brief.niche,
        hook: brief.hook,
        retention: brief.retention_mechanic,
        structure: brief.structure,
        second_by_second: brief.second_by_second,
        visual_recipe: brief.visual_recipe,
        product_fit: brief.product_fit,
        humanization_patch: human?.generator_prompt_patch,
        experiment_axis: exp?.axis,
        experiment_variant: exp?.variant.change_to,
        metrics_to_watch: Array.from(new Set([...(slot?.metrics_to_watch || []), ...(exp?.success_metrics || [])])).slice(0, 6),
        copy_as_mechanic: brief.copy_as_mechanic,
        do_not_copy: brief.do_not_copy,
        safety_guardrails: guardrails,
      },
    } satisfies GeneratorHandoffPayload;
  }).sort((a, b) => b.priority_score - a.priority_score).slice(0, Math.max(1, Math.min(50, limit)));

  return {
    generated_at: new Date().toISOString(),
    total_payloads: payloads.length,
    ready: payloads.filter((payload) => payload.readiness === "ready_to_generate").length,
    needs_revision: payloads.filter((payload) => payload.readiness === "needs_revision").length,
    hold: payloads.filter((payload) => payload.readiness === "hold").length,
    payloads,
    handoff_rules: [
      "Generator Handoff отдаёт только механику и guardrails, не исходное видео.",
      "ready_to_generate можно отправлять в сценарист/режиссер слой без ручной расшифровки.",
      "needs_revision сначала правим risk из Simulation/Humanization, потом генерируем.",
      "hold не запускать, пока не снижен AI-slop или trust risk.",
    ],
  };
}
