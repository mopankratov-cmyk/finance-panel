import { buildAudioIntelligenceFromPlaybooks, type AudioPattern } from "./reelsBrainAudioIntelligence";
import { buildCreativeMemoryFromPlaybooks, type CreativeDNA } from "./reelsBrainCreativeMemory";
import { buildSimulationBrainFromPlaybooks, type ReelSimulation } from "./reelsBrainSimulation";
import { buildVisualIntelligenceFromPlaybooks, type VisualPattern } from "./reelsBrainVisualIntelligence";

export type HumanizationMove =
  | "micro_pause"
  | "breath"
  | "hand_jitter"
  | "glance_away"
  | "imperfect_phrase"
  | "natural_reaction"
  | "messy_context"
  | "tactile_sound"
  | "proof_before_polish";

export type HumanizedRecipe = {
  id: string;
  niche: string;
  source_pattern_id: string;
  score: number;
  ai_slop_risk: "low" | "medium" | "high";
  moves: HumanizationMove[];
  voice_direction: string[];
  camera_direction: string[];
  performance_notes: string[];
  keep_human: string[];
  avoid_ai_slop: string[];
  generator_prompt_patch: string;
};

export type HumanizationBrain = {
  generated_at: string;
  total_recipes: number;
  recipes: HumanizedRecipe[];
  move_mix: {
    move: HumanizationMove;
    count: number;
    avg_score: number;
  }[];
  prompt_patches: {
    id: string;
    niche: string;
    patch: string;
  }[];
  global_rules: string[];
};

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function byPatternId<T extends { source_pattern_id: string }>(items: T[]) {
  const map = new Map<string, T>();
  for (const item of items) if (!map.has(item.source_pattern_id)) map.set(item.source_pattern_id, item);
  return map;
}

function aiSlopRisk(dna: CreativeDNA, audio?: AudioPattern, visual?: VisualPattern, simulation?: ReelSimulation): HumanizedRecipe["ai_slop_risk"] {
  let risk = 0;
  if (/direct claim|прям/i.test(dna.atoms.hook)) risk += 2;
  if (/face_to_camera|fixed/i.test(String(visual?.camera.primary || ""))) risk += 1;
  if (/proof|before|after|до|после/i.test(`${dna.atoms.structure} ${visual?.camera.proof_shot || ""}`)) risk -= 1;
  if (audio?.speech.starts_immediately) risk -= 1;
  if (simulation?.readiness === "hold") risk += 2;
  if (simulation?.biggest_risk && /недовер|proof|детал/i.test(simulation.biggest_risk)) risk += 1;
  if (risk >= 3) return "high";
  if (risk >= 1) return "medium";
  return "low";
}

function movesFor(dna: CreativeDNA, audio?: AudioPattern, visual?: VisualPattern, simulation?: ReelSimulation): HumanizationMove[] {
  const moves = new Set<HumanizationMove>();
  moves.add("proof_before_polish");
  if (audio?.strategy === "voice_first" || dna.atoms.speech.includes("voice")) {
    moves.add("micro_pause");
    moves.add("breath");
    moves.add("imperfect_phrase");
  }
  if (/handheld|pov|table/i.test(`${visual?.camera.primary || ""} ${visual?.camera.movement || ""}`)) {
    moves.add("hand_jitter");
    moves.add("messy_context");
  }
  if (/unboxing|texture|tactile/i.test(`${dna.atoms.structure} ${dna.atoms.broll} ${audio?.strategy || ""}`)) moves.add("tactile_sound");
  if (/parent|мам|родител|реб/i.test(dna.audience_brain.primary_audience)) moves.add("natural_reaction");
  if (simulation?.biggest_risk && /скептик|skeptic|недовер/i.test(simulation.biggest_risk)) moves.add("glance_away");
  return Array.from(moves).slice(0, 7);
}

function voiceDirection(dna: CreativeDNA, audio?: AudioPattern): string[] {
  const speed = audio?.speech.suggested_speed || "medium";
  return [
    speed === "fast" ? "говорить быстро, но не дикторски; будто показываешь находку другу" : "говорить спокойно, бытовым UGC-тоном",
    "оставить одну микропаузу перед главным proof",
    "не использовать рекламные формулировки вроде 'уникальный', 'лучший', 'идеальный'",
    dna.atoms.hook ? `первую фразу держать в логике: ${dna.atoms.hook}` : "первая фраза должна звучать как живой вход, а не заголовок",
  ];
}

function cameraDirection(visual?: VisualPattern): string[] {
  return [
    visual?.camera.movement || "лёгкая ручная камера без стерильной студии",
    visual?.camera.framing || "товар и proof должны быть в кадре с первой секунды",
    "допустить небольшую неровность рук/кадра, если это не мешает понять товар",
    "фон бытовой, но не грязный; не использовать идеально пустую AI-студию",
  ];
}

