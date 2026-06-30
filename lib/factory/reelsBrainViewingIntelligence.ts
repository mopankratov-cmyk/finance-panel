import { isRelevantToQuery } from "./reelsBrainSources";
import { normalizeShortPlatform } from "./reelsBrainPlaybook";

export type ReelsViewingAction = "resolve_mp4" | "analyze_media" | "build_brief" | "metadata_watch" | "skip";

export type ReelsViewingSourceRow = {
  id?: number | null;
  url?: string | null;
  platform?: string | null;
  niche?: string | null;
  caption?: string | null;
  hook_text?: string | null;
  format_detected?: string | null;
  sound_title?: string | null;
  source_orbit_id?: string | null;
  views?: number | string | null;
  likes?: number | string | null;
  followers_creator?: number | string | null;
  virality_score?: number | string | null;
  created_at?: string | null;
  analyzed?: boolean | null;
  analyzed_full?: unknown;
};

export type ReelsCreativeDna = {
  hook: string;
  emotion: string;
  camera: string;
  speech: string;
  broll: string;
  editing: string;
  cta: string;
};

export type ReelsCreativeBriefDraft = {
  hook: string;
  retention_mechanic: string;
  second_by_second_structure: string[];
  visual_recipe: string[];
  best_for: string[];
  copy_mechanic: string[];
  do_not_copy: string[];
};

export type ReelsViewingCandidate = {
  video_id: number | null;
  url: string | null;
  platform: string;
  niche: string;
  views: number;
  followers: number;
  score: number;
  priority: "high" | "medium" | "low";
  next_action: ReelsViewingAction;
  scores: {
    relevance: number;
    breakout: number;
    small_account: number;
    source_quality: number;
    creative_dna: number;
    anti_pattern_safety: number;
    niche_fit: number;
    freshness: number;
  };
  creative_dna: ReelsCreativeDna;
  anti_patterns: string[];
  reasons: string[];
  creative_brief: ReelsCreativeBriefDraft;
};

export type ReelsViewingIntelligenceReport = {
  ok: true;
  mode: "reels_brain_viewing_intelligence";
  summary: {
    total: number;
    high_priority: number;
    medium_priority: number;
    low_priority: number;
    resolve_mp4: number;
    analyze_media: number;
    build_brief: number;
    metadata_watch: number;
    skip: number;
    avg_score: number;
    by_niche: Record<string, { total: number; high_priority: number; avg_score: number }>;
    by_platform: Record<string, { total: number; high_priority: number; avg_score: number }>;
  };
  top_candidates: ReelsViewingCandidate[];
  source_quality: {
    best_sources: Array<{ source: string; total: number; avg_score: number; high_priority: number }>;
    weak_sources: Array<{ source: string; total: number; avg_score: number; high_priority: number }>;
  };
  operating_rules: string[];
};

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function clean(value: unknown, max = 220): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function text(row: ReelsViewingSourceRow): string {
  return [
    row.caption,
    row.hook_text,
    row.sound_title,
    clean(rec(row.analyzed_full).hook, 160),
    clean(rec(row.analyzed_full).summary, 220),
  ].filter(Boolean).join(" ").toLowerCase();
}

