import type { ReelsPatternMemoryBundle, ReelsPatternMemoryItem } from "./reelsBrainPatterns";
import { reelsPatternBrain } from "./reelsBrainCreativeBriefs";

export type CameraStyle =
  | "macro_closeup"
  | "handheld_table"
  | "pov_handheld"
  | "fixed_before_after"
  | "top_view_demo"
  | "face_to_camera"
  | "product_closeup";

export type EditingMove =
  | "jump_cut"
  | "match_cut"
  | "speed_ramp"
  | "freeze_frame"
  | "zoom_pop"
  | "text_pop"
  | "reveal_cut"
  | "proof_hold";

export type VisualPattern = {
  id: string;
  niche: string;
  source_pattern_id: string;
  score: number;
  confidence: "high" | "medium" | "low";
  camera: {
    primary: CameraStyle;
    secondary: CameraStyle[];
    framing: string;
    movement: string;
    proof_shot: string;
  };
  editing: {
    rhythm: string;
    moves: EditingMove[];
    first_3_seconds: string[];
    timeline: { t: string; action: string }[];
  };
  visual_recipe: string[];
  product_fit: string[];
  avoid: string[];
};

export type VisualIntelligence = {
  generated_at: string;
  total_patterns: number;
  patterns: VisualPattern[];
  camera_mix: {
    camera: CameraStyle;
    count: number;
    avg_score: number;
  }[];
  editing_mix: {
    move: EditingMove;
    count: number;
    avg_score: number;
  }[];
  editor_payloads: {
    id: string;
    niche: string;
    score: number;
    camera: CameraStyle;
    moves: EditingMove[];
    timeline: { t: string; action: string }[];
  }[];
  director_rules: string[];
};

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function confidence(score: number): VisualPattern["confidence"] {
  if (score >= 78) return "high";
  if (score >= 58) return "medium";
  return "low";
}

function patternList(brain: ReelsPatternMemoryBundle | null): ReelsPatternMemoryItem[] {
  const meta = brain?.meta_brain;
  if (!meta) return [];
  const ready = Array.isArray(meta.generator_ready_patterns) ? meta.generator_ready_patterns : [];
  const all = Array.isArray(meta.patterns) ? meta.patterns : [];
  return (ready.length ? ready : all).filter(Boolean);
}

function visualScore(pattern: ReelsPatternMemoryItem): number {
  return Math.round(Math.min(100,
    num(pattern.strength_score) * 0.42
    + num(pattern.quality_score) * 0.25
    + num(pattern.relevance_score) * 0.16
    + Math.min(10, Math.log(num(pattern.frequency) + 1) * 5)
    + (pattern.structure_type !== "unknown_structure" ? 7 : 0)
  ));
}

function primaryCamera(pattern: ReelsPatternMemoryItem): CameraStyle {
  if (pattern.structure_type === "before_after") return "fixed_before_after";
  if (pattern.structure_type === "unboxing") return "handheld_table";
  if (pattern.structure_type === "pov") return "pov_handheld";
  if (pattern.structure_type === "life_hack") return "top_view_demo";
  if (pattern.hook_type === "direct_claim") return "face_to_camera";
  return "product_closeup";
}

function secondaryCameras(primary: CameraStyle, pattern: ReelsPatternMemoryItem): CameraStyle[] {
  const set = new Set<CameraStyle>();
  if (primary !== "macro_closeup") set.add("macro_closeup");
  if (pattern.structure_type !== "before_after") set.add("product_closeup");
  if (pattern.retention_mechanism === "surprise_hold") set.add("pov_handheld");
  return Array.from(set).slice(0, 3);
}

function editingMoves(pattern: ReelsPatternMemoryItem): EditingMove[] {
  const moves = new Set<EditingMove>();
  if (pattern.retention_mechanism === "surprise_hold") {
    moves.add("jump_cut");
    moves.add("zoom_pop");
    moves.add("text_pop");
  }
  if (pattern.structure_type === "before_after") {
    moves.add("match_cut");
    moves.add("reveal_cut");
    moves.add("proof_hold");
  }
  if (pattern.structure_type === "unboxing") {
    moves.add("jump_cut");
    moves.add("zoom_pop");
  }
  if (pattern.retention_mechanism === "delayed_payoff") {
    moves.add("freeze_frame");
    moves.add("reveal_cut");
  }
  if (!moves.size) {
    moves.add("jump_cut");
    moves.add("text_pop");
  }
  return Array.from(moves);
}

