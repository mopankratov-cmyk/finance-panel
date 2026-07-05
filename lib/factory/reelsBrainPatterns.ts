import { inferPlatform, type ReelsPlatform } from "./reelsBrain";

export interface ReelsPatternSourceVideo {
  id?: number | string;
  url?: string | null;
  platform?: string | null;
  caption?: string | null;
  hook_text?: string | null;
  format_detected?: string | null;
  beat_structure?: unknown;
  viral_reason?: unknown;
  virality_score?: number | string | null;
  views?: number | string | null;
  sound_title?: string | null;
  analyzed_full?: unknown;
}

export interface ReelsPatternMemoryItem {
  pattern_id: string;
  hook_type: string;
  hook_label?: string;
  structure_type: string;
  structure_label?: string;
  retention_mechanism: string;
  retention_label?: string;
  emotion: string;
  emotion_label?: string;
  viral_logic: string;
  viral_logic_label?: string;
  frequency: number;
  strength_score: number;
  avg_views: number;
  examples: { id?: string | number; url?: string | null; hook?: string | null; score: number; views: number }[];
  hooks: string[];
  sounds: string[];
  quality_label: "generator_ready" | "needs_cleanup" | "noise";
  quality_score: number;
  relevance_score: number;
  quality_reasons: string[];
}

export interface ReelsAntiPatternItem {
  anti_pattern_id: string;
  label: string;
  trigger_reason: string;
  severity: "high" | "medium" | "low";
  affected_patterns: number;
  total_frequency: number;
  avg_quality_score: number;
  avg_relevance_score: number;
  examples: { pattern_id: string; hook?: string; url?: string | null; quality_score: number; frequency: number }[];
  action: string;
}

export interface ReelsPatternMemory {
  niche: string;
  platform: ReelsPlatform | "all";
  total_videos: number;
  analyzed_videos: number;
  patterns: ReelsPatternMemoryItem[];
  generator_ready_patterns: ReelsPatternMemoryItem[];
  anti_patterns: ReelsAntiPatternItem[];
  top_hooks: string[];
  quality_summary: {
    generator_ready: number;
    needs_cleanup: number;
    noise: number;
    avg_relevance_score: number;
  };
  generated_at: string;
}

export interface CrossPlatformPattern {
  pattern_id: string;
  hook_type: string;
  hook_label?: string;
  structure_type: string;
  structure_label?: string;
  retention_mechanism: string;
  retention_label?: string;
  emotion: string;
  emotion_label?: string;
  viral_logic: string;
  viral_logic_label?: string;
  platforms: ReelsPlatform[];
  platform_count: number;
  total_frequency: number;
  avg_strength_score: number;
}

export interface ReelsPatternRebuildContext {
  focus_platform?: string | null;
  source_discovery_mode?: string | null;
  execution_mode?: string | null;
  field_focus?: string | null;
  family_focus?: string | null;
  platform_biased?: boolean;
  exact_proof_biased?: boolean;
  brief_bundle_biased?: boolean;
  ship_ready_biased?: boolean;
  high_trust_generation_biased?: boolean;
  output_ready_biased?: boolean;
  requested_limit?: number;
  source_videos?: number;
  persisted_at?: string | null;
}

