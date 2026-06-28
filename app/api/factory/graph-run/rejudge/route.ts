import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { internalFetch } from "@/lib/internalFetch";
import { extractFrames } from "@/lib/factory/serverMedia";
import type { RunPlan } from "@/lib/factory/graphTypes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface RecipeRow {
  id: number;
  article: string | null;
  niche: string | null;
  mode: string | null;
  output_url: string | null;
  run_plan: RunPlan | null;
}

function authOk(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || "";
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}

function addPlanWarning(plan: RunPlan, message: string): void {
  const next = new Set((plan.warnings || []).map((w) => String(w).trim()).filter(Boolean));
  next.add(message.slice(0, 240));
  plan.warnings = Array.from(next).slice(0, 20);
}

async function critic(origin: string, body: Record<string, unknown>) {
  const r = await internalFetch(`${origin}/api/factory/video-critic`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(55000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`video-critic ${r.status}: ${String(j?.error || j?.detail || r.statusText || "ошибка").slice(0, 160)}`);
  return j as { score?: number; verdict?: string; axes?: unknown; issues?: string[]; basis?: string; basis_reason?: string };
}

async function genSave(origin: string, body: Record<string, unknown>) {
  const r = await internalFetch(`${origin}/api/factory/gen-save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(55000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.ok === false) throw new Error(`gen-save ${r.status}: ${String(j?.error || j?.diag || r.statusText || "ошибка").slice(0, 180)}`);
  return j as { url?: string; already?: boolean };
}

export async function POST(req: NextRequest) {
  try {
  if (!authOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const apply = body.apply === true;
  const maxItems = Math.max(1, Math.min(apply ? 3 : 10, Number(body.max_items) || (apply ? 3 : 10)));
  const recipeIds = Array.isArray(body.recipe_ids) ? body.recipe_ids.map((x: unknown) => Number(x)).filter(Boolean).slice(0, maxItems) : [];
  const sinceHours = Math.min(168, Math.max(1, Number(body.since_hours) || 72));
  const since = new Date(Date.now() - sinceHours * 3600_000).toISOString();

  let q = db.from("node_recipes")
    .select("id,article,niche,mode,output_url,run_plan")
    .eq("status", "otk_pass")
    .is("otk_score", null)
    .not("output_url", "is", null)
    .order("updated_at", { ascending: false })
    .limit(maxItems);
  if (recipeIds.length) q = q.in("id", recipeIds);
  else q = q.gte("updated_at", since);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (data as RecipeRow[] | null) || [];
  if (!rows.length) return NextResponse.json({ ok: true, apply, processed: [], note: "нет otk_pass с пустым otk_score" });

  const origin = req.nextUrl.origin;
  const processed = [];
  for (const row of rows) {
    const plan = row.run_plan || ({ step: "done", nodes: [] } as RunPlan);
    const url = row.output_url || plan.output_url;
    if (!url) { processed.push({ id: row.id, error: "нет output_url" }); continue; }
    let frames: string[];
    try {
      frames = await extractFrames(url);
    } catch (e) {
      processed.push({ id: row.id, error: `extractFrames: ${String((e as Error)?.message || e).slice(0, 180)}` });
      continue;
    }
    if (!frames.length) { processed.push({ id: row.id, error: "не извлеклись кадры" }); continue; }
    const hookNode = (plan.nodes || []).find((n) => String(((n.params || {}) as Record<string, unknown>)["role"] || n.slot || "").toLowerCase() === "hook") || (plan.nodes || [])[0];
    let verdict: { score?: number; verdict?: string; axes?: unknown; issues?: string[]; basis?: string; basis_reason?: string };
    try {
      verdict = await critic(origin, {
        frames,
        hook: hookNode?.onscreen_text || hookNode?.prompt || "",
        mode: row.mode || "audience",
        article: row.article || "",
        niche: row.niche || "",
        target_platform: plan.target_platform || "tiktok",
      });
    } catch (e) {
      processed.push({ id: row.id, error: String((e as Error)?.message || e).slice(0, 220) });
      continue;
    }
    const score = typeof verdict.score === "number" ? verdict.score : null;
    if (score == null) { processed.push({ id: row.id, error: "video-critic без score" }); continue; }
    const status = score >= 7 ? "otk_pass" : "warning";
    const otk = {
      score,
      verdict: verdict.verdict,
      axes: verdict.axes || null,
      issues: Array.isArray(verdict.issues) ? verdict.issues : [],
      basis: verdict.basis ? String(verdict.basis) : null,
      basis_reason: verdict.basis_reason ? String(verdict.basis_reason) : null,
    };
    const result: Record<string, unknown> = { id: row.id, apply, status, score, issues: otk.issues.slice(0, 3) };
    result.target_platform = plan.target_platform || "tiktok";
    if (status === "warning") result.warning = `OTK below threshold: ${score}`;
    processed.push(result);
    if (!apply) continue;

    const hook = (hookNode?.onscreen_text || hookNode?.prompt || "").toString().slice(0, 200);
    let catalogUrl: string | null = null;
    let catalogError: string | null = null;
    try {
      const saved = await genSave(origin, {
        video_url: url,
        article: row.article || "",
        niche: row.niche || "",
        hook,
        route: "node_graph_rejudge",
        engine: plan.render_engine || "remotion",
        otk: score,
        otk_axes: otk.axes ?? null,
        recipe_id: row.id,
        source: "graph_run_rejudge",
      });
      catalogUrl = saved.url || null;
      result.catalog_url = catalogUrl;
      result.catalog_already = saved.already === true;
    } catch (e) {
      catalogError = String((e as Error)?.message || e).slice(0, 220);
      result.catalog_error = catalogError;
    }

    plan.otk = otk;
    plan.bestScore = score;
    plan.bestUrl = url;
    plan.catalog_url = catalogUrl;
    plan.catalog_error = catalogError;
    if (status === "warning") addPlanWarning(plan, `rejudge OTK below threshold: ${score}`);
    if (catalogError) addPlanWarning(plan, `rejudge gen-save warning: ${catalogError}`);
    plan.error = null;
    await db.from("node_recipes").update({
      status,
      otk_score: score,
      otk_verdict: otk,
      output_url: catalogUrl || url,
      run_plan: plan,
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);

    try {
      await db.from("cf_signals").insert({
        event: "approved",
        recipe_id: row.id,
        niche: row.niche,
        article: row.article,
        mode: row.mode || "audience",
        engine: plan.render_engine || "remotion",
        axes: otk.axes,
        reason_chip: status === "warning" ? (otk.issues[0] || "ОТК warning") : "rejudge",
        params: { source: "graph_run_rejudge", previous_status: "otk_pass", catalog_url: catalogUrl, catalog_error: catalogError },
      });
    } catch { /* сигнал best-effort */ }
  }

  return NextResponse.json({ ok: true, apply, max_items: maxItems, processed });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      apply: false,
      max_items: 0,
      processed: [],
      error: "graph-run/rejudge crash: " + String((e as Error)?.message || e).slice(0, 160),
    }, { status: 500 });
  }
}
