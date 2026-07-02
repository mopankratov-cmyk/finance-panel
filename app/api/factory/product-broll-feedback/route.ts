import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import {
  summarizeProductBrollFeedback,
  type ProductBrollHumanVerdict,
  type ProductBrollRejectReason,
} from "@/lib/factory/productBrollLearning";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function text(value: unknown, max = 180): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function reasons(value: unknown): ProductBrollRejectReason[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item, 40)).filter(Boolean).slice(0, 8) as ProductBrollRejectReason[];
}

function verdict(value: unknown): ProductBrollHumanVerdict | null {
  const raw = text(value, 20).toLowerCase();
  return raw === "winner" || raw === "usable" || raw === "weak" || raw === "reject" ? raw : null;
}

export async function POST(req: NextRequest) {
  try {
    if (!(await isAuthorizedReelsBrainJobRequest(req))) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });

    const body = await req.json().catch(() => ({}));
    const article = text(body.article, 80);
    const twinId = text(body.twin_id || body.twinId, 140);
    const assetId = text(body.asset_id || body.assetId, 180);
    const viewId = text(body.view_id || body.viewId, 80);
    const taskId = text(body.task_id || body.taskId, 180);
    const nextVerdict = verdict(body.verdict);
    if (!article && !twinId && !assetId && !viewId) return NextResponse.json({ ok: false, error: "нужен article/twin_id/asset_id/view_id" }, { status: 400 });
    if (!nextVerdict) return NextResponse.json({ ok: false, error: "verdict должен быть winner, usable, weak или reject" }, { status: 400 });

    let query = db.from("content_assets")
      .select("id,name,url,niche,article,analysis,created_at")
      .eq("disk", "product_twin")
      .not("url", "is", null)
      .order("created_at", { ascending: false })
      .limit(120);
    if (article) query = query.eq("article", article);

    const { data, error } = await query;
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const rows = ((data || []) as Record<string, unknown>[]);
    const row = rows.find((candidate) => {
      const analysis = (candidate.analysis || {}) as Record<string, unknown>;
      const tw = (analysis.product_twin || {}) as Record<string, unknown>;
      const asset = (analysis.product_twin_asset || {}) as Record<string, unknown>;
      const view = (analysis.product_twin_view_asset || {}) as Record<string, unknown>;
      if (assetId && text(asset.asset_id, 180) === assetId) return true;
      if (viewId && text(view.view_id, 80) === viewId) return true;
      if (twinId && text(tw.twin_id, 140) === twinId && !assetId && !viewId) return true;
      return false;
    }) || null;
    if (!row) return NextResponse.json({ ok: false, error: "product twin asset не найден" }, { status: 404 });

    const feedback = summarizeProductBrollFeedback({
      verdict: nextVerdict,
      reasons: reasons(body.reasons),
      score: body.score as number | null,
      note: text(body.note, 240),
    });
    const analysis = { ...((row.analysis || {}) as Record<string, unknown>) };
    const history = Array.isArray(analysis.product_broll_feedback) ? analysis.product_broll_feedback as unknown[] : [];
    analysis.product_broll_feedback = [{
      ...feedback,
      article: article || text(row.article, 80) || null,
      twin_id: twinId || null,
      asset_id: assetId || null,
      view_id: viewId || null,
      task_id: taskId || null,
      at: new Date().toISOString(),
      source: "product_twin_studio",
    }, ...history].slice(0, 20);
    analysis.product_broll_learning = {
      last_verdict: feedback.verdict,
      last_score: feedback.score,
      last_reasons: feedback.reasons,
      next_action: feedback.next_action,
      updated_at: new Date().toISOString(),
    };

    const { error: updateError } = await db.from("content_assets").update({ analysis }).eq("id", row.id);
    if (updateError) return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });

    try {
      await db.from("cf_signals").insert({
        event: nextVerdict === "winner" || nextVerdict === "usable" ? "approved" : "rejected",
        reason_chip: (feedback.reasons[0] || feedback.verdict).slice(0, 80),
        niche: text(row.niche, 80) || null,
        article: article || text(row.article, 80) || null,
        mode: "product_broll_feedback",
      });
    } catch {
      // Optional learning table is best-effort.
    }

    return NextResponse.json({ ok: true, asset_row_id: row.id, feedback });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "product-broll-feedback crash: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500 });
  }
}
