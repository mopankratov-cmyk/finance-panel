import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 25;

// V16 · Дашборд обучения: что завод выучил (за неделю/всё время). Read-only агрегатор поверх
// cf_signals (winners/rejected/hook_chosen) + viral_hooks (корпус по нишам) + generation_history
// (история+тренд ОТК) + node_templates from_winner (пресеты-победители). Каждая выборка best-effort:
// отсутствие таблицы/миграции → пустой блок, а не 500. Чтобы оператор ВИДЕЛ компаунд.
//   GET ?days=7&niche=
type Row = Record<string, unknown>;

export async function GET(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
  const sp = req.nextUrl.searchParams;
  const days = Math.min(90, Math.max(1, Number(sp.get("days")) || 7));
  const nicheF = (sp.get("niche") || "").trim();
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const warnings: string[] = [];


  const safe = async (label: string, fn: () => Promise<any>, fallback: any) => {
    try {
      const v = await fn();
      return v ?? fallback;
    } catch (e) {
      warnings.push(`${label}: ${String((e as Error)?.message || e).slice(0, 140)}`);
      return fallback;
    }
  };

  // 1) Сигналы за период: счётчики по событиям (cf_signals)
  const signals = await safe("cf_signals", async () => {
    let q = db.from("cf_signals").select("event,niche,reason_chip,created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(800);
    if (nicheF) q = q.eq("niche", nicheF);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data as Row[]) || [];
    const byEvent: Record<string, number> = {};
    for (const r of rows) { const e = String(r.event || "?"); byEvent[e] = (byEvent[e] || 0) + 1; }
    // топ причин реджекта (анти-паттерны, которые завод усвоил)
    const rejReasons: Record<string, number> = {};
    for (const r of rows) if (r.event === "rejected" && r.reason_chip) { const c = String(r.reason_chip).slice(0, 40); rejReasons[c] = (rejReasons[c] || 0) + 1; }
    const topReject = Object.entries(rejReasons).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([reason, n]) => ({ reason, n }));
    return { total: rows.length, by_event: byEvent, top_reject: topReject };
  }, { total: 0, by_event: {}, top_reject: [] });

  // 2) Корпус хуков по нишам (что завод накопил как «знает, что заходит»)
  const hooks_by_niche = await safe("viral_hooks", async () => {
    let q = db.from("viral_hooks").select("niche,hook_text,viability_score,effectiveness_notes").order("viability_score", { ascending: false }).limit(400);
    if (nicheF) q = q.eq("niche", nicheF);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data as Row[]) || [];
    const byNiche: Record<string, { count: number; top: { hook: string; score: number; note: string }[] }> = {};
    for (const r of rows) {
      const n = String(r.niche || "default");
      byNiche[n] = byNiche[n] || { count: 0, top: [] };
      byNiche[n].count++;
      if (byNiche[n].top.length < 5) byNiche[n].top.push({ hook: String(r.hook_text || "").slice(0, 120), score: Number(r.viability_score) || 0, note: String(r.effectiveness_notes || "").slice(0, 60) });
    }
    return Object.entries(byNiche).map(([niche, v]) => ({ niche, count: v.count, top: v.top })).sort((a, b) => b.count - a.count);
  }, []);

  // 3) История генераций + тренд качества (generation_history)
  const gh = await safe("generation_history", async () => {
    let q = db.from("generation_history").select("status,otk_score,tool,engine,niche,output_url,source,created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(300);
    if (nicheF) q = q.eq("niche", nicheF);
    const { data, error } = await q;
    if (error) throw error;
    return (data as Row[]) || [];
  }, []);
  const recent_generations = (gh as Row[]).slice(0, 24).map((r) => ({
    status: r.status, otk_score: r.otk_score, tool: r.tool, engine: r.engine, niche: r.niche, output_url: r.output_url, source: r.source, created_at: r.created_at,
  }));
  // тренд по дням: средний балл + pass/fail/warning отдельно.
  // Sprint 1 fail-open: legacy quality/artifact statuses are warnings in analytics, not run blockers.
  const byDay: Record<string, { sum: number; n: number; pass: number; fail: number; warn: number; gen: number }> = {};
  for (const r of gh as Row[]) {
    const day = String(r.created_at || "").slice(0, 10) || "?";
    byDay[day] = byDay[day] || { sum: 0, n: 0, pass: 0, fail: 0, warn: 0, gen: 0 };
    byDay[day].gen++;
    const s = r.otk_score != null ? Number(r.otk_score) : null;
    if (s != null && !Number.isNaN(s)) { byDay[day].sum += s; byDay[day].n++; }
    if (r.status === "otk_pass" || r.status === "approved") byDay[day].pass++;
    if (r.status === "run_fail") byDay[day].fail++;
    if (r.status === "warning" || r.status === "otk_fail" || r.status === "rejected" || r.status === "artifact_fail") byDay[day].warn++;
  }
  const otk_trend = Object.entries(byDay).map(([day, v]) => ({ day, avg_otk: v.n ? Math.round((v.sum / v.n) * 10) / 10 : null, pass: v.pass, fail: v.fail, warn: v.warn, gen: v.gen })).sort((a, b) => a.day.localeCompare(b.day));

  // 4) Пресеты-победители (node_templates from_winner) — переиспользуемые формулы
  const winner_presets = await safe("node_templates", async () => {
    let q = db.from("node_templates").select("id,niche,format_type,win_note,nodes,created_at,source_recipe_id").eq("from_winner", true).order("created_at", { ascending: false }).limit(30);
    if (nicheF) q = q.eq("niche", nicheF);
    const { data, error } = await q;
    if (error) throw error;
    return ((data as Row[]) || []).map((r) => ({ id: r.id, niche: r.niche, format_type: r.format_type, win_note: r.win_note, nodes_count: Array.isArray(r.nodes) ? (r.nodes as unknown[]).length : 0, source_recipe_id: r.source_recipe_id, created_at: r.created_at }));
  }, []);

  // 5) Победители (content_assets is_winner) — что реально залетело
  const winners = await safe("content_assets winners", async () => {
    let q = db.from("content_assets").select("name,niche,winner_learnings,winner_at,url").eq("is_winner", true).order("winner_at", { ascending: false }).limit(20);
    if (nicheF) q = q.eq("niche", nicheF);
    const { data, error } = await q;
    if (error) throw error;
    return ((data as Row[]) || []).map((r) => ({ name: r.name, niche: r.niche, learnings: r.winner_learnings, winner_at: r.winner_at, url: r.url }));
  }, []);

  return NextResponse.json({ ok: true, days, niche: nicheF || null, warnings, signals, hooks_by_niche, recent_generations, otk_trend, winner_presets, winners });
}
