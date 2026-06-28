import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildFeedbackQueue, nextAnalysisForFeedback, type FeedbackQueueAction } from "@/lib/factory/feedbackQueue";
import { nicheFromArticle } from "@/lib/factory/rubric";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function authOk(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || "";
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}

function text(value: unknown, max = 180): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function positiveInt(value: unknown, fallback: number, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, n);
}

export async function GET(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    const { searchParams } = req.nextUrl;
    const limit = positiveInt(searchParams.get("limit"), 20, 100);
    const includeTrash = searchParams.get("include_trash") === "1" || searchParams.get("include_trash") === "true";
    const niche = text(searchParams.get("niche"), 80);

    let q = db
      .from("content_assets")
      .select("id,name,url,niche,article,analysis,is_winner,winner_at,created_at")
      .eq("disk", "gen")
      .eq("kind", "video")
      .order("created_at", { ascending: false })
      .limit(500);
    if (niche) q = q.eq("niche", niche);

    const { data, error } = await q;
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const queue = buildFeedbackQueue((data || []) as Record<string, unknown>[], { includeTrash, limit });
    return NextResponse.json({
      ok: true,
      queue,
      total_candidates: queue.length,
      next_actions: queue.length
        ? ["mark at least 3 true winners before the next broad learning batch", "reject obvious trash so pattern selection stops learning from it"]
        : ["run memory-quality first or reconcile generated videos into content_assets"],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      queue: [],
      total_candidates: 0,
      error: "feedback-queue GET crash: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    const body = await req.json().catch(() => ({}));
    const assetId = Number(body.asset_id) || 0;
    const action = text(body.action, 20).toLowerCase() as FeedbackQueueAction;
    const reason = text(body.reason, 220) || (action === "winner" ? "operator marked winner" : "operator rejected from feedback queue");
    if (!assetId) return NextResponse.json({ ok: false, error: "нужен asset_id" }, { status: 400 });
    if (action !== "winner" && action !== "reject") return NextResponse.json({ ok: false, error: "action должен быть winner или reject" }, { status: 400 });

    const { data: asset, error: loadError } = await db
      .from("content_assets")
      .select("id,name,url,niche,article,analysis")
      .eq("id", assetId)
      .maybeSingle();
    if (loadError) return NextResponse.json({ ok: false, error: loadError.message }, { status: 500 });
    if (!asset) return NextResponse.json({ ok: false, error: "asset не найден" }, { status: 404 });

    const nextAnalysis = nextAnalysisForFeedback((asset.analysis || {}) as Record<string, unknown>, action, reason);
    const update: Record<string, unknown> = { analysis: nextAnalysis };
    if (action === "winner") {
      update.is_winner = true;
      update.winner_at = new Date().toISOString();
      update.winner_learnings = {
        hook: text((asset.analysis as Record<string, unknown> | null)?.hook || asset.name, 120),
        note: reason,
        source: "operator_feedback_queue",
      };
    }

    const { error: updateError } = await db.from("content_assets").update(update).eq("id", assetId);
    if (updateError) return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });

    if (action === "winner") {
      try {
        const hook = text((asset.analysis as Record<string, unknown> | null)?.hook || asset.name, 120);
        if (hook) {
          const niche = text(asset.niche, 80) || nicheFromArticle(text(asset.article, 80), text(asset.name, 120));
          await db.from("viral_hooks").upsert(
            { niche, hook_text: hook, viability_score: 5, effectiveness_notes: `operator winner: ${reason}`.slice(0, 200) },
            { onConflict: "niche,hook_text", ignoreDuplicates: false },
          );
        }
      } catch {
        // Learning seed is best-effort; the asset label is the source of truth.
      }
    } else {
      try {
        await db.from("cf_signals").insert({
          event: "rejected",
          reason_chip: reason.slice(0, 80),
          niche: text(asset.niche, 80) || null,
          article: text(asset.article, 80) || null,
          mode: "operator_feedback_queue",
        });
      } catch {
        // Optional feedback table may be absent in older environments.
      }
    }

    return NextResponse.json({ ok: true, asset_id: assetId, action, memory_label: action === "winner" ? "winner" : "trash" });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "feedback-queue POST crash: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500 });
  }
}
