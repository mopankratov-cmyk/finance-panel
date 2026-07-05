import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { internalFetch } from "@/lib/internalFetch";
import { normalizeTargetPlatform } from "@/lib/factory/reelsBrainPlaybook";
import { recordFactoryPublication } from "@/lib/factory/publications";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function metricPlatformLabel(value: unknown): string {
  const platform = normalizeTargetPlatform(value);
  if (platform === "instagram") return "Instagram";
  if (platform === "youtube") return "Youtube";
  return "Tiktok";
}

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
    let publicationId: string | null = typeof b.publication_id === "string" ? b.publication_id : null;
    const { data: recipeRows } = await db.from("node_recipes").select("run_plan,output_url").eq("id", recipeId).limit(1);
    const recipeRow = (recipeRows as { run_plan?: Record<string, unknown>; output_url?: string | null }[] | null)?.[0] || null;
    const recipePlan = (recipeRow?.run_plan || {}) as Record<string, unknown>;
    const targetPlatform = normalizeTargetPlatform(b.platform || b.target_platform || recipePlan.target_platform);
    const outputUrl = String(b.source_url || b.url || recipeRow?.output_url || "").trim();
    const externalPostId = String(b.external_post_id || b.post_id || "").trim();
    const publishedUrl = String(b.published_url || b.post_url || "").trim();
    const measurementId = String(b.measurement_id || "").trim();
    const validationTaskId = String(b.validation_task_id || b.task_id || "").trim();
    const proofScope = String(b.proof_scope || "").trim();

    if (!publicationId) {
      const publication = await recordFactoryPublication(db, {
        recipeId,
        sourceUrl: outputUrl || publishedUrl || null,
        platform: targetPlatform,
        status: "published",
        publishedUrl: publishedUrl || null,
        externalPostId: externalPostId || null,
        metadata: {
          source: "post_metrics",
          views,
          watch_rate: rateOrNull(b.watch_rate),
          ctr: rateOrNull(b.ctr),
          saves: countOrNull(b.saves),
          ...(measurementId ? { measurement_id: measurementId } : {}),
          ...(validationTaskId ? { validation_task_id: validationTaskId } : {}),
          ...(proofScope ? { proof_scope: proofScope } : {}),
        },
      });
      publicationId = publication.id;
      if (publication.warning) warnings.push(publication.warning);
    }

    try {
      const { error } = await db.from("post_metrics").insert({
        recipe_id: recipeId,
        publication_id: publicationId,
        external_post_id: externalPostId || null,
        platform: metricPlatformLabel(targetPlatform).slice(0, 20),
        posted_at: b.posted_at || new Date().toISOString(),
        views,
        watch_rate: rateOrNull(b.watch_rate),
        hook_rate: rateOrNull(b.hook_rate),
        hold_rate: rateOrNull(b.hold_rate),
        completion_rate: rateOrNull(b.completion_rate),
        ctr_card: rateOrNull(b.ctr),
        saves: countOrNull(b.saves),
        engagement_count: countOrNull(b.engagement_count ?? b.engagement),
        marketplace_orders: countOrNull(b.marketplace_orders ?? b.orders),
        revenue: b.revenue == null || b.revenue === "" ? null : Math.max(0, Number(b.revenue) || 0),
        pulled_at: new Date().toISOString(),
        source: String(b.source || "manual").slice(0, 40),
        raw_metrics: {
          ...(b.raw_metrics && typeof b.raw_metrics === "object" ? b.raw_metrics as Record<string, unknown> : {}),
          ...(measurementId ? { measurement_id: measurementId } : {}),
          ...(validationTaskId ? { validation_task_id: validationTaskId } : {}),
          ...(proofScope ? { proof_scope: proofScope } : {}),
        },
      });
      if (error) {
        warnings.push("post_metrics insert: " + error.message.slice(0, 140));
        console.error("[post-metrics] insert error:", error.message); // напр. миграция 20260620 не применена
        try {
          const legacy = await db.from("post_metrics").insert({
            recipe_id: recipeId,
            platform: metricPlatformLabel(targetPlatform).slice(0, 20),
            posted_at: b.posted_at || new Date().toISOString(),
            views,
            watch_rate: rateOrNull(b.watch_rate),
            ctr_card: rateOrNull(b.ctr),
            saves: countOrNull(b.saves),
          });
          if (legacy?.error) warnings.push("post_metrics legacy insert: " + legacy.error.message.slice(0, 140));
          else metricsSaved = true;
        } catch (legacyError) {
          warnings.push("post_metrics legacy exception: " + String((legacyError as Error)?.message || legacyError).slice(0, 120));
        }
      } else metricsSaved = true;
    } catch (e) {
      warnings.push("post_metrics insert exception: " + String((e as Error)?.message || e).slice(0, 120));
      console.error("[post-metrics] insert exception:", e);
    }

  // 2) рынок → winners: тянем output_url рецепта + хук, апгрейдим хук реальными просмотрами
    let forwarded = false;
    try {
      const { data, error } = await db.from("node_recipes").select("output_url,run_plan").eq("id", recipeId).limit(1);
      if (error) warnings.push("node_recipes lookup: " + error.message.slice(0, 140));
      const rec = (data as Record<string, unknown>[] | null)?.[0];
      const url = rec?.output_url as string | undefined;
      if (url) {
        const nodes = (((rec?.run_plan as Record<string, unknown>)?.nodes) as Record<string, unknown>[]) || [];
        const h = nodes.find((n) => String((n.params as Record<string, unknown>)?.role || n.slot || "").toLowerCase() === "hook") || nodes[0];
        const hook = String((h?.onscreen_text as string) || (h?.prompt as string) || "").slice(0, 120);
        const res = await internalFetch(`${req.nextUrl.origin}/api/factory/winners`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, hook, views, recipe_id: recipeId, target_platform: targetPlatform, note: `рынок: ${views} просм · ${metricPlatformLabel(targetPlatform)}` }),
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

    return NextResponse.json({ ok: true, forwarded, metrics_saved: metricsSaved, publication_id: publicationId, target_platform: metricPlatformLabel(targetPlatform), warnings });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      forwarded: false,
      metrics_saved: false,
      error: "post-metrics crash: " + String((e as Error)?.message || e).slice(0, 160),
    }, { status: 500 });
  }
}
