import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { internalFetch } from "@/lib/internalFetch";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// V5 · Контур постинг→РЫНОК (недостающая половина стратег-блокера №1): оператор вписывает реальные
// метрики опубликованного ролика → post_metrics (раньше мёртвая таблица) + forward в /winners с РЕАЛЬНЫМИ
// просмотрами. Хук получает рыночную валидацию (viability=5 по факту залёта), а не только самооценку ОТК.
//   POST { recipe_id, platform?, views, watch_rate?, ctr?, saves?, posted_at? }
export async function POST(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    const b = await req.json().catch(() => ({}));
    const recipeId = Number(b.recipe_id) || 0;
    const views = Math.max(0, Math.floor(Number(b.views) || 0));
    if (!recipeId) return NextResponse.json({ ok: false, error: "нужен recipe_id" }, { status: 400 });
    if (!views) return NextResponse.json({ ok: false, error: "нужны просмотры" }, { status: 400 });
    const warnings: string[] = [];
    const rateOrNull = (value: unknown) => {
      if (value == null || value === "") return null;
      const n = Number(value);
      return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
    };
    const countOrNull = (value: unknown) => {
      if (value == null || value === "") return null;
      const n = Math.floor(Number(value));
      return Number.isFinite(n) ? Math.max(0, n) : null;
    };

  // 1) запись метрик в post_metrics (оживляем мёртвую таблицу)
    let metricsSaved = false;
    try {
      const { error } = await db.from("post_metrics").insert({
        recipe_id: recipeId,
        platform: (b.platform || "TikTok").toString().slice(0, 20),
        posted_at: b.posted_at || new Date().toISOString(),
        views,
        watch_rate: rateOrNull(b.watch_rate),
        ctr_card: rateOrNull(b.ctr),
        saves: countOrNull(b.saves),
      });
      if (error) {
        warnings.push("post_metrics insert: " + error.message.slice(0, 140));
        console.error("[post-metrics] insert error:", error.message); // напр. миграция 20260620 не применена
      } else metricsSaved = true;
    } catch (e) {
      warnings.push("post_metrics insert exception: " + String((e as Error)?.message || e).slice(0, 120));
      console.error("[post-metrics] insert exception:", e);
    }

  // 2) рынок → winners: тянем output_url рецепта + хук, апгрейдим хук реальными просмотрами
    let forwarded = false;
    let outputUrl: string | null = null;
    let recipeStatus: string | null = null;
    try {
      const { data, error } = await db.from("node_recipes").select("output_url,status,run_plan").eq("id", recipeId).limit(1);
      if (error) warnings.push("node_recipes lookup: " + error.message.slice(0, 140));
      const rec = (data as Record<string, unknown>[] | null)?.[0];
      outputUrl = rec?.output_url ? String(rec.output_url) : null;
      recipeStatus = rec?.status ? String(rec.status) : null;
      if (outputUrl) {
        const nodes = (((rec?.run_plan as Record<string, unknown>)?.nodes) as Record<string, unknown>[]) || [];
        const h = nodes.find((n) => String((n.params as Record<string, unknown>)?.role || n.slot || "").toLowerCase() === "hook") || nodes[0];
        const hook = String((h?.onscreen_text as string) || (h?.prompt as string) || "").slice(0, 120);
        const res = await internalFetch(`${req.nextUrl.origin}/api/factory/winners`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: outputUrl, hook, views, recipe_id: recipeId, note: `рынок: ${views} просм · ${b.platform || "TikTok"}` }),
          signal: AbortSignal.timeout(20000),
        });
        const payload = await res.json().catch(() => null) as { ok?: boolean; error?: string } | null;
        forwarded = res.ok && payload?.ok === true;
        if (!forwarded) warnings.push("winners forward: " + String(payload?.error || res.statusText || res.status).slice(0, 140));
      } else {
        warnings.push("recipe has no output_url; metrics saved without winner forward");
      }
    } catch (e) {
      warnings.push("winners forward exception: " + String((e as Error)?.message || e).slice(0, 120));
    }

    let statusMarked = false;
    if ((metricsSaved || forwarded) && outputUrl && recipeStatus !== "running") {
      try {
        const { data: markedRows, error } = await db
          .from("node_recipes")
          .update({ status: "posted", updated_at: new Date().toISOString() })
          .eq("id", recipeId)
          .neq("status", "running")
          .select("id")
          .limit(1);
        if (error) warnings.push("node_recipes status update: " + error.message.slice(0, 140));
        else statusMarked = !!(markedRows && markedRows.length);
      } catch (e) {
        warnings.push("node_recipes status update exception: " + String((e as Error)?.message || e).slice(0, 120));
      }
    } else if (metricsSaved || forwarded) {
      if (!outputUrl) warnings.push("recipe status not marked posted: missing output_url");
      if (recipeStatus === "running") warnings.push("recipe status not marked posted: recipe is still running");
    }

    return NextResponse.json({ ok: true, forwarded, metrics_saved: metricsSaved, status_marked: statusMarked, warnings });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      forwarded: false,
      metrics_saved: false,
      status_marked: false,
      error: "post-metrics crash: " + String((e as Error)?.message || e).slice(0, 160),
    }, { status: 500 });
  }
}
