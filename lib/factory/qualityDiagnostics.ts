import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalNiche } from "./rubric";
import { normalizeWarningReason } from "./observability";
import { loadSourceReadiness, type SourceReadinessTier } from "./sourceReadiness";

type Row = Record<string, unknown>;

export interface FactoryQualityDiagnostics {
  window_hours: number;
  since: string;
  totals: {
    recipes: number;
    produced_videos: number;
    otk_pass: number;
    run_fail: number;
    no_score: number;
    text_or_fallback_judged: number;
  };
  status_counts: Record<string, number>;
  warning_counts: Array<{ reason: string; count: number }>;
  otk_basis_counts: Record<string, number>;
  artifact_defects: Array<{ defect: string; count: number }>;
  memory_counts: Record<"winner" | "usable" | "trash" | "unlabeled", number>;
  source_tiers: Record<SourceReadinessTier, number>;
  by_niche: Array<{
    niche: string;
    produced_videos: number;
    otk_pass: number;
    run_fail: number;
    top_warning: string | null;
  }>;
  blockers: string[];
  next_actions: string[];
}

function text(value: unknown, max = 120): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function inc(map: Record<string, number>, key: string, by = 1): void {
  const k = key || "unknown";
  map[k] = (map[k] || 0) + by;
}

function topCounts(map: Record<string, number>, limit = 12): Array<{ reason: string; count: number }> {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([reason, count]) => ({ reason, count }));
}

function runWarnings(row: Row): string[] {
  const plan = row.run_plan && typeof row.run_plan === "object" ? row.run_plan as Row : {};
  const warnings = Array.isArray(plan.warnings) ? plan.warnings : [];
  return warnings
    .map((warning) => normalizeWarningReason(text(warning, 180)))
    .filter((warning) => warning && !isOperationalNoiseWarning(warning));
}

function isOperationalNoiseWarning(warning: string): boolean {
  const s = warning.toLowerCase();
  return s === "runtime autofill skipped fail-open"
    || s.startsWith("gen-poll source fallback rescued")
    || s.startsWith("assemble source fallback rescued");
}

function otk(row: Row): Row {
  return row.otk_verdict && typeof row.otk_verdict === "object" ? row.otk_verdict as Row : {};
}

function isProduced(row: Row): boolean {
  return !!text(row.output_url, 500);
}

function isTextOrFallback(row: Row): boolean {
  const basis = text(otk(row).basis, 40).toLowerCase();
  return basis === "text" || basis === "fallback" || basis === "storyboard";
}

function isOtkPass(row: Row): boolean {
  return text(row.status, 40) === "otk_pass" && (num(row.otk_score) ?? -1) >= 7 && !isTextOrFallback(row);
}

