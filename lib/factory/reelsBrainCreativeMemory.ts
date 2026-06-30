import type { ReelsPatternMemoryBundle, ReelsPatternMemoryItem } from "./reelsBrainPatterns";
import { reelsPatternBrain } from "./reelsBrainCreativeBriefs";

export type CreativeAtomType =
  | "hook"
  | "emotion"
  | "structure"
  | "retention"
  | "camera"
  | "editing"
  | "broll"
  | "cta"
  | "audio"
  | "speech"
  | "product"
  | "audience";

export type CreativeAtom = {
  id: string;
  type: CreativeAtomType;
  label: string;
  value: string;
  score: number;
  evidence_count: number;
  niches: string[];
  source_pattern_ids: string[];
};

export type CreativeDNA = {
  id: string;
  niche: string;
  source_pattern_id: string;
  score: number;
  confidence: "high" | "medium" | "low";
  atoms: Record<CreativeAtomType, string>;
  product_brain: {
    product_type: string;
    proof_need: "low" | "medium" | "high";
    best_for: string[];
  };
  audience_brain: {
    primary_audience: string;
    motivation: string;
    tone: string;
  };
  anti_patterns: string[];
  experiment_axes: ExperimentAxis[];
};

export type ExperimentAxis = {
  axis: "hook" | "cta" | "camera" | "audio" | "proof" | "editing";
  keep_fixed: CreativeAtomType[];
  change_to: string;
  reason: string;
};

export type CreativeMemory = {
  generated_at: string;
  total_atoms: number;
  total_dna: number;
  atoms: CreativeAtom[];
  dna: CreativeDNA[];
  combinations: {
    id: string;
    niche: string;
    score: number;
    atoms: Partial<Record<CreativeAtomType, string>>;
    source_pattern_id: string;
  }[];
  anti_patterns: {
    id: string;
    label: string;
    reason: string;
    severity: "watch" | "avoid";
    evidence_count: number;
    source_pattern_ids: string[];
  }[];
  product_brain: {
    product_type: string;
    best_atoms: Partial<Record<CreativeAtomType, string[]>>;
    recommended_formats: string[];
  }[];
  audience_brain: {
    audience: string;
    best_atoms: Partial<Record<CreativeAtomType, string[]>>;
    tone_rules: string[];
  }[];
  experiment_skeletons: {
    id: string;
    niche: string;
    source_pattern_id: string;
    control_dna_id: string;
    variants: ExperimentAxis[];
  }[];
};

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "unknown";
}

