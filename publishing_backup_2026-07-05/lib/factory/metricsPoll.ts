import { normalizeDistributionPlatform } from "./distribution";

export interface MetricsPollSource {
  recipe_id?: unknown;
  recipeId?: unknown;
  id?: unknown;
  publication_id?: unknown;
  external_post_id?: unknown;
  platform?: unknown;
  target_platform?: unknown;
  posted_at?: unknown;
  published_at?: unknown;
  views?: unknown;
  plays?: unknown;
  impressions?: unknown;
  watch_rate?: unknown;
  hook_rate?: unknown;
  hold_rate?: unknown;
  completion?: unknown;
  completion_rate?: unknown;
  ctr?: unknown;
  ctr_card?: unknown;
  saves?: unknown;
  engagement_count?: unknown;
  marketplace_orders?: unknown;
  revenue?: unknown;
  raw?: unknown;
  source?: unknown;
}

export interface NormalizedMetricsSnapshot {
  recipe_id: number;
  publication_id?: string;
  external_post_id?: string;
  platform: "tiktok" | "instagram" | "youtube" | "telegram" | "pinterest" | "wibes" | "vk_clips" | "vk" | "manual" | "unknown";
  views: number;
  watch_rate: number | null;
  hook_rate: number | null;
  hold_rate: number | null;
  completion: number | null;
  ctr: number | null;
  saves: number | null;
  posted_at: string;
  source: string;
  raw_metrics?: unknown;
  warnings: string[];
}

export interface MetricsPollSummary {
  total: number;
  ready: NormalizedMetricsSnapshot[];
  skipped: Array<{ index: number; reason: string }>;
  warnings: string[];
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function intMetric(value: unknown): number | null {
  const n = num(value);
  if (n == null) return null;
  return Math.max(0, Math.floor(n));
}

function rate(value: unknown): number | null {
  const n = num(value);
  if (n == null) return null;
  const fraction = n > 1 ? n / 100 : n;
  return Math.max(0, Math.min(1, fraction));
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : String(value ?? fallback).trim();
}

export function normalizeMetricsPlatform(value: unknown): NormalizedMetricsSnapshot["platform"] {
  const normalized = normalizeDistributionPlatform(value);
  if (normalized === "tiktok"
    || normalized === "instagram"
    || normalized === "youtube"
    || normalized === "telegram"
    || normalized === "pinterest"
    || normalized === "wibes"
    || normalized === "vk_clips"
    || normalized === "vk"
    || normalized === "manual") {
    return normalized;
  }
  return "unknown";
}

export function normalizeMetricsSnapshot(source: MetricsPollSource, index = 0): { snapshot: NormalizedMetricsSnapshot | null; reason?: string } {
  const recipeId = intMetric(source.recipe_id ?? source.recipeId ?? source.id);
  if (!recipeId) return { snapshot: null, reason: "missing_recipe_id" };

  const views = intMetric(source.views ?? source.plays ?? source.impressions);
  if (!views) return { snapshot: null, reason: "missing_views" };

  const hookRate = rate(source.hook_rate);
  const holdRate = rate(source.hold_rate);
  const completion = rate(source.completion ?? source.completion_rate);
  const watchRate = rate(source.watch_rate) ?? completion ?? holdRate ?? hookRate;
  const postedAt = text(source.posted_at || source.published_at) || new Date().toISOString();
  const warnings: string[] = [];
  if (!rate(source.watch_rate) && watchRate != null) warnings.push("watch_rate derived from available retention metric");

  return {
    snapshot: {
      recipe_id: recipeId,
      publication_id: text(source.publication_id) || undefined,
      external_post_id: text(source.external_post_id) || undefined,
      platform: normalizeMetricsPlatform(source.platform || source.target_platform),
      views,
      watch_rate: watchRate,
      hook_rate: hookRate,
      hold_rate: holdRate,
      completion,
      ctr: rate(source.ctr ?? source.ctr_card),
      saves: intMetric(source.saves),
      posted_at: postedAt,
      source: text(source.source, "metrics_poll") || "metrics_poll",
      raw_metrics: source.raw,
      warnings,
    },
  };
}

export function summarizeMetricsPoll(sources: MetricsPollSource[]): MetricsPollSummary {
  const ready: NormalizedMetricsSnapshot[] = [];
  const skipped: Array<{ index: number; reason: string }> = [];
  const warnings: string[] = [];

  sources.forEach((source, index) => {
    const normalized = normalizeMetricsSnapshot(source, index);
    if (normalized.snapshot) {
      ready.push(normalized.snapshot);
      warnings.push(...normalized.snapshot.warnings.map((warning) => `item ${index + 1}: ${warning}`));
    } else {
      skipped.push({ index, reason: normalized.reason || "invalid_metrics" });
    }
  });

  return { total: sources.length, ready, skipped, warnings };
}

export function metricsPostBody(snapshot: NormalizedMetricsSnapshot): Record<string, unknown> {
  return {
    recipe_id: snapshot.recipe_id,
    publication_id: snapshot.publication_id,
    external_post_id: snapshot.external_post_id,
    platform: snapshot.platform,
    views: snapshot.views,
    watch_rate: snapshot.watch_rate,
    hook_rate: snapshot.hook_rate,
    hold_rate: snapshot.hold_rate,
    completion: snapshot.completion,
    ctr: snapshot.ctr,
    saves: snapshot.saves,
    posted_at: snapshot.posted_at,
    source: snapshot.source,
    raw_metrics: snapshot.raw_metrics,
  };
}
