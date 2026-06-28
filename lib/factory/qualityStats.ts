import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalNiche } from "./rubric";

type Row = Record<string, unknown>;

export interface FactoryQualityStats {
  window_hours: number;
  since: string;
  produced_videos: number;
  otk_pass: number;
  warnings: number;
  run_fail: number;
  banked_videos: number;
  frames_grounded_pass: number;
  text_or_fallback_judged: number;
  no_score: number;
  pass_rate: number;
  bank_rate: number;
  by_niche: Array<{
    niche: string;
    produced_videos: number;
    otk_pass: number;
    warnings: number;
    run_fail: number;
    pass_rate: number;
  }>;
}

function text(value: unknown, max = 80): string {
  return String(value || "").trim().slice(0, max);
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isProduced(row: Row): boolean {
  return !!text(row.output_url, 500);
}

function isFramesGrounded(row: Row): boolean {
  const otk = row.otk_verdict && typeof row.otk_verdict === "object" ? row.otk_verdict as Row : {};
  const basis = text(otk.basis, 40).toLowerCase();
  if (!basis) return true;
  return basis !== "text" && basis !== "fallback" && basis !== "storyboard";
}

function isPass(row: Row): boolean {
  return text(row.status, 40) === "otk_pass" && (num(row.otk_score) ?? -1) >= 7 && isFramesGrounded(row);
}

function pct(part: number, total: number): number {
  return total ? Math.round((part / total) * 1000) / 10 : 0;
}

export async function loadFactoryQualityStats(
  db: SupabaseClient,
  options?: { hours?: number; niche?: string | null },
): Promise<FactoryQualityStats> {
  const windowHours = Math.max(1, Math.min(24 * 30, Number(options?.hours) || 24));
  const since = new Date(Date.now() - windowHours * 3600_000).toISOString();
  const niche = options?.niche ? canonicalNiche(text(options.niche, 80)) : null;

  let q = db
    .from("node_recipes")
    .select("id,niche,status,output_url,otk_score,otk_verdict,updated_at")
    .gte("updated_at", since)
    .order("updated_at", { ascending: false })
    .limit(2000);
  const { data, error } = await q;
  if (error) throw error;
  const rows = ((data || []) as Row[]).filter((row) => !niche || canonicalNiche(text(row.niche, 80)) === niche);
  const produced = rows.filter(isProduced);
  const pass = produced.filter(isPass);
  const warnings = produced.filter((row) => text(row.status, 40) === "warning").length;
  const runFail = rows.filter((row) => text(row.status, 40) === "run_fail").length;
  const framesGroundedPass = pass.length;
  const textOrFallback = produced.filter((row) => !isFramesGrounded(row)).length;
  const noScore = produced.filter((row) => num(row.otk_score) == null).length;

  let bankedVideos = 0;
  try {
    let cq = db
      .from("content_assets")
      .select("id,niche")
      .eq("disk", "gen")
      .eq("kind", "video")
      .gte("created_at", since)
      .limit(5000);
    const { data: assetRows } = await cq;
    bankedVideos = ((assetRows || []) as Row[]).filter((row) => !niche || canonicalNiche(text(row.niche, 80)) === niche).length;
  } catch {
    bankedVideos = 0;
  }

  const by = new Map<string, Row[]>();
  for (const row of rows) {
    const key = canonicalNiche(text(row.niche, 80));
    by.set(key, [...(by.get(key) || []), row]);
  }
  const byNiche = Array.from(by.entries()).map(([key, nicheRows]) => {
    const nicheProduced = nicheRows.filter(isProduced);
    const nichePass = nicheProduced.filter(isPass).length;
    return {
      niche: key,
      produced_videos: nicheProduced.length,
      otk_pass: nichePass,
      warnings: nicheProduced.filter((row) => text(row.status, 40) === "warning").length,
      run_fail: nicheRows.filter((row) => text(row.status, 40) === "run_fail").length,
      pass_rate: pct(nichePass, nicheProduced.length),
    };
  }).sort((a, b) => b.produced_videos - a.produced_videos || b.otk_pass - a.otk_pass);

  return {
    window_hours: windowHours,
    since,
    produced_videos: produced.length,
    otk_pass: pass.length,
    warnings,
    run_fail: runFail,
    banked_videos: bankedVideos,
    frames_grounded_pass: framesGroundedPass,
    text_or_fallback_judged: textOrFallback,
    no_score: noScore,
    pass_rate: pct(pass.length, produced.length),
    bank_rate: pct(bankedVideos, produced.length),
    by_niche: byNiche,
  };
}