function label(value: string | undefined, fallback: string): string {
  return String(value || fallback).replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function patternList(brain: ReelsPatternMemoryBundle | null): ReelsPatternMemoryItem[] {
  const meta = brain?.meta_brain;
  if (!meta) return [];
  const ready = Array.isArray(meta.generator_ready_patterns) ? meta.generator_ready_patterns : [];
  const all = Array.isArray(meta.patterns) ? meta.patterns : [];
  return (ready.length ? ready : all).filter(Boolean);
}

function score(pattern: ReelsPatternMemoryItem): number {
  return Math.round(Math.min(100,
    num(pattern.strength_score) * 0.45
    + num(pattern.quality_score) * 0.3
    + num(pattern.relevance_score) * 0.15
    + Math.min(10, Math.log(num(pattern.frequency) + 1) * 5)
  ));
}

function confidence(value: number): CreativeDNA["confidence"] {
  if (value >= 78) return "high";
  if (value >= 58) return "medium";
  return "low";
}

function inferProductBrain(niche: string, pattern: ReelsPatternMemoryItem): CreativeDNA["product_brain"] {
  const normalized = niche.toLowerCase();
  if (normalized.includes("toy") || normalized.includes("игруш")) {
    return {
      product_type: "toy / wow-demo",
      proof_need: "medium",
      best_for: ["игрушки с быстрым эффектом", "подарки", "товары с реакцией ребенка"],
    };
  }
  if (normalized.includes("cosmetic") || normalized.includes("beauty") || normalized.includes("космет")) {
    return {
      product_type: "beauty / visible-proof",
      proof_need: pattern.structure_type === "before_after" ? "high" : "medium",
      best_for: ["before/after", "крупный proof-кадр", "демонстрация текстуры"],
    };
  }
  if (normalized.includes("cloth") || normalized.includes("одеж")) {
    return {
      product_type: "fashion / fit-proof",
      proof_need: "high",
      best_for: ["посадка на теле", "сравнение до/после", "детали ткани и цвета"],
    };
  }
  return {
    product_type: "generic / visual-proof",
    proof_need: pattern.hook_type === "direct_claim" ? "high" : "medium",
    best_for: ["визуально доказуемая польза", "быстрая демонстрация", "понятный результат"],
  };
}

function inferAudienceBrain(niche: string, pattern: ReelsPatternMemoryItem): CreativeDNA["audience_brain"] {
  const normalized = niche.toLowerCase();
  if (normalized.includes("toy") || normalized.includes("игруш")) {
    return {
      primary_audience: pattern.emotion === "status" ? "подарки / импульсный покупатель" : "мамы / родители",
      motivation: "быстро понять, понравится ли ребенку и стоит ли покупать",
      tone: "живой UGC, бытовой proof, минимум рекламной гладкости",
    };
  }
  if (normalized.includes("cosmetic") || normalized.includes("beauty") || normalized.includes("космет")) {
    return {
      primary_audience: "покупатель beauty / уход",
      motivation: "увидеть честный эффект и снизить риск ошибки",
      tone: "доверительный обзор, close-up, proof без чрезмерного обещания",
    };
  }
  return {
    primary_audience: "импульсный покупатель",
    motivation: "быстро увидеть проблему, решение и причину сохранить",
    tone: "коротко, доказательно, без длинного вступления",
  };
}

function inferCamera(pattern: ReelsPatternMemoryItem): string {
  if (pattern.structure_type === "before_after") return "fixed close-up / same angle before-after";
  if (pattern.structure_type === "unboxing") return "handheld table close-up";
  if (pattern.structure_type === "pov") return "POV handheld";
  if (pattern.structure_type === "life_hack") return "top view + hand demo";
  return "close-up demo";
}

function inferEditing(pattern: ReelsPatternMemoryItem): string {
  if (pattern.retention_mechanism === "delayed_payoff") return "fast cuts with delayed reveal";
  if (pattern.retention_mechanism === "surprise_hold") return "jump cuts + reveal pop";
  if (pattern.structure_type === "before_after") return "match cut before-after";
  return "cuts every 0.5-1.0 sec";
}

function inferBroll(pattern: ReelsPatternMemoryItem): string {
  if (pattern.structure_type === "unboxing") return "hands, packaging, texture, first use";
  if (pattern.structure_type === "before_after") return "problem close-up, use, result close-up";
  if (pattern.structure_type === "pov") return "real-life scene, reaction, product in context";
  return "product close-ups + proof shot";
}

function inferCta(pattern: ReelsPatternMemoryItem): string {
  if (pattern.hook_type === "list_promise") return "save this checklist";
  if (pattern.hook_type === "warning_pattern_break") return "check before buying";
  if (pattern.structure_type === "before_after") return "compare and save";
  return "save / share / try this";
}

function inferAudio(pattern: ReelsPatternMemoryItem): string {
  if (pattern.retention_mechanism === "surprise_hold") return "fast UGC speech + pop effects";
  if (pattern.structure_type === "unboxing") return "soft trend sound + tactile pops";
  if (pattern.hook_type === "warning_pattern_break") return "voice-first, low music bed";
  return "voice starts immediately + light music";
}

function antiPatterns(pattern: ReelsPatternMemoryItem): string[] {
  const out = new Set<string>();
  if (pattern.quality_label === "noise") out.add("Не генерировать: паттерн помечен как noise.");
  if (pattern.relevance_score < 55) out.add("Не использовать без ручной проверки: низкая релевантность нише.");
  if (pattern.structure_type === "unknown_structure") out.add("Не начинать генерацию без явной структуры по секундам.");
  if (pattern.hook_type === "direct_claim") out.add("Не делать прямой claim без proof-кадра в первые 3-5 секунд.");
  if (pattern.frequency <= 1) out.add("Не масштабировать: singleton-паттерн, нужен повторный сигнал.");
  return Array.from(out);
}

function dnaForPattern(niche: string, pattern: ReelsPatternMemoryItem): CreativeDNA {
  const dnaScore = score(pattern);
  const atoms: Record<CreativeAtomType, string> = {
    hook: pattern.hook_label || label(pattern.hook_type, "хук"),
    emotion: pattern.emotion_label || label(pattern.emotion, "интерес"),
    structure: pattern.structure_label || label(pattern.structure_type, "демонстрация"),
    retention: pattern.retention_label || label(pattern.retention_mechanism, "удержание"),
    camera: inferCamera(pattern),
    editing: inferEditing(pattern),
    broll: inferBroll(pattern),
    cta: inferCta(pattern),
    audio: inferAudio(pattern),
    speech: pattern.hook_type === "warning_pattern_break" ? "voice-first warning phrase" : "short UGC phrase",
    product: inferProductBrain(niche, pattern).product_type,
    audience: inferAudienceBrain(niche, pattern).primary_audience,
  };
  const fixed: CreativeAtomType[] = ["structure", "retention", "product", "audience"];
  return {
    id: `${niche}:${pattern.pattern_id}:dna`,
    niche,
    source_pattern_id: pattern.pattern_id,
    score: dnaScore,
    confidence: confidence(dnaScore),
    atoms,
    product_brain: inferProductBrain(niche, pattern),
    audience_brain: inferAudienceBrain(niche, pattern),
    anti_patterns: antiPatterns(pattern),
    experiment_axes: [
      { axis: "hook", keep_fixed: fixed, change_to: "same structure with curiosity/question hook", reason: "Проверить, влияет ли вход сильнее формата." },
      { axis: "cta", keep_fixed: [...fixed, "hook"], change_to: inferCta({ ...pattern, hook_type: "list_promise" }), reason: "CTA часто меняет saves без смены ролика." },
      { axis: "camera", keep_fixed: [...fixed, "hook", "cta"], change_to: "macro close-up / POV alternative", reason: "Камера меняет trust и proof без переписывания сценария." },
      { axis: "audio", keep_fixed: [...fixed, "hook", "camera"], change_to: "voice-first + lighter music bed", reason: "Проверить досмотр первых 2 секунд через audio-first вход." },
    ],
  };
}

function addAtom(map: Map<string, CreativeAtom>, input: {
  type: CreativeAtomType;
  value: string;
  niche: string;
  score: number;
  patternId: string;
}) {
  const id = `${input.type}:${slug(input.value)}`;
  const current = map.get(id) || {
    id,
    type: input.type,
    label: label(input.value, input.type),
    value: input.value,
    score: 0,
    evidence_count: 0,
    niches: [],
    source_pattern_ids: [],
  };
  current.score = Math.round(((current.score * current.evidence_count) + input.score) / Math.max(1, current.evidence_count + 1));
  current.evidence_count += 1;
  if (!current.niches.includes(input.niche)) current.niches.push(input.niche);
  if (!current.source_pattern_ids.includes(input.patternId)) current.source_pattern_ids.push(input.patternId);
  map.set(id, current);
}

export function buildCreativeMemoryFromPlaybooks(rows: { niche?: string; playbook?: unknown }[], limit = 80): CreativeMemory {
  const dna = rows.flatMap((row) => {
    const niche = row.niche || "default";
    const brain = reelsPatternBrain(row.playbook);
    return patternList(brain).map((pattern) => dnaForPattern(niche, pattern));
  }).sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(200, limit)));

  const atomMap = new Map<string, CreativeAtom>();
  for (const item of dna) {
    for (const [type, value] of Object.entries(item.atoms) as [CreativeAtomType, string][]) {
      addAtom(atomMap, { type, value, niche: item.niche, score: item.score, patternId: item.source_pattern_id });
    }
  }

  const antiMap = new Map<string, CreativeMemory["anti_patterns"][number]>();
  for (const item of dna) {
    for (const anti of item.anti_patterns) {
      const id = slug(anti);
      const current = antiMap.get(id) || { id, label: anti, reason: anti, severity: anti.includes("Не генерировать") ? "avoid" : "watch", evidence_count: 0, source_pattern_ids: [] };
      current.evidence_count += 1;
      if (!current.source_pattern_ids.includes(item.source_pattern_id)) current.source_pattern_ids.push(item.source_pattern_id);
      antiMap.set(id, current);
    }
  }

  const productTypes = Array.from(new Set(dna.map((item) => item.product_brain.product_type)));
  const audiences = Array.from(new Set(dna.map((item) => item.audience_brain.primary_audience)));

  return {
    generated_at: new Date().toISOString(),
    total_atoms: atomMap.size,
    total_dna: dna.length,
    atoms: Array.from(atomMap.values()).sort((a, b) => b.score - a.score || b.evidence_count - a.evidence_count),
    dna,
    combinations: dna.map((item) => ({
      id: `${item.id}:combo`,
      niche: item.niche,
      score: item.score,
      atoms: {
        hook: item.atoms.hook,
        camera: item.atoms.camera,
        audio: item.atoms.audio,
        cta: item.atoms.cta,
        product: item.atoms.product,
        audience: item.atoms.audience,
      },
      source_pattern_id: item.source_pattern_id,
    })),
    anti_patterns: Array.from(antiMap.values()).sort((a, b) => b.evidence_count - a.evidence_count),
    product_brain: productTypes.map((productType) => {
      const rowsForProduct = dna.filter((item) => item.product_brain.product_type === productType);
      return {
        product_type: productType,
        best_atoms: {
          hook: rowsForProduct.map((item) => item.atoms.hook).slice(0, 5),
          camera: rowsForProduct.map((item) => item.atoms.camera).slice(0, 5),
          broll: rowsForProduct.map((item) => item.atoms.broll).slice(0, 5),
          audio: rowsForProduct.map((item) => item.atoms.audio).slice(0, 5),
        },
        recommended_formats: Array.from(new Set(rowsForProduct.map((item) => item.atoms.structure))).slice(0, 5),
      };
    }),
    audience_brain: audiences.map((audience) => {
      const rowsForAudience = dna.filter((item) => item.audience_brain.primary_audience === audience);
      return {
        audience,
        best_atoms: {
          hook: rowsForAudience.map((item) => item.atoms.hook).slice(0, 5),
          emotion: rowsForAudience.map((item) => item.atoms.emotion).slice(0, 5),
          speech: rowsForAudience.map((item) => item.atoms.speech).slice(0, 5),
          cta: rowsForAudience.map((item) => item.atoms.cta).slice(0, 5),
        },
        tone_rules: Array.from(new Set(rowsForAudience.map((item) => item.audience_brain.tone))).slice(0, 5),
      };
    }),
    experiment_skeletons: dna.slice(0, 20).map((item) => ({
      id: `${item.id}:experiment`,
      niche: item.niche,
      source_pattern_id: item.source_pattern_id,
      control_dna_id: item.id,
      variants: item.experiment_axes,
    })),
  };
}

