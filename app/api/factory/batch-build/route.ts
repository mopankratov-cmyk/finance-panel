import { NextRequest, NextResponse, after } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { nicheFromArticle } from "@/lib/factory/rubric";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// V21.2 · Полная автономность: собрать партию ЧЕРНОВИКОВ с нуля (товары × топ-конкуренты → пары) →
// async-очередь (batch-build/tick) декомпозит+переносит каждую пару → потом /batch генерит. Самоподдерживается.
//   POST { niche, count?, budget_usd?, articles?:[] } → { ok, build_id, pairs, note }
//   GET  ?build_id=  → прогресс сборки
export async function POST(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    const b = await req.json().catch(() => ({}));
    const niche = (b.niche || "").toString().trim();
    if (!niche) return NextResponse.json({ ok: false, error: "нужна ниша (niche)" }, { status: 400 });
    const count = Math.min(20, Math.max(1, Number(b.count) || 5));
    const budget = Math.max(1, Number(b.budget_usd) || 40);

    // 1) товары оператора этой ниши: явный список ИЛИ из product_costs (фильтр по nicheFromArticle)
    let articles: string[] = Array.isArray(b.articles) ? b.articles.map((x: unknown) => String(x || "").trim()).filter(Boolean) : [];
    if (!articles.length) {
      const { data } = await db.from("product_costs").select("article,name");
      const rows = (data as { article: string; name: string }[] | null) || [];
      articles = rows.filter((r) => r.article && nicheFromArticle(r.article, r.name || "") === niche).map((r) => r.article);
    }
    if (!articles.length) return NextResponse.json({ ok: false, error: `нет товаров ниши «${niche}» (заполни себестоимость product_costs или передай articles)` }, { status: 400 });

    // 2) топ-конкуренты ниши из корпуса (по virality_score, только с текстом для декомпозиции)
    const { data: vv } = await db.from("viral_videos").select("id,caption,hook_text,virality_score").eq("niche", niche).order("virality_score", { ascending: false, nullsFirst: false }).limit(Math.max(count, 12));
    const comps = ((vv as { id: number; caption: string | null; hook_text: string | null }[] | null) || []).filter((v) => (v.caption && v.caption.length > 20) || v.hook_text);
    if (!comps.length) return NextResponse.json({ ok: false, error: `нет конкурентов в корпусе ниши «${niche}» — синкни орбиту` }, { status: 400 });

    // 3) пары round-robin (конкурент × товар) до count
    const pairs: { viral_video_id: number; article: string }[] = [];
    for (let i = 0; i < count; i++) pairs.push({ viral_video_id: comps[i % comps.length].id, article: articles[i % articles.length] });

    // прикидка без сборки (ничего не создаём)
    if (b.dry_run === true) return NextResponse.json({ ok: true, dry: true, pairs: pairs.length, competitors: comps.length, products: articles.length, note: `Соберётся ${pairs.length} черновиков: ${comps.length} конкурентов × ${articles.length} товаров (ничего не создано/оплачено).` });

    // 4) запись задания сборки + старт self-chain
    const { data: ins, error } = await db.from("batch_builds").insert({ niche, pairs, budget_usd: budget, status: "building", note: `${pairs.length} черновиков: ${comps.length} конкурентов × ${articles.length} товаров` }).select("id").maybeSingle();
    if (error || !ins) return NextResponse.json({ ok: false, error: "batch_builds: " + (error?.message || "не создалось"), hint: "миграция 20260622_batch_builds применена?" }, { status: 500 });
    const buildId = (ins as { id: number }).id;

    const origin = req.nextUrl.origin;
    after(async () => { try { await fetch(`${origin}/api/factory/batch-build/tick`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ build_id: buildId }), signal: AbortSignal.timeout(20000) }); } catch { /* воскресит опрос */ } });

    return NextResponse.json({ ok: true, build_id: buildId, pairs: pairs.length, competitors: comps.length, products: articles.length, note: `Собираю ${pairs.length} черновиков (decompose→перенос), затем генерю в пределах $${budget}. Прогресс: GET ?build_id=${buildId}.` });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "batch-build crash: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
  const buildId = Number(req.nextUrl.searchParams.get("build_id"));
  if (!buildId) return NextResponse.json({ ok: false, error: "нужен build_id" }, { status: 400 });
  const { data } = await db.from("batch_builds").select("id,niche,pairs,cursor,built_recipe_ids,status,note,error,budget_usd").eq("id", buildId).maybeSingle();
  const r = data as Record<string, unknown> | null;
  if (!r) return NextResponse.json({ ok: false, error: "сборка не найдена" }, { status: 404 });
  const pairs = Array.isArray(r.pairs) ? (r.pairs as unknown[]).length : 0;
  // самовоскрешение цепочки, если зависла (как graph-run GET)
  if (r.status === "building") {
    const origin = req.nextUrl.origin;
    after(async () => { try { await fetch(`${origin}/api/factory/batch-build/tick`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ build_id: buildId }), signal: AbortSignal.timeout(15000) }); } catch { /* следующий опрос */ } });
  }
  return NextResponse.json({ ok: true, build_id: buildId, niche: r.niche, status: r.status, built: Array.isArray(r.built_recipe_ids) ? (r.built_recipe_ids as unknown[]).length : 0, total: pairs, cursor: r.cursor, recipe_ids: r.built_recipe_ids, note: r.note, error: r.error }, { headers: { "Cache-Control": "no-store" } });
}
