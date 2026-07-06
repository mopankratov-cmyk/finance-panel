import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildPublicationPlan } from "@/lib/factory/distribution";
import { readComplianceMetadata } from "@/lib/factory/distributionTargets";
import { getChannelAdapter, toPublishTarget } from "@/lib/factory/publishAdapters";
import { recordFactoryPublication } from "@/lib/factory/publications";
import type { PublishMeta } from "@/lib/factory/publishAdapters/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function text(value: unknown, max = 1000): string | null {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function hashtags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => text(item, 80)).filter(Boolean) as string[];
  return String(value || "")
    .split(/[,\n]/)
    .map((item) => text(item, 80))
    .filter(Boolean) as string[];
}

export async function POST(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const recipeId = Math.floor(Number(body.recipe_id) || 0);
    const warnings: string[] = [];

    let sourceUrl = text(body.source_url || body.url || body.output_url, 1200);
    if (!sourceUrl && recipeId) {
      try {
        const { data, error } = await db.from("node_recipes").select("output_url").eq("id", recipeId).limit(1);
        if (error) warnings.push("node_recipes lookup: " + error.message.slice(0, 140));
        sourceUrl = text((data as { output_url?: string | null }[] | null)?.[0]?.output_url, 1200);
      } catch (error) {
        warnings.push("node_recipes lookup exception: " + String((error as Error)?.message || error).slice(0, 120));
      }
    }

    const plan = buildPublicationPlan({
      recipeId,
      sourceUrl,
      publishedUrl: body.published_url || body.post_url,
      externalPostId: body.external_post_id || body.post_id,
      platform: body.platform || body.target_platform,
      mode: body.mode,
      status: body.status,
      adToken: body.ad_token,
      scheduledAt: body.scheduled_at,
    });
    if (!plan.ok) {
      return NextResponse.json({ ok: false, error: plan.error, plan, warnings }, { status: plan.statusCode });
    }

    const transport = text(body.transport, 40)?.toLowerCase() || "";
    const shouldDispatchApi = transport === "api";
    let publishResult: { ok: boolean; external_post_id?: string; published_url?: string; detail?: string; failure?: string } | null = null;
    let finalStatus = plan.status;
    let finalPublishedUrl = plan.publishedUrl;
    let finalExternalPostId = plan.externalPostId;

    if (shouldDispatchApi) {
      const targetId = text(body.target_id, 120);
      if (!targetId) {
        return NextResponse.json({ ok: false, error: "api transport requires target_id", plan, warnings }, { status: 400 });
      }
      const adapter = getChannelAdapter(plan.platform);
      if (!adapter || adapter.transport !== "api") {
        return NextResponse.json({ ok: false, error: `no api adapter for ${plan.platform}`, plan, warnings }, { status: 400 });
      }
      const { data: targetRows, error: targetError } = await db
        .from("factory_distribution_targets")
        .select("id,platform,account_ref,mode,config")
        .eq("id", targetId)
        .limit(1);
      if (targetError) {
        return NextResponse.json({ ok: false, error: `target lookup: ${targetError.message.slice(0, 140)}`, plan, warnings }, { status: 502 });
      }
      const targetRow = (targetRows as Record<string, unknown>[] | null)?.[0] || null;
      if (!targetRow) {
        return NextResponse.json({ ok: false, error: "target not found", plan, warnings }, { status: 404 });
      }
      const target = toPublishTarget(targetRow);
      const auth = await adapter.authSession(target);
      if (auth !== "OK") {
        return NextResponse.json({ ok: false, error: `adapter auth: ${auth}`, plan, warnings }, { status: 409 });
      }

      const meta: PublishMeta = {
        caption: text(body.caption, 500) || "",
        hashtags: hashtags(body.hashtags),
        articles: hashtags(body.articles),
        ad_token: text(body.ad_token, 240),
      };

      publishResult = await adapter.publish({
        recipe_id: plan.recipeId,
        article: text(body.article, 60),
        video_path_or_url: plan.sourceUrl || "",
        cover_path: text(body.cover_path || body.cover_url, 1200) || undefined,
      }, meta, target);

      if (!publishResult.ok) {
        finalStatus = "failed";
      } else {
        finalStatus = "published";
        finalPublishedUrl = publishResult.published_url || plan.publishedUrl;
        finalExternalPostId = publishResult.external_post_id || plan.externalPostId;
      }
    }

    const publication = await recordFactoryPublication(db, {
      recipeId: plan.recipeId,
      ugcJobId: text(body.ugc_job_id, 120),
      targetId: text(body.target_id, 120),
      sourceUrl: plan.sourceUrl,
      platform: plan.platform,
      mode: plan.mode,
      status: finalStatus,
      publishedUrl: finalPublishedUrl,
      externalPostId: finalExternalPostId,
      adTokenPresent: plan.adTokenPresent,
      scheduledAt: plan.scheduledAt,
      error: publishResult && !publishResult.ok ? text(publishResult.detail || publishResult.failure, 500) : null,
      metadata: {
        source: "publish_route",
        requested_mode: plan.mode,
        requested_status: plan.status,
        transport: shouldDispatchApi ? "api" : "record_only",
        metrics_pollable: plan.metricsPollable,
        ad_token_present: plan.adTokenPresent,
        worker_box_id: text(body.worker_box_id, 120),
        attempt: Math.max(1, Math.floor(Number(body.attempt) || 1)),
        adapter_failure: publishResult && !publishResult.ok ? publishResult.failure || null : null,
        ...readComplianceMetadata(body),
      },
    });
    if (publication.warning) warnings.push(publication.warning);
    if (!publication.id) {
      return NextResponse.json({ ok: false, error: publication.warning || "publication ledger write failed", plan, warnings }, { status: 502 });
    }

    if (publishResult && !publishResult.ok) {
      return NextResponse.json({
        ok: false,
        publication_id: publication.id,
        status: publication.status,
        platform: plan.platform,
        mode: plan.mode,
        error: publishResult.detail || publishResult.failure || "adapter publish failed",
        warnings: [...warnings, ...plan.warnings],
      }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      publication_id: publication.id,
      status: publication.status,
      platform: plan.platform,
      mode: plan.mode,
      published_url: finalPublishedUrl,
      external_post_id: finalExternalPostId,
      metrics_pollable: plan.metricsPollable,
      warnings: [...warnings, ...plan.warnings],
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: "publish crash: " + String((error as Error)?.message || error).slice(0, 180),
    }, { status: 500 });
  }
}