function framing(camera: CameraStyle): string {
  if (camera === "macro_closeup") return "очень крупно: фактура/деталь/результат занимает 70% кадра";
  if (camera === "handheld_table") return "руки + товар на столе, камера чуть живая, без стерильной студийности";
  if (camera === "pov_handheld") return "камера глазами пользователя, товар в бытовом контексте";
  if (camera === "fixed_before_after") return "один и тот же угол до/после, чтобы proof был честным";
  if (camera === "top_view_demo") return "вид сверху, руки показывают действие без лишнего фона";
  if (camera === "face_to_camera") return "лицо/голос + быстрый cut к proof, не держать talking head долго";
  return "крупный план товара + proof-кадр в первые 2 секунды";
}

function movement(camera: CameraStyle): string {
  if (camera === "fixed_before_after") return "почти без движения, чтобы сравнение было читаемым";
  if (camera === "pov_handheld" || camera === "handheld_table") return "лёгкая ручная камера, микродвижения добавляют UGC-живость";
  if (camera === "macro_closeup") return "медленный push-in или короткий zoom-pop на детали";
  return "минимальное движение, акцент на смене кадров";
}

function proofShot(pattern: ReelsPatternMemoryItem): string {
  if (pattern.structure_type === "before_after") return "результат до/после в одинаковом ракурсе";
  if (pattern.structure_type === "unboxing") return "первое касание/распаковка/деталь крупно";
  if (pattern.hook_type === "warning_pattern_break") return "кадр ошибки и правильного варианта рядом";
  return "товар решает проблему в одном понятном proof-кадре";
}

function rhythm(pattern: ReelsPatternMemoryItem): string {
  if (pattern.retention_mechanism === "surprise_hold") return "очень быстрый: 0.35-0.7с на кадр до первого proof";
  if (pattern.structure_type === "before_after") return "сравнительный: держать proof 0.8-1.4с, reveal на акценте";
  if (pattern.structure_type === "unboxing") return "тактильный: микро-склейки на действиях рук";
  return "быстрый UGC: 0.5-1.0с на кадр";
}

function first3(pattern: ReelsPatternMemoryItem): string[] {
  if (pattern.hook_type === "warning_pattern_break") {
    return [
      "0.0-0.5с: показать ошибку/риск крупно + короткий warning text.",
      "0.5-1.5с: быстрый proof, почему это важно.",
      "1.5-3.0с: показать правильный вариант или результат.",
    ];
  }
  if (pattern.structure_type === "before_after") {
    return [
      "0.0-0.7с: проблемный before-кадр.",
      "0.7-1.7с: процесс/действие без длинного объяснения.",
      "1.7-3.0с: teaser результата, полный payoff позже.",
    ];
  }
  return [
    "0.0-0.5с: читаемый hook text + товар/проблема в кадре.",
    "0.5-1.5с: первый visual proof.",
    "1.5-3.0с: смена ракурса, чтобы удержать внимание.",
  ];
}

function timeline(pattern: ReelsPatternMemoryItem): VisualPattern["editing"]["timeline"] {
  const base = first3(pattern);
  return [
    { t: "0.0", action: base[0] },
    { t: "0.7", action: base[1] },
    { t: "1.7", action: base[2] },
    { t: "3.0-5.0", action: pattern.retention_mechanism === "delayed_payoff" ? "держать open loop, не отдавать весь результат сразу" : "дать второй proof-кадр или сравнение" },
    { t: "5.0-8.0", action: "закрыть payoff + CTA/save reason" },
  ];
}

function visualRecipe(pattern: ReelsPatternMemoryItem, camera: CameraStyle): string[] {
  return [
    framing(camera),
    movement(camera),
    proofShot(pattern),
    pattern.structure_type === "before_after" ? "не менять свет/угол между before и after" : "фон не должен спорить с товаром",
    "текст короткий, крупный, меняется вместе со смысловыми beat",
  ];
}

