import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getSupabaseReadClient } from "@/lib/supabaseAdmin";
import { runPublishNow } from "@/lib/factory/publishNow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const adminDb = getSupabaseAdmin();
  const readDb = adminDb || getSupabaseReadClient();
  const body = await req.json().catch(() => ({}));

  const result = await runPublishNow({
    readDb,
    writeDb: adminDb,
    body: {
      recipeId: body.recipe_id,
      article: body.article,
      videoPathOrUrl: body.video_path_or_url || body.video_url || body.source_url,
      coverPath: body.cover_path || body.cover_url,
      caption: body.caption,
      hashtags: body.hashtags,
      articles: body.articles,
      adToken: body.ad_token,
      targetId: body.target_id,
      target: body.target,
      sourceUrl: body.source_url,
      metadata: body.metadata,
    },
  });

  if (!result.ok) {
    return NextResponse.json({
      ok: false,
      error: result.error,
      warnings: result.warnings,
      auth: result.auth || null,
      adapter: result.adapter ? {
        platform: result.adapter.platform,
        transport: result.adapter.transport,
        capabilities: result.adapter.capabilities,
      } : null,
      target: result.target ? {
        target_id: result.target.target_id,
        platform: result.target.platform,
        account_ref: result.target.account_ref,
        mode: result.target.mode,
      } : null,
      published: result.published || null,
    }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    warnings: result.warnings,
    auth: result.auth,
    adapter: {
      platform: result.adapter.platform,
      transport: result.adapter.transport,
      capabilities: result.adapter.capabilities,
    },
    target: {
      target_id: result.target.target_id,
      platform: result.target.platform,
      account_ref: result.target.account_ref,
      mode: result.target.mode,
    },
    published: result.published,
    persisted: result.persisted,
    write_blocked: !result.persisted.persisted,
    write_block_reason: result.persisted.persisted ? null : result.persisted.warning,
  });
}
