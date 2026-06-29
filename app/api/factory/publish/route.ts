import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildPublicationPlan } from "@/lib/factory/distribution";
import { recordFactoryPublication } from "@/lib/factory/publications";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function text(value: unknown, max = 1000): string | null {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, max) : null;
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

    const publication = await recordFactoryPublication(db, {
      recipeId: plan.recipeId,
      ugcJobId: text(body.ugc_job_id, 120),
      targetId: text(body.target_id, 120),
      sourceUrl: plan.sourceUrl,
      platform: plan.platform,
      mode: plan.mode,
      status: plan.status,
      publishedUrl: plan.publishedUrl,
      externalPostId: plan.externalPostId,
      adTokenPresent: plan.adTokenPresent,
      scheduledAt: plan.scheduledAt,
      metadata: {
        source: "publish_route",
        requested_mode: plan.mode,
        requested_status: plan.status,
        metrics_pollable: plan.metricsPollable,
        ad_token_present: plan.adTokenPresent,
      },
    });
    if (publication.warning) warnings.push(publication.warning);
    if (!publication.id) {
      return NextResponse.json({ ok: false, error: publication.warning || "publication ledger write failed", plan, warnings }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      publication_id: publication.id,
      status: publication.status,
      platform: plan.platform,
      mode: plan.mode,
      published_url: plan.publishedUrl,
      external_post_id: plan.externalPostId,
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
