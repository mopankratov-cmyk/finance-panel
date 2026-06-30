import { buildAudioIntelligenceFromPlaybooks, type AudioPattern } from "./reelsBrainAudioIntelligence";
import { buildCreativeMemoryFromPlaybooks, type CreativeDNA } from "./reelsBrainCreativeMemory";
import { buildVisualIntelligenceFromPlaybooks, type VisualPattern } from "./reelsBrainVisualIntelligence";

export type SimulationPersona =
  | "parent_buyer"
  | "impulse_buyer"
  | "skeptic"
  | "trend_native"
  | "product_detail_buyer";

export type PersonaScore = {
  persona: SimulationPersona;
  score: number;
  likely_reaction: "watch" | "save" | "skip" | "buy_interest";
  likes: string[];
  concerns: string[];
  suggested_fix: string;
};

export type ReelSimulation = {
  id: string;
  niche: string;
  source_pattern_id: string;
  score: number;
  readiness: "ship" | "revise" | "hold";
  dna_id: string;
  creative_score: number;
  audio_score: number;
  visual_score: number;
  persona_scores: PersonaScore[];
  strongest_reason: string;
  biggest_risk: string;
  recommended_iteration: string;
  generator_guardrails: string[];
};

export type SimulationBrain = {
  generated_at: string;
  total_simulations: number;
  simulations: ReelSimulation[];
  persona_summary: {
    persona: SimulationPersona;
    avg_score: number;
    likely_reactions: Record<string, number>;
    top_concerns: string[];
  }[];
  top_ship_candidates: ReelSimulation[];
  revise_queue: ReelSimulation[];
  global_guardrails: string[];
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function confidenceBoost(confidence: CreativeDNA["confidence"] | AudioPattern["confidence"] | VisualPattern["confidence"]) {
  if (confidence === "high") return 6;
  if (confidence === "medium") return 2;
  return -6;
}

function reaction(score: number): PersonaScore["likely_reaction"] {
  if (score >= 82) return "buy_interest";
  if (score >= 70) return "save";
  if (score >= 52) return "watch";
  return "skip";
}

function personaBase(persona: SimulationPersona, dna: CreativeDNA, audio?: AudioPattern, visual?: VisualPattern) {
  let score = dna.score * 0.45 + (audio?.score || dna.score) * 0.22 + (visual?.score || dna.score) * 0.33;
  const likes: string[] = [];
  const concerns: string[] = [];

  if (persona === "parent_buyer") {
    if (/мам|родител|toy|реб/i.test(dna.audience_brain.primary_audience + dna.product_brain.product_type)) {
      score += 8;
      likes.push("похоже на живой родительский proof, а не рекламный ролик");
    }
    if (dna.product_brain.proof_need === "high" && !/proof|after|result|до/i.test(String(visual?.camera.proof_shot || dna.atoms.broll))) {
      score -= 10;
      concerns.push("не хватает очевидного доказательства пользы для ребенка/родителя");
    }
  }

  if (persona === "impulse_buyer") {
    if (/wow|surprise|удив|status|подар/i.test(dna.atoms.emotion + dna.product_brain.best_for.join(" "))) {
      score += 9;
      likes.push("есть импульс: быстро понятно, почему это хочется попробовать");
    }
    if (!/save|try|share|compare|check/i.test(dna.atoms.cta)) {
      score -= 5;
      concerns.push("CTA может быть слабым для действия сразу после просмотра");
    }
  }

  if (persona === "skeptic") {
    if (/before|after|proof|compare|до|после|сравн/i.test(`${dna.atoms.structure} ${visual?.camera.proof_shot || ""}`)) {
      score += 10;
      likes.push("есть проверяемый proof, меньше ощущения пустого обещания");
    }
    if (/direct claim|прям/i.test(dna.atoms.hook) && dna.product_brain.proof_need !== "low") {
      score -= 12;
      concerns.push("прямое обещание без железного proof может вызвать недоверие");
    }
  }

  if (persona === "trend_native") {
    if (/fast|pop|trend|jump|zoom/i.test(`${audio?.strategy || ""} ${visual?.editing.moves.join(" ") || ""}`)) {
      score += 8;
      likes.push("ритм похож на native short-form, не на классическую рекламу");
    }
    if (audio && !audio.speech.starts_immediately) {
      score -= 8;
      concerns.push("слишком поздний вход звука/голоса для ленты");
    }
  }

  if (persona === "product_detail_buyer") {
    if (/macro|close|detail|texture|детал|фактур|proof/i.test(`${visual?.camera.primary || ""} ${visual?.camera.framing || ""} ${dna.atoms.broll}`)) {
      score += 9;
      likes.push("видны детали товара и понятен visual proof");
    }
    if (/pov|scene/i.test(String(visual?.camera.primary || "")) && dna.product_brain.proof_need === "high") {
      score -= 6;
      concerns.push("POV может быть живым, но деталей товара может не хватить");
    }
  }

  score += confidenceBoost(dna.confidence);
  if (audio) score += confidenceBoost(audio.confidence) * 0.5;
  if (visual) score += confidenceBoost(visual.confidence) * 0.5;

  if (!likes.length) likes.push("структура ролика понятна и собирается из проверенных атомов");
  if (!concerns.length) concerns.push("риск умеренный: нужно проверить на реальном удержании после публикации");

  return { score: clamp(score), likes, concerns };
}

function personaFix(persona: SimulationPersona, concerns: string[]): string {
  if (persona === "parent_buyer") return "добавить бытовой proof и реакцию/контекст использования";
  if (persona === "impulse_buyer") return "усилить первые 2 секунды и CTA на save/try";
  if (persona === "skeptic") return "поставить proof-кадр раньше и убрать голый claim";
  if (persona === "trend_native") return "ускорить монтаж, добавить native pop/zoom на смысловой beat";
  if (persona === "product_detail_buyer") return "добавить macro/detail shot до CTA";
  return concerns[0] || "сделать один A/B вариант";
}

function scorePersona(persona: SimulationPersona, dna: CreativeDNA, audio?: AudioPattern, visual?: VisualPattern): PersonaScore {
  const base = personaBase(persona, dna, audio, visual);
  return {
    persona,
    score: base.score,
    likely_reaction: reaction(base.score),
    likes: base.likes,
    concerns: base.concerns,
    suggested_fix: personaFix(persona, base.concerns),
  };
}

function readiness(score: number): ReelSimulation["readiness"] {
  if (score >= 76) return "ship";
  if (score >= 58) return "revise";
  return "hold";
}

function byPatternId<T extends { source_pattern_id: string }>(items: T[]) {
  const map = new Map<string, T>();
  for (const item of items) if (!map.has(item.source_pattern_id)) map.set(item.source_pattern_id, item);
  return map;
}

function simulationFor(dna: CreativeDNA, audio?: AudioPattern, visual?: VisualPattern): ReelSimulation {
  const personas: SimulationPersona[] = ["parent_buyer", "impulse_buyer", "skeptic", "trend_native", "product_detail_buyer"];
  const persona_scores = personas.map((persona) => scorePersona(persona, dna, audio, visual));
  const avgPersona = persona_scores.reduce((sum, row) => sum + row.score, 0) / Math.max(1, persona_scores.length);
  const score = clamp(dna.score * 0.35 + (audio?.score || dna.score) * 0.18 + (visual?.score || dna.score) * 0.22 + avgPersona * 0.25);
  const weakest = [...persona_scores].sort((a, b) => a.score - b.score)[0];
  const strongest = [...persona_scores].sort((a, b) => b.score - a.score)[0];
  return {
    id: `${dna.id}:simulation`,
    niche: dna.niche,
    source_pattern_id: dna.source_pattern_id,
    score,
    readiness: readiness(score),
    dna_id: dna.id,
    creative_score: dna.score,
    audio_score: audio?.score || 0,
    visual_score: visual?.score || 0,
    persona_scores,
    strongest_reason: `${strongest.persona}: ${strongest.likes[0]}`,
    biggest_risk: `${weakest.persona}: ${weakest.concerns[0]}`,
    recommended_iteration: weakest.suggested_fix,
    generator_guardrails: [
      ...dna.anti_patterns.slice(0, 2),
      ...(audio?.avoid || []).slice(0, 2),
      ...(visual?.avoid || []).slice(0, 2),
    ].filter(Boolean),
  };
}

export function buildSimulationBrainFromPlaybooks(rows: { niche?: string; playbook?: unknown }[], limit = 50): SimulationBrain {
  const creative = buildCreativeMemoryFromPlaybooks(rows, limit);
  const audio = buildAudioIntelligenceFromPlaybooks(rows, limit);
  const visual = buildVisualIntelligenceFromPlaybooks(rows, limit);
  const audioByPattern = byPatternId(audio.patterns);
  const visualByPattern = byPatternId(visual.patterns);

  const simulations = creative.dna
    .slice(0, Math.max(1, Math.min(100, limit)))
    .map((dna) => simulationFor(dna, audioByPattern.get(dna.source_pattern_id), visualByPattern.get(dna.source_pattern_id)))
    .sort((a, b) => b.score - a.score);

  const persona_summary = (["parent_buyer", "impulse_buyer", "skeptic", "trend_native", "product_detail_buyer"] as SimulationPersona[]).map((persona) => {
    const rowsForPersona = simulations.flatMap((sim) => sim.persona_scores.filter((row) => row.persona === persona));
    const reactionCounts: Record<string, number> = {};
    const concerns = new Map<string, number>();
    for (const row of rowsForPersona) {
      reactionCounts[row.likely_reaction] = (reactionCounts[row.likely_reaction] || 0) + 1;
      for (const concern of row.concerns) concerns.set(concern, (concerns.get(concern) || 0) + 1);
    }
    return {
      persona,
      avg_score: clamp(rowsForPersona.reduce((sum, row) => sum + row.score, 0) / Math.max(1, rowsForPersona.length)),
      likely_reactions: reactionCounts,
      top_concerns: Array.from(concerns.entries()).sort((a, b) => b[1] - a[1]).map(([concern]) => concern).slice(0, 5),
    };
  });

  return {
    generated_at: new Date().toISOString(),
    total_simulations: simulations.length,
    simulations,
    persona_summary,
    top_ship_candidates: simulations.filter((row) => row.readiness === "ship").slice(0, 10),
    revise_queue: simulations.filter((row) => row.readiness !== "ship").slice(0, 20),
    global_guardrails: [
      "Не отправлять в генератор ролики с readiness=hold без ручной правки.",
      "Если skeptic score ниже 55, proof-кадр должен быть перенесён в первые 2 секунды.",
      "Если trend_native score ниже 55, ускорить первые склейки и добавить native audio/edit cue.",
      "Если product_detail_buyer score ниже 55, добавить macro/detail shot до CTA.",
    ],
  };
}
