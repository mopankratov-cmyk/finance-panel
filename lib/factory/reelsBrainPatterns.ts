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
}

export interface ReelsPatternMemoryItem {
  pattern_id: string;
  hook_type: string;
  structure_type: string;
  retention_mechanism: string;
  emotion: string;
  viral_logic: string;
  frequency: number;
  strength_score: number;
  avg_views: number;
  examples: { id?: string | number; url?: string | null; hook?: string | null; score: number; views: number }[];
  hooks: string[];
  sounds: string[];
}

export interface ReelsPatternMemory {
  niche: string;
  platform: ReelsPlatform | "all";
  total_videos: number;
  analyzed_videos: number;
  patterns: ReelsPatternMemoryItem[];
  top_hooks: string[];
  generated_at: string;
}

export interface CrossPlatformPattern {
  pattern_id: string;
  hook_type: string;
  structure_type: string;
  retention_mechanism: string;
  emotion: string;
  viral_logic: string;
  platforms: ReelsPlatform[];
  platform_count: number;
  total_frequency: number;
  avg_strength_score: number;
}

export interface ReelsPatternMemoryBundle extends ReelsPatternMemory {
  meta_brain: ReelsPatternMemory;
  platform_brains: Partial<Record<ReelsPlatform, ReelsPatternMemory>>;
  cross_platform_patterns: CrossPlatformPattern[];
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function slugPart(value: string): string {
  return value.toLowerCase().replace(/[^a-zа-я0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "unknown";
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

function normalizeFormat(format?: string | null, caption?: string | null): string {
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

function buildScopedPatternMemory(
  niche: string,
  platform: ReelsPlatform | "all",
  rows: ReelsPatternSourceVideo[],
  now: Date,
): ReelsPatternMemory {
  const groups = new Map<string, ReelsPatternMemoryItem>();
  const analyzedRows = rows.filter((r) => r.hook_text || r.format_detected || r.beat_structure || r.viral_reason);

  for (const row of rows) {
    const hook = row.hook_text || row.caption || "";
    const hookType = inferHookType(hook);
    const structureType = normalizeFormat(row.format_detected, row.caption);
    const retention = inferRetention(structureType, row.viral_reason);
    const emotion = inferEmotion(hookType, row.viral_reason);
    const beats = beatCount(row.beat_structure);
    const key = `${hookType}:${structureType}:${retention}:${emotion}`;
    const score = num(row.virality_score);
    const views = num(row.views);
    const viralLogic = `${hookType} -> ${structureType} -> ${retention}${beats ? ` (${beats} beats)` : ""}`;
    const existing = groups.get(key);
    const item = existing || {
      pattern_id: slugPart(key),
      hook_type: hookType,
      structure_type: structureType,
      retention_mechanism: retention,
      emotion,
      viral_logic: viralLogic,
      frequency: 0,
      strength_score: 0,
      avg_views: 0,
      examples: [],
      hooks: [],
      sounds: [],
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
  }

  const patterns = Array.from(groups.values())
    .map((p) => ({
      ...p,
      strength_score: Math.round(((p.strength_score / Math.max(1, p.frequency)) + Math.log(p.frequency + 1) * 3) * 10) / 10,
      avg_views: Math.round(p.avg_views / Math.max(1, p.frequency)),
    }))
    .sort((a, b) => b.strength_score - a.strength_score || b.frequency - a.frequency);

  return {
    niche: niche || "default",
    platform,
    total_videos: rows.length,
    analyzed_videos: analyzedRows.length,
    patterns,
    top_hooks: patterns.flatMap((p) => p.hooks.slice(0, 2)).slice(0, 20),
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
    for (const pattern of memory.patterns) {
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
        structure_type: pattern.structure_type,
        retention_mechanism: pattern.retention_mechanism,
        emotion: pattern.emotion,
        viral_logic: pattern.viral_logic,
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

export function buildReelsPatternMemory(niche: string, rows: ReelsPatternSourceVideo[], now = new Date()): ReelsPatternMemoryBundle {
  const metaBrain = buildScopedPatternMemory(niche, "all", rows, now);
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
      buildScopedPatternMemory(niche, platform, platformRows, now),
    ]),
  ) as Partial<Record<ReelsPlatform, ReelsPatternMemory>>;

  return {
    ...metaBrain,
    meta_brain: metaBrain,
    platform_brains: platformBrains,
    cross_platform_patterns: buildCrossPlatformPatterns(platformBrains),
  };
}
