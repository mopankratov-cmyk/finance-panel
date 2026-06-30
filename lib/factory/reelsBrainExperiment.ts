import { buildCreativeMemoryFromPlaybooks, type ExperimentAxis } from "./reelsBrainCreativeMemory";
import { buildSimulationBrainFromPlaybooks, type ReelSimulation } from "./reelsBrainSimulation";

export type ExperimentMetric = "hook_rate" | "watch_rate" | "save_rate" | "click_rate" | "order_rate";

export type ReelExperiment = {
  id: string;
  niche: string;
  source_pattern_id: string;
  control_dna_id: string;
  readiness: ReelSimulation["readiness"];
  priority_score: number;
  hypothesis: string;
  axis: ExperimentAxis["axis"];
  keep_fixed: string[];
  variant: {
    change_to: string;
    reason: string;
  };
  success_metrics: ExperimentMetric[];
  stop_rule: string;
  risk: string;
  expected_learning: string;
};

export type ExperimentBrain = {
  generated_at: string;
  total_experiments: number;
  experiments: ReelExperiment[];
  by_axis: {
    axis: ExperimentAxis["axis"];
    count: number;
    avg_priority: number;
  }[];
  launch_queue: ReelExperiment[];
  hold_queue: ReelExperiment[];
  experiment_rules: string[];
};

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function metricForAxis(axis: ExperimentAxis["axis"]): ExperimentMetric[] {
  if (axis === "hook") return ["hook_rate", "watch_rate"];
  if (axis === "cta") return ["save_rate", "click_rate"];
  if (axis === "camera" || axis === "editing") return ["watch_rate", "save_rate"];
  if (axis === "audio") return ["hook_rate", "watch_rate"];
  return ["watch_rate", "order_rate"];
}

function axisImpact(axis: ExperimentAxis["axis"]) {
  if (axis === "hook") return 18;
  if (axis === "audio") return 14;
  if (axis === "camera") return 13;
  if (axis === "editing") return 12;
  if (axis === "proof") return 15;
  if (axis === "cta") return 9;
  return 8;
}

function hypothesis(axis: ExperimentAxis["axis"], risk: string) {
  if (axis === "hook") return `Если заменить вход, удержание первых секунд вырастет без смены механики. Риск: ${risk}`;
  if (axis === "audio") return `Если сделать audio-first вход, scroll-stop и watch-rate вырастут. Риск: ${risk}`;
  if (axis === "camera") return `Если поменять ракурс, trust/proof может вырасти без переписывания сценария. Риск: ${risk}`;
  if (axis === "cta") return `Если заменить CTA, save/click изменятся при той же креативной механике. Риск: ${risk}`;
  if (axis === "editing") return `Если изменить rhythm/move, досмотр вырастет без смены hook. Риск: ${risk}`;
  return `Если усилить proof, скептики будут меньше отваливаться. Риск: ${risk}`;
}

function stopRule(metrics: ExperimentMetric[]) {
  if (metrics.includes("hook_rate")) return "Остановить вариант, если hook_rate ниже контроля на 15% после минимального объема.";
  if (metrics.includes("save_rate")) return "Остановить вариант, если save_rate ниже контроля на 12% и watch_rate не растет.";
  if (metrics.includes("order_rate")) return "Остановить вариант, если watch_rate растет, но order/click падает сильнее 10%.";
  return "Остановить вариант, если watch_rate ниже контроля на 12%.";
}

function experimentPriority(sim: ReelSimulation, axis: ExperimentAxis["axis"]) {
  const readinessBase = sim.readiness === "ship" ? 64 : sim.readiness === "revise" ? 76 : 34;
  const weaknessBonus = Math.max(0, 75 - sim.score) * 0.35;
  return clamp(readinessBase + axisImpact(axis) + weaknessBonus);
}

function byPatternId<T extends { source_pattern_id: string }>(items: T[]) {
  const map = new Map<string, T>();
  for (const item of items) if (!map.has(item.source_pattern_id)) map.set(item.source_pattern_id, item);
  return map;
}

export function buildExperimentBrainFromPlaybooks(rows: { niche?: string; playbook?: unknown }[], limit = 50): ExperimentBrain {
  const creative = buildCreativeMemoryFromPlaybooks(rows, limit);
  const simulation = buildSimulationBrainFromPlaybooks(rows, limit);
  const simulationByPattern = byPatternId(simulation.simulations);

  const experiments = creative.experiment_skeletons.flatMap((skeleton) => {
    const sim = simulationByPattern.get(skeleton.source_pattern_id);
    if (!sim) return [];
    return skeleton.variants.map((axis) => {
      const metrics = metricForAxis(axis.axis);
      const priority = experimentPriority(sim, axis.axis);
      return {
        id: `${skeleton.id}:${axis.axis}`,
        niche: skeleton.niche,
        source_pattern_id: skeleton.source_pattern_id,
        control_dna_id: skeleton.control_dna_id,
        readiness: sim.readiness,
        priority_score: priority,
        hypothesis: hypothesis(axis.axis, sim.biggest_risk),
        axis: axis.axis,
        keep_fixed: axis.keep_fixed,
        variant: {
          change_to: axis.change_to,
          reason: axis.reason,
        },
        success_metrics: metrics,
        stop_rule: stopRule(metrics),
        risk: sim.biggest_risk,
        expected_learning: `Поймем, влияет ли ${axis.axis} сильнее текущей winning-механики для ${skeleton.niche}.`,
      } satisfies ReelExperiment;
    });
  }).sort((a, b) => b.priority_score - a.priority_score);

  const axisMap = new Map<ExperimentAxis["axis"], { count: number; sum: number }>();
  for (const exp of experiments) {
    const current = axisMap.get(exp.axis) || { count: 0, sum: 0 };
    current.count += 1;
    current.sum += exp.priority_score;
    axisMap.set(exp.axis, current);
  }

  return {
    generated_at: new Date().toISOString(),
    total_experiments: experiments.length,
    experiments,
    by_axis: Array.from(axisMap.entries()).map(([axis, value]) => ({
      axis,
      count: value.count,
      avg_priority: clamp(value.sum / Math.max(1, value.count)),
    })).sort((a, b) => b.avg_priority - a.avg_priority),
    launch_queue: experiments.filter((exp) => exp.readiness !== "hold").slice(0, 20),
    hold_queue: experiments.filter((exp) => exp.readiness === "hold").slice(0, 20),
    experiment_rules: [
      "Меняем только одну переменную за тест: hook, audio, camera, editing, CTA или proof.",
      "Не тестируем hold-кандидаты без предварительной правки Simulation risk.",
      "Контрольная версия всегда сохраняет structure, retention, product и audience.",
      "Победивший вариант возвращается в Creative Memory через outcome feedback.",
    ],
  };
}
