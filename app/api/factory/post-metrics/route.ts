import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getSupabaseReadClient } from "@/lib/supabaseAdmin";
import { findPublicationContext, forwardWinnerFromRecipe, metricSnapshotToRow, pullLiveMetrics, savePostMetrics } from "@/lib/factory/marketLoop";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function safeError(error: unknown): string {
  return String((error as { message?: unknown } | null)?.message || error || "unknown").slice(0, 220);
}

// V5 · Контур постинг→РЫНОК (недостающая половина стратег-блокера №1): оператор вписывает реальные
// метрики опубликованного ролика → post_metrics (раньше мёртвая таблица) + forward в /winners с РЕАЛЬНЫМИ
// просмотрами. Хук получает рыночную валидацию (viability=5 по факту залёта), а не только самооценку ОТК.
//   POST { recipe_id, platform?, views, watch_rate?, ctr?, saves?, posted_at? }
//   POST { publication_id? | recipe_id? | external_post_id?, pull_live:true } → adapter pullMetrics → save → winners
export async function POST(req: NextRequest) {
  const adminDb = getSupabaseAdmin();
  const readDb = adminDb || getSupabaseReadClient();
  if (!readDb) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
  const b = await req.json().catch(() => ({}));
  const pullLive = b.pull_live === true || b.mode === "pull_live" || b.mode === "poll";

  let recipeId = Number(b.recipe_id) || 0;
  let platform = (b.platform || "tiktok").toString().slice(0, 20);
  let publicationId = (b.publication_id || "").toString().trim() || null;
  let externalPostId = (b.external_post_id || "").toString().trim() || null;
  let views = Number(b.views) || 0;
  let watchRate = b.watch_rate != null ? Number(b.watch_rate) : null;
  let completionRate = b.completion_rate != null ? Number(b.completion_rate) : null;
  let ctrCard = b.ctr != null ? Number(b.ctr) : (b.ctr_card != null ? Number(b.ctr_card) : null);
  let saves = b.saves != null ? Number(b.saves) : null;
  let engagementCount = b.engagement_count != null ? Number(b.engagement_count) : null;
  let marketplaceOrders = b.marketplace_orders != null ? Number(b.marketplace_orders) : null;
  let revenue = b.revenue != null ? Number(b.revenue) : null;
  let rawMetrics: unknown = b.raw_metrics ?? null;
  let source = pullLive ? "adapter_pull" : "operator_manual";
  let pulledLive = false;
  const writeBlocked = !adminDb;
  const writeBlockReason = writeBlocked ? "SUPABASE_SERVICE_ROLE_KEY missing in clean pod" : null;

  if (pullLive) {
    let pulled;
    try {
      pulled = await pullLiveMetrics(readDb, {
        publicationId: b.publication_id,
        recipeId: b.recipe_id,
        externalPostId: b.external_post_id,
      });
    } catch (error) {
      return NextResponse.json({
        ok: false,
        error: `live metrics context unavailable: ${safeError(error)}`,
        pulled_live: false,
        context_lookup_blocked: true,
      }, { status: 503 });
    }
    if (!pulled.ok || !pulled.context || !pulled.metrics) {
      return NextResponse.json({ ok: false, error: pulled.error || "live metrics pull failed", pulled_live: false }, { status: 400 });
    }

    pulledLive = true;
    recipeId = pulled.context.recipeId;
    platform = pulled.context.platform || platform;
    publicationId = pulled.context.publicationId || publicationId;
    externalPostId = pulled.context.externalPostId || externalPostId;

    const metricRow = metricSnapshotToRow(pulled.metrics);
    views = metricRow.views;
    watchRate = metricRow.watchRate;
    completionRate = metricRow.completionRate;
    saves = metricRow.saves;
    engagementCount = metricRow.engagementCount;
    marketplaceOrders = metricRow.marketplaceOrders;
    revenue = metricRow.revenue;
    rawMetrics = metricRow.rawMetrics;
  }

  let publicationContext = null;
  if (publicationId || externalPostId || !recipeId) {
    try {
      publicationContext = await findPublicationContext(readDb, { publicationId: b.publication_id, externalPostId: b.external_post_id });
    } catch (error) {
      return NextResponse.json({
        ok: false,
        error: `publication context unavailable: ${safeError(error)}`,
        context_lookup_blocked: true,
        write_blocked: writeBlocked,
        write_block_reason: writeBlockReason,
      }, { status: 503 });
    }
  }

  if (!recipeId) recipeId = publicationContext?.recipeId || 0;
  if ((!platform || platform === "tiktok") && publicationContext?.platform) platform = publicationContext.platform;
  if (!publicationId && publicationContext?.publicationId) publicationId = publicationContext.publicationId;
  if (!externalPostId && publicationContext?.externalPostId) externalPostId = publicationContext.externalPostId;

  if (!recipeId) return NextResponse.json({ ok: false, error: "нужен recipe_id или publication_id/external_post_id" }, { status: 400 });
  if (!views) return NextResponse.json({ ok: false, error: "нужны просмотры или pull_live:true" }, { status: 400 });

  if (!adminDb) {
    if (!pullLive) {
      return NextResponse.json({
        ok: false,
        error: "write-path недоступен: нужен SUPABASE_SERVICE_ROLE_KEY",
        write_blocked: true,
        write_block_reason: writeBlockReason,
      }, { status: 503 });
    }
    return NextResponse.json({
      ok: true,
      pulled_live: pulledLive,
      publication_id: publicationId,
      external_post_id: externalPostId,
      recipe_id: recipeId,
      platform,
      views,
      metrics_saved: false,
      metrics_save_mode: null,
      metrics_save_error: writeBlockReason,
      forwarded: false,
      forwarded_error: writeBlockReason,
      forwarded_payload: null,
      source,
      write_blocked: true,
      write_block_reason: writeBlockReason,
    });
  }

  const saved = await savePostMetrics(adminDb, {
    recipeId,
    platform,
    publicationId,
    externalPostId,
    postedAt: b.posted_at || new Date().toISOString(),
    views,
    watchRate,
    completionRate,
    ctrCard,
    saves,
    engagementCount,
    marketplaceOrders,
    revenue,
    source,
    rawMetrics,
  });

  const forwarded = await forwardWinnerFromRecipe(req.nextUrl.origin, adminDb, {
    recipeId,
    platform,
    views,
    note: `рынок: ${views} просм · ${platform}${pulledLive ? " · pulled live" : ""}`,
  });

  return NextResponse.json({
    ok: true,
    pulled_live: pulledLive,
    publication_id: publicationId,
    external_post_id: externalPostId,
    recipe_id: recipeId,
    platform,
    views,
    metrics_saved: saved.ok,
    metrics_save_mode: saved.mode,
    metrics_save_error: saved.error,
    forwarded: forwarded.forwarded,
    forwarded_error: forwarded.error,
    forwarded_payload: forwarded.payload ?? null,
    source,
    write_blocked: false,
    write_block_reason: null,
  });
}
