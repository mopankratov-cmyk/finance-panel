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
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
  const b = await req.json().catch(() => ({}));
  const recipeId = Number(b.recipe_id) || 0;
  const views = Number(b.views) || 0;
  if (!recipeId) return NextResponse.json({ ok: false, error: "нужен recipe_id" }, { status: 400 });
  if (!views) return NextResponse.json({ ok: false, error: "нужны просмотры" }, { status: 400 });

  // 1) запись метрик в post_metrics (оживляем мёртвую таблицу)
  let metricsSaved = false;
  try {
    const { error } = await db.from("post_metrics").insert({
      recipe_id: recipeId,
      platform: (b.platform || "TikTok").toString().slice(0, 20),
      posted_at: b.posted_at || new Date().toISOString(),
      views,
      watch_rate: b.watch_rate != null ? Number(b.watch_rate) : null,
      ctr_card: b.ctr != null ? Number(b.ctr) : null,
      saves: b.saves != null ? Number(b.saves) : null,
    });
    if (error) console.error("[post-metrics] insert error:", error.message); // напр. миграция 20260620 не применена
    else metricsSaved = true;
  } catch (e) { console.error("[post-metrics] insert exception:", e); }

  // 2) рынок → winners: тянем output_url рецепта + хук, апгрейдим хук реальными просмотрами
  let forwarded = false;
  try {
    const { data } = await db.from("node_recipes").select("output_url,run_plan").eq("id", recipeId).limit(1);
    const rec = (data as Record<string, unknown>[] | null)?.[0];
    const url = rec?.output_url as string | undefined;
    if (url) {
      const nodes = (((rec?.run_plan as Record<string, unknown>)?.nodes) as Record<string, unknown>[]) || [];
      const h = nodes.find((n) => String((n.params as Record<string, unknown>)?.role || n.slot || "").toLowerCase() === "hook") || nodes[0];
      const hook = String((h?.onscreen_text as string) || (h?.prompt as string) || "").slice(0, 120);
      await internalFetch(`${req.nextUrl.origin}/api/factory/winners`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, hook, views, recipe_id: recipeId, note: `рынок: ${views} просм · ${b.platform || "TikTok"}` }),
        signal: AbortSignal.timeout(20000),
      });
      forwarded = true;
    }
  } catch { /* winners опционально */ }

  return NextResponse.json({ ok: true, forwarded, metrics_saved: metricsSaved });
}
