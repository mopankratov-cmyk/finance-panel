import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { rankVariants, type VariantMetric } from "@/lib/factory/abRank";
import { normalizeTargetPlatform } from "@/lib/factory/reelsBrainPlaybook";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// A/B-петля хит-рейта (read-only): ранжирует ролики портфеля по рыночным метрикам (post_metrics) →
// винеры (множить через /reel-recompose|/recipe-variants) и лузеры (стоп/не лить). Операционализирует
// вывод юнитки: «узкое место — хит-рейт, не деньги». НИЧЕГО не меняет — только читает и советует.
//   GET ?niche=&since=ISO&recipe_ids=1,2&limit=  → { ok, ranked:[…], summary, winners:[…], losers:[…] }

function hookFromRunPlan(runPlan: unknown): string {
  const nodes = (((runPlan as Record<string, unknown>)?.nodes) as Record<string, unknown>[]) || [];
  const h = nodes.find((n) => String(((n.params as Record<string, unknown>)?.role) || n.slot || "").toLowerCase() === "hook") || nodes[0];
  return String((h?.onscreen_text as string) || (h?.prompt as string) || "").slice(0, 120);
}

export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    const sp = req.nextUrl.searchParams;
    const niche = (sp.get("niche") || "").trim();
    const targetPlatform = (sp.get("platform") || sp.get("target_platform") || "").trim();
    const since = (sp.get("since") || "").trim();
    const limit = Math.min(2000, Math.max(10, Number(sp.get("limit")) || 500));
    const explicitIds = (sp.get("recipe_ids") || "").split(",").slice(0, 1000).map((s) => Number(s.trim())).filter((n) => n > 0);

    // 1) метрики рынка (несколько снапшотов на ролик возможны → берём лучший по views)
    let mq = db.from("post_metrics").select("recipe_id,views,watch_rate,ctr_card,saves,posted_at,platform").order("posted_at", { ascending: false }).limit(limit);
    if (since) mq = mq.gte("posted_at", since);
    if (explicitIds.length) mq = mq.in("recipe_id", explicitIds);
    const { data: pm, error: pmError } = await mq;
    if (pmError) {
      return NextResponse.json({
        ok: true,
        ranked: [],
        summary: { winners: 0, mid: 0, losers: 0, total: 0 },
        note: "post_metrics недоступна: " + pmError.message.slice(0, 140),
      });
    }
    const rows = (pm as Record<string, unknown>[] | null) || [];
    if (!rows.length) return NextResponse.json({ ok: true, ranked: [], summary: { winners: 0, mid: 0, losers: 0, total: 0 }, note: "нет данных post_metrics (впиши реальные метрики через /post-metrics)" });

    // агрегируем по recipe_id: лучший снапшот (max views)
    const best = new Map<number, Record<string, unknown>>();
    for (const r of rows) {
      const id = Number(r.recipe_id); if (!id) continue;
      const prev = best.get(id);
      if (!prev || (Number(r.views) || 0) > (Number(prev.views) || 0)) best.set(id, r);
    }

    // 2) рецепты (ниша/артикул/хук/output_url) для этих id
    const ids = [...best.keys()];
    const { data: recs, error: recError } = await db.from("node_recipes").select("id,niche,article,output_url,run_plan").in("id", ids);
    if (recError) {
      return NextResponse.json({
        ok: true,
        ranked: [],
        summary: { winners: 0, mid: 0, losers: 0, total: 0 },
        note: "node_recipes недоступна: " + recError.message.slice(0, 140),
      });
    }
    const recMap = new Map<number, Record<string, unknown>>();
    for (const r of ((recs as Record<string, unknown>[] | null) || [])) recMap.set(Number(r.id), r);

    // 3) собираем метрики вариантов (фильтр по нише), ранжируем
    const metrics: (VariantMetric & { niche?: string; article?: string; output_url?: string; target_platform?: string })[] = [];
    for (const [id, r] of best) {
      const rec = recMap.get(id);
      if (niche && String(rec?.niche || "").toLowerCase() !== niche.toLowerCase()) continue;
      const platform = normalizeTargetPlatform((r.platform as string) || ((rec?.run_plan as Record<string, unknown> | undefined)?.target_platform));
      if (targetPlatform && platform !== normalizeTargetPlatform(targetPlatform)) continue;
      metrics.push({
        recipe_id: id,
        hook: rec ? hookFromRunPlan(rec.run_plan) : undefined,
        views: Number(r.views) || 0,
        watch_rate: r.watch_rate != null ? Number(r.watch_rate) : null,
        ctr_card: r.ctr_card != null ? Number(r.ctr_card) : null,
        saves: r.saves != null ? Number(r.saves) : null,
        niche: String(rec?.niche || "") || undefined,
        article: String(rec?.article || "") || undefined,
        output_url: (rec?.output_url as string) || undefined,
        target_platform: platform,
      });
    }

    const { ranked, medianScore, summary } = rankVariants(metrics);
    // обогащаем винеров/лузеров полями рецепта (для рекомендаций)
    const enrich = (rv: typeof ranked) => rv.map((x) => {
      const meta = metrics.find((m) => m.recipe_id === x.recipe_id);
      return { ...x, niche: meta?.niche, article: meta?.article, output_url: meta?.output_url, target_platform: meta?.target_platform };
    });
    const winners = enrich(ranked.filter((r) => r.tier === "winner"));
    const losers = enrich(ranked.filter((r) => r.tier === "loser"));

    return NextResponse.json({
      ok: true, median_score: Math.round(medianScore), summary, target_platform: targetPlatform ? normalizeTargetPlatform(targetPlatform) : null,
      ranked: enrich(ranked),
      winners, losers,
      recommend: {
        scale: winners.map((w) => w.recipe_id),  // множить: /reel-recompose или /recipe-variants на этих хуках
        kill: losers.map((l) => l.recipe_id),     // стоп: не лить, хуки в чёрный список
        note: "Винеры → размножить (reuse R вокруг их хука/футажа). Лузеры → не лить. Хит-рейт = винеров/всего.",
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "ab-rank crash: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}