function productFit(niche: string, pattern: ReelsPatternMemoryItem): string[] {
  const normalized = niche.toLowerCase();
  if (normalized.includes("toy") || normalized.includes("игруш")) return ["игрушки с wow-эффектом", "подарки", "товары с реакцией ребёнка"];
  if (normalized.includes("cloth") || normalized.includes("одеж")) return ["посадка на теле", "детали ткани", "до/после образа"];
  if (normalized.includes("cosmetic") || normalized.includes("beauty") || normalized.includes("космет")) return ["текстуры", "before/after", "крупный proof результата"];
  if (pattern.structure_type === "unboxing") return ["товары с упаковкой", "товары с фактурой", "первое использование"];
  return ["визуально доказуемые товары", "товары с быстрым результатом"];
}

function avoid(pattern: ReelsPatternMemoryItem): string[] {
  const out = new Set<string>();
  out.add("Не начинать с пустого фона или логотипа без товара/проблемы.");
  out.add("Не держать один кадр дольше 1.5с до первого proof.");
  if (pattern.structure_type === "before_after") out.add("Не менять ракурс before/after так, чтобы proof выглядел нечестно.");
  if (pattern.hook_type === "direct_claim") out.add("Не делать talking head без proof cut в первые 2 секунды.");
  if (pattern.quality_label !== "generator_ready") out.add("Не масштабировать visual recipe без ручной проверки.");
  return Array.from(out);
}

function visualPattern(niche: string, pattern: ReelsPatternMemoryItem): VisualPattern {
  const camera = primaryCamera(pattern);
  const score = visualScore(pattern);
  return {
    id: `${niche}:${pattern.pattern_id}:visual`,
    niche,
    source_pattern_id: pattern.pattern_id,
    score,
    confidence: confidence(score),
    camera: {
      primary: camera,
      secondary: secondaryCameras(camera, pattern),
      framing: framing(camera),
      movement: movement(camera),
      proof_shot: proofShot(pattern),
    },
    editing: {
      rhythm: rhythm(pattern),
      moves: editingMoves(pattern),
      first_3_seconds: first3(pattern),
      timeline: timeline(pattern),
    },
    visual_recipe: visualRecipe(pattern, camera),
    product_fit: productFit(niche, pattern),
    avoid: avoid(pattern),
  };
}

export function buildVisualIntelligenceFromPlaybooks(rows: { niche?: string; playbook?: unknown }[], limit = 80): VisualIntelligence {
  const patterns = rows.flatMap((row) => {
    const niche = row.niche || "default";
    const brain = reelsPatternBrain(row.playbook);
    return patternList(brain).map((pattern) => visualPattern(niche, pattern));
  }).sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(200, limit)));

  const cameraMap = new Map<CameraStyle, { count: number; sum: number }>();
  const editingMap = new Map<EditingMove, { count: number; sum: number }>();
  for (const pattern of patterns) {
    const camera = cameraMap.get(pattern.camera.primary) || { count: 0, sum: 0 };
    camera.count += 1;
    camera.sum += pattern.score;
    cameraMap.set(pattern.camera.primary, camera);
    for (const move of pattern.editing.moves) {
      const current = editingMap.get(move) || { count: 0, sum: 0 };
      current.count += 1;
      current.sum += pattern.score;
      editingMap.set(move, current);
    }
  }

  return {
    generated_at: new Date().toISOString(),
    total_patterns: patterns.length,
    patterns,
    camera_mix: Array.from(cameraMap.entries()).map(([camera, value]) => ({
      camera,
      count: value.count,
      avg_score: Math.round(value.sum / Math.max(1, value.count)),
    })).sort((a, b) => b.avg_score - a.avg_score),
    editing_mix: Array.from(editingMap.entries()).map(([move, value]) => ({
      move,
      count: value.count,
      avg_score: Math.round(value.sum / Math.max(1, value.count)),
    })).sort((a, b) => b.avg_score - a.avg_score),
    editor_payloads: patterns.slice(0, 30).map((pattern) => ({
      id: pattern.id,
      niche: pattern.niche,
      score: pattern.score,
      camera: pattern.camera.primary,
      moves: pattern.editing.moves,
      timeline: pattern.editing.timeline,
    })),
    director_rules: [
      "Первый кадр обязан показывать товар, проблему или visual proof, а не абстрактный intro.",
      "Камера выбирается под proof: before/after фиксируем, unboxing снимаем руками, lifehack сверху.",
      "Монтажные эффекты не самоцель: zoom/pop/freeze ставятся только на смысловой beat.",
      "Если claim сильный, proof cut должен появиться в первые 2 секунды.",
    ],
  };
}