export async function loadFactoryQualityDiagnostics(
  db: SupabaseClient,
  options?: { hours?: number; niche?: string | null },
): Promise<FactoryQualityDiagnostics> {
  const windowHours = Math.max(1, Math.min(24 * 30, Number(options?.hours) || 72));
  const since = new Date(Date.now() - windowHours * 3600_000).toISOString();
  const niche = options?.niche ? canonicalNiche(text(options.niche, 80)) : null;

  const { data, error } = await db
    .from("node_recipes")
    .select("id,niche,article,status,output_url,otk_score,otk_verdict,run_plan,updated_at")
    .gte("updated_at", since)
    .order("updated_at", { ascending: false })
    .limit(2000);
  if (error) throw error;

  const rows = ((data || []) as Row[]).filter((row) => !niche || canonicalNiche(text(row.niche, 80)) === niche);
  const produced = rows.filter(isProduced);
  const statusCounts: Record<string, number> = {};
  const warningMap: Record<string, number> = {};
  const basisCounts: Record<string, number> = {};
  const defectMap: Record<string, number> = {};
  const byNicheRows = new Map<string, Row[]>();

  for (const row of rows) {
    const status = text(row.status, 40).toLowerCase() || "unknown";
    inc(statusCounts, status);
    const key = canonicalNiche(text(row.niche, 80));
    byNicheRows.set(key, [...(byNicheRows.get(key) || []), row]);
    for (const warning of runWarnings(row)) inc(warningMap, warning);
    const basis = text(otk(row).basis, 40).toLowerCase();
    if (basis) inc(basisCounts, basis);
    const defects = Array.isArray(otk(row).artifact_defects) ? otk(row).artifact_defects as unknown[] : [];
    for (const defect of defects) inc(defectMap, text(defect, 140));
  }

  const memoryCounts: FactoryQualityDiagnostics["memory_counts"] = { winner: 0, usable: 0, trash: 0, unlabeled: 0 };
  try {
    const { data: assets } = await db
      .from("content_assets")
      .select("analysis")
      .eq("disk", "gen")
      .eq("kind", "video")
      .limit(5000);
    for (const row of ((assets || []) as Row[])) {
      const analysis = row.analysis && typeof row.analysis === "object" ? row.analysis as Row : {};
      const label = text(analysis.memory_label, 20).toLowerCase();
      if (label === "winner" || label === "usable" || label === "trash") memoryCounts[label] += 1;
      else memoryCounts.unlabeled += 1;
    }
  } catch {
    memoryCounts.unlabeled = 0;
  }

  const sourceTiers: Record<SourceReadinessTier, number> = { prepared: 0, real: 0, wb: 0, none: 0 };
  try {
    const readiness = await loadSourceReadiness(db, Array.from(new Set(rows.map((row) => text(row.article, 80)).filter(Boolean))));
    for (const item of readiness.values()) sourceTiers[item.tier] += 1;
  } catch {
    sourceTiers.none = 0;
  }

  const byNiche = Array.from(byNicheRows.entries()).map(([key, nicheRows]) => {
    const nicheProduced = nicheRows.filter(isProduced);
    const nicheWarnings: Record<string, number> = {};
    for (const row of nicheRows) for (const warning of runWarnings(row)) inc(nicheWarnings, warning);
    return {
      niche: key,
      produced_videos: nicheProduced.length,
      otk_pass: nicheProduced.filter(isOtkPass).length,
      run_fail: nicheRows.filter((row) => text(row.status, 40) === "run_fail").length,
      top_warning: topCounts(nicheWarnings, 1)[0]?.reason || null,
    };
  }).sort((a, b) => b.produced_videos - a.produced_videos || b.otk_pass - a.otk_pass);

  const otkPass = produced.filter(isOtkPass).length;
  const noScore = produced.filter((row) => num(row.otk_score) == null).length;
  const textOrFallback = produced.filter(isTextOrFallback).length;
  const runFail = rows.filter((row) => text(row.status, 40) === "run_fail").length;
  const blockers: string[] = [];
  const nextActions: string[] = [];

  if (produced.length && otkPass === 0) blockers.push("frames-grounded OTK pass-rate is 0");
  if (memoryCounts.winner === 0) blockers.push("video memory has no winner examples");
  if (sourceTiers.wb > sourceTiers.prepared + sourceTiers.real) blockers.push("source pool is dominated by raw WB assets");
  if (runFail > 0) blockers.push(`${runFail} recent run_fail recipes`);
  if (textOrFallback > 0) blockers.push(`${textOrFallback} produced videos were judged by text/storyboard/fallback`);

  const topWarning = topCounts(warningMap, 1)[0]?.reason || "";
  if (sourceTiers.wb > 0) nextActions.push("prepare_product for WB-only articles before paid batch");
  if (memoryCounts.trash > 0) nextActions.push("exclude trash memory from pattern selection and review top trash reasons");
  if (topWarning) nextActions.push(`fix dominant warning: ${topWarning}`);
  if (memoryCounts.winner === 0) nextActions.push("manually mark at least 3 operator winners or import market metrics before broad learning");
  if (noScore > 0) nextActions.push("inspect video-critic/no-score path before increasing batch size");

  return {
    window_hours: windowHours,
    since,
    totals: {
      recipes: rows.length,
      produced_videos: produced.length,
      otk_pass: otkPass,
      run_fail: runFail,
      no_score: noScore,
      text_or_fallback_judged: textOrFallback,
    },
    status_counts: statusCounts,
    warning_counts: topCounts(warningMap),
    otk_basis_counts: basisCounts,
    artifact_defects: topCounts(defectMap).map(({ reason, count }) => ({ defect: reason, count })),
    memory_counts: memoryCounts,
    source_tiers: sourceTiers,
    by_niche: byNiche,
    blockers,
    next_actions: nextActions.slice(0, 6),
  };
}