function performanceNotes(dna: CreativeDNA, simulation?: ReelSimulation): string[] {
  return [
    "реакция должна быть маленькой, не театральной",
    "если есть ошибка/сомнение, показать его лицом или руками до решения",
    simulation?.recommended_iteration ? `учесть critic fix: ${simulation.recommended_iteration}` : "не сглаживать все шероховатости",
    dna.product_brain.proof_need === "high" ? "сначала proof, потом красота" : "не превращать ролик в polished-рекламу",
  ];
}

function avoid(dna: CreativeDNA, risk: HumanizedRecipe["ai_slop_risk"]): string[] {
  const out = [
    "запрещено: идеальная дикторская подача без дыхания и пауз",
    "запрещено: стерильный фон без бытового контекста",
    "запрещено: слишком гладкие AI-руки/лица, если можно показать товар крупно",
  ];
  if (risk === "high") out.push("запрещено: direct claim без живого proof в первые 2 секунды");
  if (dna.anti_patterns.length) out.push(...dna.anti_patterns.slice(0, 2));
  return out;
}

function recipeFor(dna: CreativeDNA, audio?: AudioPattern, visual?: VisualPattern, simulation?: ReelSimulation): HumanizedRecipe {
  const risk = aiSlopRisk(dna, audio, visual, simulation);
  const moves = movesFor(dna, audio, visual, simulation);
  const score = clamp(dna.score + (audio?.score || 0) * 0.12 + (visual?.score || 0) * 0.16 + (simulation?.score || 0) * 0.12 - (risk === "high" ? 12 : risk === "medium" ? 4 : 0));
  const keepHuman = [
    "сохранить ощущение снятого с телефона UGC",
    "показывать действие руками, а не только красивый packshot",
    "оставить микронеровность речи/кадра, если она усиливает доверие",
  ];
  const avoidAiSlop = avoid(dna, risk);
  return {
    id: `${dna.id}:humanized`,
    niche: dna.niche,
    source_pattern_id: dna.source_pattern_id,
    score,
    ai_slop_risk: risk,
    moves,
    voice_direction: voiceDirection(dna, audio),
    camera_direction: cameraDirection(visual),
    performance_notes: performanceNotes(dna, simulation),
    keep_human: keepHuman,
    avoid_ai_slop: avoidAiSlop,
    generator_prompt_patch: [
      "Humanize the reel: make it feel like a real UGC phone video, not a polished ad.",
      `Use moves: ${moves.join(", ")}.`,
      `Voice: ${voiceDirection(dna, audio).slice(0, 2).join(" ")}`,
      `Camera: ${cameraDirection(visual).slice(0, 2).join(" ")}`,
      `Avoid: ${avoidAiSlop.slice(0, 3).join(" ")}`,
    ].join(" "),
  };
}

export function buildHumanizationBrainFromPlaybooks(rows: { niche?: string; playbook?: unknown }[], limit = 50): HumanizationBrain {
  const creative = buildCreativeMemoryFromPlaybooks(rows, limit);
  const audio = buildAudioIntelligenceFromPlaybooks(rows, limit);
  const visual = buildVisualIntelligenceFromPlaybooks(rows, limit);
  const simulation = buildSimulationBrainFromPlaybooks(rows, limit);
  const audioByPattern = byPatternId(audio.patterns);
  const visualByPattern = byPatternId(visual.patterns);
  const simulationByPattern = byPatternId(simulation.simulations);

  const recipes = creative.dna
    .slice(0, Math.max(1, Math.min(100, limit)))
    .map((dna) => recipeFor(dna, audioByPattern.get(dna.source_pattern_id), visualByPattern.get(dna.source_pattern_id), simulationByPattern.get(dna.source_pattern_id)))
    .sort((a, b) => b.score - a.score);

  const moveMap = new Map<HumanizationMove, { count: number; sum: number }>();
  for (const recipe of recipes) {
    for (const move of recipe.moves) {
      const current = moveMap.get(move) || { count: 0, sum: 0 };
      current.count += 1;
      current.sum += recipe.score;
      moveMap.set(move, current);
    }
  }

  return {
    generated_at: new Date().toISOString(),
    total_recipes: recipes.length,
    recipes,
    move_mix: Array.from(moveMap.entries()).map(([move, value]) => ({
      move,
      count: value.count,
      avg_score: clamp(value.sum / Math.max(1, value.count)),
    })).sort((a, b) => b.avg_score - a.avg_score),
    prompt_patches: recipes.slice(0, 20).map((recipe) => ({
      id: recipe.id,
      niche: recipe.niche,
      patch: recipe.generator_prompt_patch,
    })),
    global_rules: [
      "Proof before polish: сначала доказательство, потом красота.",
      "Не убирать все паузы, дыхание и микродвижения.",
      "UGC-реакция должна быть маленькой и правдоподобной, не театральной.",
      "Если AI-аватар выглядит слишком идеально, заменить на hands/product POV.",
    ],
  };
}