function hasDirectMediaAsset(value: unknown): boolean {
  const root = rec(value);
  const media = rec(root.media_assets);
  const assets = Array.isArray(root.assets) ? root.assets : Array.isArray(media.assets) ? media.assets : [];
  return assets.some((asset) => /\.(mp4|mov|m4v|webm|mp3|wav|m4a|aac)(\?|#|$)/i.test(clean(rec(asset).url, 700)));
}

function ageDays(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (Date.now() - t) / 86_400_000);
}

function nicheTerms(niche: string): string[] {
  const key = niche.toLowerCase();
  if (key.includes("toy")) return ["игруш", "детск", "ребен", "подар", "развива", "малыш", "маркетплейс"];
  if (key.includes("cloth")) return ["одеж", "плать", "костюм", "примерк", "образ", "лук", "размер"];
  if (key.includes("cosmetic")) return ["космет", "крем", "тон", "макияж", "кожа", "уход", "бьюти"];
  return [niche.replace(/^ru_/, "").replace(/_/g, " ")].filter(Boolean);
}

function relevanceScore(row: ReelsViewingSourceRow): number {
  const niche = clean(row.niche || "default", 80);
  const body = text(row);
  const termHits = nicheTerms(niche).filter((term) => body.includes(term)).length;
  const queryRelevant = isRelevantToQuery(niche, {
    url: row.url || undefined,
    platform: row.platform || undefined,
    caption: row.caption || undefined,
    sound_title: row.sound_title || undefined,
  });
  const ruSignal = /[а-яё]/i.test(body) ? 20 : 0;
  return clamp((queryRelevant ? 35 : 10) + Math.min(35, termHits * 12) + ruSignal + Math.min(10, num(row.virality_score) / 6));
}

function breakoutScore(row: ReelsViewingSourceRow): number {
  const views = Math.max(0, num(row.views));
  const followers = Math.max(0, num(row.followers_creator));
  const viral = Math.max(0, num(row.virality_score));
  const ratio = followers > 0 ? views / Math.max(500, followers) : 0;
  return clamp(Math.log10(ratio + 1) * 38 + Math.min(30, viral / 2));
}

function smallAccountScore(row: ReelsViewingSourceRow): number {
  const followers = Math.max(0, num(row.followers_creator));
  if (!followers) return 20;
  if (followers > 100_000) return 0;
  return clamp(100 - (followers / 100_000) * 70);
}

function freshnessScore(row: ReelsViewingSourceRow): number {
  const days = ageDays(row.created_at);
  if (days == null) return 35;
  if (days <= 3) return 100;
  if (days <= 14) return 80;
  if (days <= 45) return 55;
  return 25;
}

function inferCreativeDna(row: ReelsViewingSourceRow): ReelsCreativeDna {
  const body = text(row);
  const hook = clean(row.hook_text || rec(row.analyzed_full).hook || row.caption || "unknown_hook", 120);
  const emotion = /шок|не ожид|вау|удив|ошиб|секрет|провал/i.test(body) ? "surprise"
    : /мил|уют|красив|любим|дет/i.test(body) ? "warmth"
      : /выгод|дешев|скид|цена/i.test(body) ? "deal"
        : "curiosity";
  const camera = /pov|от первого|рук|распаков|unbox/i.test(body) ? "pov_hands"
    : /примерк|на себе|лицо|говор/i.test(body) ? "talking_or_tryon"
      : /до после|before/i.test(body) ? "before_after"
        : "product_closeup";
  const speech = /говор|сказ|обзор|расскаж|voice/i.test(body) ? "voice_explainer" : "caption_led";
  const broll = /распаков|детал|сравн|тест|примерк/i.test(body) ? "demo_broll" : "simple_product_broll";
  const editing = /быстр|нарез|тренд|мем|переход/i.test(body) ? "fast_cuts" : "clean_demo";
  const cta = /куп|заказ|ссылка|маркет|wb|ozon|артикул/i.test(body) ? "shop_cta" : "soft_interest";
  return { hook, emotion, camera, speech, broll, editing, cta };
}

function antiPatterns(row: ReelsViewingSourceRow): string[] {
  const body = text(row);
  const out: string[] = [];
  if (clean(row.caption).length < 12 && !clean(row.hook_text)) out.push("weak_text_signal");
  if (/подпишись|ставь лайк|привет ребята/i.test(body)) out.push("generic_intro_or_cta");
  if (/искусственн|ai face|нейросет/i.test(body)) out.push("possible_ai_slop");
  if (num(row.views) <= 0) out.push("missing_views");
  if (num(row.virality_score) < 10) out.push("low_virality_score");
  return out;
}

function creativeDnaCompleteness(dna: ReelsCreativeDna): number {
  return Object.values(dna).filter((value) => value && !String(value).startsWith("unknown")).length / 7 * 100;
}

function briefFor(row: ReelsViewingSourceRow, dna: ReelsCreativeDna, anti: string[]): ReelsCreativeBriefDraft {
  const niche = clean(row.niche || "default", 80);
  return {
    hook: dna.hook,
    retention_mechanic: dna.emotion === "surprise" ? "Start with a broken expectation, then reveal the product proof fast." : "Show the product outcome first, then explain why it works.",
    second_by_second_structure: [
      "0.0-1.0: show hook text and strongest visual proof",
      "1.0-3.0: show product interaction or before/after contrast",
      "3.0-6.0: add one concrete reason to believe",
      "6.0-9.0: repeat result, objection, or mini payoff",
      "9.0-12.0: soft CTA or saved-for-later reason",
    ],
    visual_recipe: [dna.camera, dna.broll, dna.editing].filter(Boolean),
    best_for: [niche, dna.emotion, dna.cta].filter(Boolean),
    copy_mechanic: ["opening tension", "timing structure", "proof order", "camera logic"],
    do_not_copy: ["exact footage", "creator face/voice", "music file", "brand marks", ...anti],
  };
}

function sourceName(row: ReelsViewingSourceRow): string {
  return clean(row.source_orbit_id || `${normalizeShortPlatform(row.platform || "unknown")}:${row.niche || "default"}`, 180);
}

export function scoreViewingCandidate(row: ReelsViewingSourceRow): ReelsViewingCandidate {
  const dna = inferCreativeDna(row);
  const anti = antiPatterns(row);
  const scores = {
    relevance: Math.round(relevanceScore(row)),
    breakout: Math.round(breakoutScore(row)),
    small_account: Math.round(smallAccountScore(row)),
    source_quality: Math.round(clamp(num(row.virality_score) * 1.6 + (row.analyzed ? 15 : 0))),
    creative_dna: Math.round(creativeDnaCompleteness(dna)),
    anti_pattern_safety: Math.round(clamp(100 - anti.length * 18)),
    niche_fit: Math.round(relevanceScore(row)),
    freshness: Math.round(freshnessScore(row)),
  };
  const score = Math.round((
    scores.relevance * 0.18
    + scores.breakout * 0.18
    + scores.small_account * 0.12
    + scores.source_quality * 0.12
    + scores.creative_dna * 0.12
    + scores.anti_pattern_safety * 0.1
    + scores.niche_fit * 0.1
    + scores.freshness * 0.08
  ) * 10) / 10;
  const hasAsset = hasDirectMediaAsset(row.analyzed_full);
  const priority = score >= 70 ? "high" : score >= 45 ? "medium" : "low";
  const next_action: ReelsViewingAction = hasAsset && row.analyzed
    ? "build_brief"
    : hasAsset
      ? "analyze_media"
      : priority === "high" || priority === "medium"
        ? "resolve_mp4"
        : anti.length >= 3
          ? "skip"
          : "metadata_watch";
  const reasons: string[] = [];
  if (scores.relevance >= 65) reasons.push("relevant_to_niche");
  if (scores.breakout >= 55) reasons.push("breakout_signal");
  if (scores.small_account >= 60) reasons.push("small_account_breakout");
  if (scores.freshness >= 80) reasons.push("fresh_candidate");
  if (hasAsset) reasons.push("media_asset_ready");
  if (anti.length) reasons.push("anti_patterns_detected");

  return {
    video_id: row.id == null ? null : Number(row.id),
    url: row.url || null,
    platform: normalizeShortPlatform(row.platform || "unknown"),
    niche: clean(row.niche || "default", 80) || "default",
    views: Math.max(0, num(row.views)),
    followers: Math.max(0, num(row.followers_creator)),
    score,
    priority,
    next_action,
    scores,
    creative_dna: dna,
    anti_patterns: anti,
    reasons,
    creative_brief: briefFor(row, dna, anti),
  };
}

export function buildViewingIntelligenceReport(rows: ReelsViewingSourceRow[]): ReelsViewingIntelligenceReport {
  const candidates = rows
    .map(scoreViewingCandidate)
    .sort((a, b) => b.score - a.score || b.views - a.views)
    .slice(0, 500);
  const summary = {
    total: candidates.length,
    high_priority: candidates.filter((row) => row.priority === "high").length,
    medium_priority: candidates.filter((row) => row.priority === "medium").length,
    low_priority: candidates.filter((row) => row.priority === "low").length,
    resolve_mp4: candidates.filter((row) => row.next_action === "resolve_mp4").length,
    analyze_media: candidates.filter((row) => row.next_action === "analyze_media").length,
    build_brief: candidates.filter((row) => row.next_action === "build_brief").length,
    metadata_watch: candidates.filter((row) => row.next_action === "metadata_watch").length,
    skip: candidates.filter((row) => row.next_action === "skip").length,
    avg_score: candidates.length ? Math.round(candidates.reduce((sum, row) => sum + row.score, 0) / candidates.length * 10) / 10 : 0,
    by_niche: {} as Record<string, { total: number; high_priority: number; avg_score: number }>,
    by_platform: {} as Record<string, { total: number; high_priority: number; avg_score: number }>,
  };
  for (const row of candidates) {
    for (const [bucket, key] of [[summary.by_niche, row.niche], [summary.by_platform, row.platform]] as const) {
      const current = bucket[key] || { total: 0, high_priority: 0, avg_score: 0 };
      current.total += 1;
      current.high_priority += row.priority === "high" ? 1 : 0;
      current.avg_score += row.score;
      bucket[key] = current;
    }
  }
  for (const bucket of [summary.by_niche, summary.by_platform]) {
    for (const row of Object.values(bucket)) row.avg_score = row.total ? Math.round(row.avg_score / row.total * 10) / 10 : 0;
  }

  const sourceMap = new Map<string, { total: number; score: number; high_priority: number }>();
  for (const row of rows) {
    const scored = scoreViewingCandidate(row);
    const source = sourceName(row);
    const current = sourceMap.get(source) || { total: 0, score: 0, high_priority: 0 };
    current.total += 1;
    current.score += scored.score;
    current.high_priority += scored.priority === "high" ? 1 : 0;
    sourceMap.set(source, current);
  }
  const sources = Array.from(sourceMap.entries()).map(([source, row]) => ({
    source,
    total: row.total,
    avg_score: row.total ? Math.round(row.score / row.total * 10) / 10 : 0,
    high_priority: row.high_priority,
  }));

  return {
    ok: true,
    mode: "reels_brain_viewing_intelligence",
    summary,
    top_candidates: candidates.slice(0, 50),
    source_quality: {
      best_sources: sources.filter((row) => row.total >= 2).sort((a, b) => b.avg_score - a.avg_score || b.high_priority - a.high_priority).slice(0, 20),
      weak_sources: sources.filter((row) => row.total >= 2).sort((a, b) => a.avg_score - b.avg_score || a.high_priority - b.high_priority).slice(0, 20),
    },
    operating_rules: [
      "Resolve mp4 only for high and medium priority candidates.",
      "Prefer small-account breakout candidates before generic viral videos.",
      "Promote sources with high average score and pause repeated weak sources.",
      "Store creative DNA and brief fields; do not store every mp4 permanently.",
      "Use anti-patterns as negative examples for the brain.",
    ],
  };
}