export interface ReelsPatternMemoryBundle extends ReelsPatternMemory {
  meta_brain: ReelsPatternMemory;
  platform_brains: Partial<Record<ReelsPlatform, ReelsPatternMemory>>;
  cross_platform_patterns: CrossPlatformPattern[];
  rebuild_context?: ReelsPatternRebuildContext;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function slugPart(value: string): string {
  return value.toLowerCase().replace(/[^a-zа-я0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "unknown";
}

const HOOK_LABELS: Record<string, string> = {
  unknown: "хук не распознан",
  curiosity_question: "вопрос-интрига",
  warning_pattern_break: "предупреждение / слом ожидания",
  list_promise: "обещание списка",
  before_after: "до/после",
  demo_review: "демо / обзор",
  curiosity_gap: "интрига с пробелом",
  direct_claim: "прямое заявление",
};

const STRUCTURE_LABELS: Record<string, string> = {
  unknown_structure: "структура не определена",
  unboxing: "распаковка",
  before_after: "до/после",
  review: "обзор",
  life_hack: "лайфхак",
  pov: "POV-сценка",
  demo: "демонстрация",
};

const RETENTION_LABELS: Record<string, string> = {
  proof_wait: "ожидание доказательства",
  curiosity_gap: "удержание интригой",
  delayed_payoff: "отложенная развязка",
  surprise_hold: "удержание удивлением",
  transformation_wait: "ожидание трансформации",
  open_loop: "открытая петля",
};

const EMOTION_LABELS: Record<string, string> = {
  fear: "страх ошибки",
  status: "статус / желание обладать",
  surprise: "удивление",
  relatable: "узнавание себя",
  curiosity: "любопытство",
  interest: "интерес",
};

function fallbackLabel(value: string): string {
  return value.replace(/_/g, " ").replace(/\s+/g, " ").trim() || "не распознано";
}

const NICHE_RELEVANCE_TERMS: Record<string, RegExp[]> = {
  toys: [/игруш/i, /кукл/i, /машинк/i, /лего/i, /lego/i, /конструктор/i, /плюш/i, /сквиш/i, /антистресс/i, /бластер/i, /пистолет/i, /детск/i, /реб[её]н/i, /kids?/i, /toy/i],
  clothing: [/одежд/i, /плать/i, /юбк/i, /шорт/i, /брюк/i, /джинс/i, /рубаш/i, /футбол/i, /худи/i, /куртк/i, /пальто/i, /образ/i, /лук/i, /гардероб/i, /сумк/i, /обув/i, /fashion/i, /outfit/i, /style/i],
  cosmetics: [/космет/i, /макияж/i, /крем/i, /сыворот/i, /туш/i, /помад/i, /тональ/i, /маск/i, /уход/i, /кож/i, /бьюти/i, /beauty/i, /makeup/i, /skincare/i, /lipstick/i],
};

const RUSSIAN_STOP_TOPIC_TERMS = [
  /qatar/i,
  /urban/i,
  /anime/i,
  /minecraft/i,
  /авто/i,
  /машин[аы]\b/i,
  /трактор/i,
  /агро/i,
  /поле/i,
  /кинотеатр/i,
  /фильм/i,
];

interface ReelsPatternBuildContext {
  playbook?: unknown;
}

function compactText(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ").toLowerCase().replace(/\s+/g, " ").trim();
}

function hasCyrillic(text: string): boolean {
  return /[а-яё]/i.test(text);
}

function customRelevanceTerms(playbook: unknown, niche: string): RegExp[] {
  const root = playbook && typeof playbook === "object" ? playbook as Record<string, unknown> : {};
  const taxonomy = root.reels_brain_taxonomy && typeof root.reels_brain_taxonomy === "object"
    ? root.reels_brain_taxonomy as Record<string, unknown>
    : {};
  const byNiche = taxonomy.relevance_terms_by_niche && typeof taxonomy.relevance_terms_by_niche === "object"
    ? taxonomy.relevance_terms_by_niche as Record<string, unknown>
    : {};
  const shared = Array.isArray(taxonomy.relevance_terms) ? taxonomy.relevance_terms : [];
  const nicheTerms = Array.isArray(byNiche[niche]) ? byNiche[niche] as unknown[] : [];
  return [...shared, ...nicheTerms]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .map((value) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
}

function relevanceTermsForNiche(niche: string, playbook?: unknown): RegExp[] {
  const dynamicTerms = customRelevanceTerms(playbook, niche);
  if (dynamicTerms.length) return dynamicTerms;
  const normalized = niche.toLowerCase();
  if (normalized.includes("toy") || normalized.includes("игруш")) return NICHE_RELEVANCE_TERMS.toys;
  if (normalized.includes("cloth") || normalized.includes("одеж")) return NICHE_RELEVANCE_TERMS.clothing;
  if (normalized.includes("cosmetic") || normalized.includes("beauty") || normalized.includes("космет")) return NICHE_RELEVANCE_TERMS.cosmetics;
  return [];
}

function rowRelevanceScore(niche: string, row: ReelsPatternSourceVideo, playbook?: unknown): number {
  const text = compactText(
    analysisField(row, "hook_text"),
    row.hook_text,
    row.caption,
    explicitStructureType(row),
    row.format_detected,
    row.sound_title,
    stringifyReason(row.viral_reason),
    stringifyReason(row.analyzed_full),
  );
  if (!text) return 0;

  let score = 0;
  if (hasCyrillic(text)) score += 35;
  const terms = relevanceTermsForNiche(niche, playbook);
  if (terms.some((term) => term.test(text))) score += 45;
  if (/распаков|обзор|тест|провер|до\/после|до и после|лайфхак|сравн|vs|топ|подборк|находк/i.test(text)) score += 15;
  if (RUSSIAN_STOP_TOPIC_TERMS.some((term) => term.test(text)) && !terms.some((term) => term.test(text))) score -= 25;
  if (text.length < 8) score -= 15;
  return Math.max(0, Math.min(100, score));
}

function patternQuality(
  niche: string,
  pattern: ReelsPatternMemoryItem,
  rowScores: number[],
  playbook?: unknown,
): Pick<ReelsPatternMemoryItem, "quality_label" | "quality_score" | "relevance_score" | "quality_reasons"> {
  const reasons: string[] = [];
  const avgRelevance = rowScores.length
    ? Math.round(rowScores.reduce((sum, score) => sum + score, 0) / rowScores.length)
    : 0;
  let qualityScore = avgRelevance;

  if (pattern.frequency >= 5) qualityScore += 18;
  else if (pattern.frequency >= 2) qualityScore += 8;
  else {
    qualityScore -= 25;
    reasons.push("singleton_pattern");
  }

  if (pattern.structure_type !== "unknown_structure") qualityScore += 14;
  else {
    qualityScore -= 12;
    reasons.push("unknown_structure");
  }

  if (pattern.hook_type !== "direct_claim" && pattern.hook_type !== "unknown") qualityScore += 8;
  if (avgRelevance < 45) reasons.push("low_niche_relevance");
  if (pattern.hooks.some((hook) => !hasCyrillic(hook))) reasons.push("mixed_or_non_ru_examples");
  if (!relevanceTermsForNiche(niche, playbook).length) reasons.push("unknown_niche_taxonomy");

  qualityScore = Math.max(0, Math.min(100, Math.round(qualityScore)));
  const quality_label = qualityScore >= 70 && pattern.frequency >= 2 && avgRelevance >= 55
    ? "generator_ready"
    : qualityScore < 45 || (pattern.frequency === 1 && pattern.structure_type === "unknown_structure")
      ? "noise"
      : "needs_cleanup";

  return {
    quality_label,
    quality_score: qualityScore,
    relevance_score: avgRelevance,
    quality_reasons: reasons,
  };
}

function antiPatternLabel(reason: string, pattern: ReelsPatternMemoryItem): { label: string; action: string; severity: ReelsAntiPatternItem["severity"] } {
  switch (reason) {
    case "low_niche_relevance":
      return {
        label: "Паттерн выглядит офферно слабым для ниши",
        action: "Не делать его базой для brief; сначала усилить niche fit или убрать из control-пула.",
        severity: "high",
      };
    case "singleton_pattern":
      return {
        label: "Случайный одиночный паттерн без повторяемости",
        action: "Не масштабировать, пока не появятся повторные подтверждения в корпусе.",
        severity: "medium",
      };
    case "unknown_structure":
      return {
        label: "Структура паттерна ещё сырая и нечитабельная",
        action: "Доразметить структуру через taxonomy или не использовать в generator-ready слое.",
        severity: "medium",
      };
    case "mixed_or_non_ru_examples":
      return {
        label: "Паттерн смешивает нерелевантные языковые или культурные примеры",
        action: "Брать только механику, но не использовать как прямой RU-template без адаптации.",
        severity: "medium",
      };
    case "unknown_niche_taxonomy":
      return {
        label: "Для ниши ещё не хватает taxonomy-словаря",
        action: "Сначала нарастить relevance terms и taxonomy evidence по этой нише.",
        severity: "low",
      };
    default:
      return {
        label: `Слабый паттерн: ${pattern.structure_label || pattern.structure_type || "неопределённый формат"}`,
        action: "Оставить только как экспериментальный reference и не поднимать в основной brief-layer.",
        severity: "low",
      };
  }
}

function buildAntiPatterns(patterns: ReelsPatternMemoryItem[]): ReelsAntiPatternItem[] {
  const grouped = new Map<string, ReelsAntiPatternItem>();
  for (const pattern of patterns) {
    if (pattern.quality_label === "generator_ready") continue;
    const reasons = pattern.quality_reasons.length ? pattern.quality_reasons : ["weak_pattern"];
    for (const reason of reasons) {
      const meta = antiPatternLabel(reason, pattern);
      const key = `${reason}:${pattern.structure_type || "unknown_structure"}`;
      const current = grouped.get(key) || {
        anti_pattern_id: slugPart(key),
        label: meta.label,
        trigger_reason: reason,
        severity: meta.severity,
        affected_patterns: 0,
        total_frequency: 0,
        avg_quality_score: 0,
        avg_relevance_score: 0,
        examples: [],
        action: meta.action,
      };
      current.affected_patterns += 1;
      current.total_frequency += pattern.frequency;
      current.avg_quality_score += pattern.quality_score;
      current.avg_relevance_score += pattern.relevance_score;
      if (current.examples.length < 4) {
        current.examples.push({
          pattern_id: pattern.pattern_id,
          hook: pattern.hooks[0] || pattern.hook_label || pattern.hook_type,
          url: pattern.examples[0]?.url || null,
          quality_score: pattern.quality_score,
          frequency: pattern.frequency,
        });
      }
      if (meta.severity === "high" || (meta.severity === "medium" && current.severity === "low")) {
        current.severity = meta.severity;
      }
      grouped.set(key, current);
    }
  }

  return Array.from(grouped.values())
    .map((item) => ({
      ...item,
      avg_quality_score: Math.round(item.avg_quality_score / Math.max(1, item.affected_patterns)),
      avg_relevance_score: Math.round(item.avg_relevance_score / Math.max(1, item.affected_patterns)),
    }))
    .sort((a, b) =>
      (a.severity === "high" ? 3 : a.severity === "medium" ? 2 : 1) < (b.severity === "high" ? 3 : b.severity === "medium" ? 2 : 1) ? 1 : -1
      || b.total_frequency - a.total_frequency
      || a.avg_quality_score - b.avg_quality_score
    )
    .slice(0, 12);
}

export function labelReelsHookType(value?: string | null): string {
  const key = String(value || "unknown");
  return HOOK_LABELS[key] || fallbackLabel(key);
}

export function labelReelsStructureType(value?: string | null): string {
  const key = String(value || "unknown_structure");
  return STRUCTURE_LABELS[key] || fallbackLabel(key);
}

export function labelReelsRetentionMechanism(value?: string | null): string {
  const key = String(value || "open_loop");
  return RETENTION_LABELS[key] || fallbackLabel(key);
}

export function labelReelsEmotion(value?: string | null): string {
  const key = String(value || "interest");
  return EMOTION_LABELS[key] || fallbackLabel(key);
}

export function buildRussianViralLogicLabel(hookType: string, structureType: string, retention: string, beats = 0): string {
  return `${labelReelsHookType(hookType)} -> ${labelReelsStructureType(structureType)} -> ${labelReelsRetentionMechanism(retention)}${beats ? ` (${beats} битов)` : ""}`;
}

export function inferHookType(text?: string | null): string {
  const s = (text || "").toLowerCase();
  if (!s) return "unknown";
  if (/[?？]/.test(s) || /\bкак\b|\bпочему\b|\bзачем\b/.test(s)) return "curiosity_question";
  if (/не покупай|ошибка|никогда|пока не|стоп|опасн/.test(s)) return "warning_pattern_break";
  if (/\d+|топ-|топ\s|[0-9]\s?(причин|способ|лайфхак)/.test(s)) return "list_promise";
  if (/до\/после|до и после|before|after|преображ/.test(s)) return "before_after";
  if (/распаков|обзор|тест|провер|смотри|смотрите/.test(s)) return "demo_review";
  if (/секрет|узнал|наш[её]л|неожидан/.test(s)) return "curiosity_gap";
  return "direct_claim";
}

export function inferStructureType(format?: string | null, caption?: string | null): string {
  const f = (format || "").toLowerCase().trim();
  if (f) return f.replace(/\s+/g, "_").slice(0, 60);
  const c = (caption || "").toLowerCase();
  if (/распаков|unboxing/.test(c)) return "unboxing";
  if (/до\/после|до и после|before|after/.test(c)) return "before_after";
  if (/отзыв|review|обзор/.test(c)) return "review";
  if (/лайфхак|lifehack|hack/.test(c)) return "life_hack";
  if (/pov|пов/.test(c)) return "pov";
  return "unknown_structure";
}

function stringifyReason(reason: unknown): string {
  if (!reason) return "";
  if (typeof reason === "string") return reason;
  try { return JSON.stringify(reason); } catch { return ""; }
}

function inferRetention(format: string, reason: unknown): string {
  const r = stringifyReason(reason).toLowerCase();
  if (/proof|доказ|test|тест|demo|демо/.test(r)) return "proof_wait";
  if (/curiosity|интриг|gap|ожидан/.test(r)) return "curiosity_gap";
  if (/payoff|финал|развяз/.test(r)) return "delayed_payoff";
  if (/shock|surprise|удив/.test(r)) return "surprise_hold";
  if (/before_after/.test(format)) return "transformation_wait";
  if (/unboxing|review|demo/.test(format)) return "proof_wait";
  return "open_loop";
}

function inferEmotion(hookType: string, reason: unknown): string {
  const r = stringifyReason(reason).toLowerCase();
  if (/fear|страх|опас|warning/.test(r) || hookType.includes("warning")) return "fear";
  if (/status|flex|дорог|богат/.test(r)) return "status";
  if (/surprise|shock|удив/.test(r)) return "surprise";
  if (/relatable|узнаваем|боль/.test(r)) return "relatable";
  if (hookType.includes("curiosity")) return "curiosity";
  return "interest";
}

function beatCount(beatStructure: unknown): number {
  if (Array.isArray(beatStructure)) return beatStructure.length;
  if (beatStructure && typeof beatStructure === "object") {
    const beats = (beatStructure as Record<string, unknown>).beats;
    if (Array.isArray(beats)) return beats.length;
  }
  return 0;
}

function analysisField(row: ReelsPatternSourceVideo, key: string): string | null {
  const root = row.analyzed_full && typeof row.analyzed_full === "object" ? row.analyzed_full as Record<string, unknown> : {};
  const direct = root[key];
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const nested = root.analysis && typeof root.analysis === "object" ? (root.analysis as Record<string, unknown>)[key] : null;
  return typeof nested === "string" && nested.trim() ? nested.trim() : null;
}

function explicitHookType(row: ReelsPatternSourceVideo): string | null {
  return analysisField(row, "hook_type_v2")
    || analysisField(row, "hook_type")
    || analysisField(row, "hook_category");
}

function explicitStructureType(row: ReelsPatternSourceVideo): string | null {
  return analysisField(row, "structure_v2")
    || analysisField(row, "structure_type")
    || analysisField(row, "format_detected");
}

function buildScopedPatternMemory(
  niche: string,
  platform: ReelsPlatform | "all",
  rows: ReelsPatternSourceVideo[],
  now: Date,
  playbook?: unknown,
): ReelsPatternMemory {
  const groups = new Map<string, ReelsPatternMemoryItem>();
  const groupRelevance = new Map<string, number[]>();
  const analyzedRows = rows.filter((r) => r.hook_text || r.format_detected || r.beat_structure || r.viral_reason || r.analyzed_full);

  for (const row of rows) {
    const hook = row.hook_text || row.caption || "";
    const hookType = explicitHookType(row) || inferHookType(hook);
    const structureType = inferStructureType(explicitStructureType(row) || row.format_detected, row.caption);
    const retention = inferRetention(structureType, row.viral_reason);
    const emotion = inferEmotion(hookType, row.viral_reason);
    const beats = beatCount(row.beat_structure);
    const key = `${hookType}:${structureType}:${retention}:${emotion}`;
    const score = num(row.virality_score);
    const views = num(row.views);
    const relevanceScore = rowRelevanceScore(niche, row, playbook);
    const viralLogic = `${hookType} -> ${structureType} -> ${retention}${beats ? ` (${beats} beats)` : ""}`;
    const viralLogicLabel = buildRussianViralLogicLabel(hookType, structureType, retention, beats);
    const existing = groups.get(key);
    const item = existing || {
      pattern_id: slugPart(key),
      hook_type: hookType,
      hook_label: labelReelsHookType(hookType),
      structure_type: structureType,
      structure_label: labelReelsStructureType(structureType),
      retention_mechanism: retention,
      retention_label: labelReelsRetentionMechanism(retention),
      emotion,
      emotion_label: labelReelsEmotion(emotion),
      viral_logic: viralLogic,
      viral_logic_label: viralLogicLabel,
      frequency: 0,
      strength_score: 0,
      avg_views: 0,
      examples: [],
      hooks: [],
      sounds: [],
      quality_label: "needs_cleanup",
      quality_score: 0,
      relevance_score: 0,
      quality_reasons: [],
    };

    item.frequency += 1;
    item.strength_score += score;
    item.avg_views += views;
    if (hook && item.hooks.length < 8 && !item.hooks.includes(hook.slice(0, 180))) item.hooks.push(hook.slice(0, 180));
    if (row.sound_title && item.sounds.length < 6 && !item.sounds.includes(row.sound_title)) item.sounds.push(row.sound_title);
    item.examples.push({ id: row.id, url: row.url, hook: row.hook_text || null, score, views });
    item.examples.sort((a, b) => b.score - a.score || b.views - a.views);
    item.examples = item.examples.slice(0, 5);
    groups.set(key, item);
    const scores = groupRelevance.get(key) || [];
    scores.push(relevanceScore);
    groupRelevance.set(key, scores);
  }

  const patterns = Array.from(groups.values())
    .map((p) => {
      const scored = {
        ...p,
        strength_score: Math.round(((p.strength_score / Math.max(1, p.frequency)) + Math.log(p.frequency + 1) * 3) * 10) / 10,
        avg_views: Math.round(p.avg_views / Math.max(1, p.frequency)),
      };
      return {
        ...scored,
        ...patternQuality(niche, scored, groupRelevance.get(`${p.hook_type}:${p.structure_type}:${p.retention_mechanism}:${p.emotion}`) || [], playbook),
      };
    })
    .sort((a, b) => b.strength_score - a.strength_score || b.frequency - a.frequency);
  const generatorReadyPatterns = patterns.filter((pattern) => pattern.quality_label === "generator_ready");
  const qualitySummary = patterns.reduce((acc, pattern) => {
    acc[pattern.quality_label] += 1;
    acc.avg_relevance_score += pattern.relevance_score;
    return acc;
  }, { generator_ready: 0, needs_cleanup: 0, noise: 0, avg_relevance_score: 0 });
  qualitySummary.avg_relevance_score = patterns.length
    ? Math.round(qualitySummary.avg_relevance_score / patterns.length)
    : 0;

  return {
    niche: niche || "default",
    platform,
    total_videos: rows.length,
    analyzed_videos: analyzedRows.length,
    patterns,
    generator_ready_patterns: generatorReadyPatterns,
    anti_patterns: buildAntiPatterns(patterns),
    top_hooks: (generatorReadyPatterns.length ? generatorReadyPatterns : patterns).flatMap((p) => p.hooks.slice(0, 2)).slice(0, 20),
    quality_summary: qualitySummary,
    generated_at: now.toISOString(),
  };
}

function rowPlatform(row: ReelsPatternSourceVideo): ReelsPlatform {
  const platform = inferPlatform(row.platform || row.url || "");
  return platform === "unknown" ? "unknown" : platform;
}

function buildCrossPlatformPatterns(platformBrains: Partial<Record<ReelsPlatform, ReelsPatternMemory>>): CrossPlatformPattern[] {
  const grouped = new Map<string, CrossPlatformPattern>();

  for (const [platformKey, memory] of Object.entries(platformBrains) as [ReelsPlatform, ReelsPatternMemory][]) {
    for (const pattern of (memory.generator_ready_patterns.length ? memory.generator_ready_patterns : memory.patterns)) {
      const existing = grouped.get(pattern.pattern_id);
      if (existing) {
        if (!existing.platforms.includes(platformKey)) existing.platforms.push(platformKey);
        existing.platform_count = existing.platforms.length;
        existing.total_frequency += pattern.frequency;
        existing.avg_strength_score += pattern.strength_score;
        continue;
      }
      grouped.set(pattern.pattern_id, {
        pattern_id: pattern.pattern_id,
        hook_type: pattern.hook_type,
        hook_label: pattern.hook_label || labelReelsHookType(pattern.hook_type),
        structure_type: pattern.structure_type,
        structure_label: pattern.structure_label || labelReelsStructureType(pattern.structure_type),
        retention_mechanism: pattern.retention_mechanism,
        retention_label: pattern.retention_label || labelReelsRetentionMechanism(pattern.retention_mechanism),
        emotion: pattern.emotion,
        emotion_label: pattern.emotion_label || labelReelsEmotion(pattern.emotion),
        viral_logic: pattern.viral_logic,
        viral_logic_label: pattern.viral_logic_label || buildRussianViralLogicLabel(pattern.hook_type, pattern.structure_type, pattern.retention_mechanism),
        platforms: [platformKey],
        platform_count: 1,
        total_frequency: pattern.frequency,
        avg_strength_score: pattern.strength_score,
      });
    }
  }

  return Array.from(grouped.values())
    .filter((pattern) => pattern.platform_count >= 2)
    .map((pattern) => ({
      ...pattern,
      platforms: pattern.platforms.sort(),
      avg_strength_score: Math.round(pattern.avg_strength_score / pattern.platform_count * 10) / 10,
    }))
    .sort((a, b) =>
      b.platform_count - a.platform_count
      || b.avg_strength_score - a.avg_strength_score
      || b.total_frequency - a.total_frequency
    )
    .slice(0, 30);
}

export function buildReelsPatternMemory(niche: string, rows: ReelsPatternSourceVideo[], now = new Date(), context: ReelsPatternBuildContext = {}): ReelsPatternMemoryBundle {
  const metaBrain = buildScopedPatternMemory(niche, "all", rows, now, context.playbook);
  const byPlatformRows = new Map<ReelsPlatform, ReelsPatternSourceVideo[]>();

  for (const row of rows) {
    const platform = rowPlatform(row);
    if (platform === "unknown") continue;
    const group = byPlatformRows.get(platform) || [];
    group.push(row);
    byPlatformRows.set(platform, group);
  }

  const platformBrains = Object.fromEntries(
    Array.from(byPlatformRows.entries()).map(([platform, platformRows]) => [
      platform,
      buildScopedPatternMemory(niche, platform, platformRows, now, context.playbook),
    ]),
  ) as Partial<Record<ReelsPlatform, ReelsPatternMemory>>;

  return {
    ...metaBrain,
    meta_brain: metaBrain,
    platform_brains: platformBrains,
    cross_platform_patterns: buildCrossPlatformPatterns(platformBrains),
  };
}
