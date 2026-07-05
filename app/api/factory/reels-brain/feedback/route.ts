import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { internalFetch } from "@/lib/internalFetch";
import { buildReelsBrainFeedbackLoop, type ReelsBrainMetricRow } from "@/lib/factory/reelsBrainOperatingSystem";
import { loadReelsBrainFeedbackRows } from "@/lib/factory/reelsBrainFeedbackRows";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function bool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const raw = text(value).toLowerCase();
  if (!raw) return null;
  if (["1", "true", "yes", "ready", "high"].includes(raw)) return true;
  if (["0", "false", "no", "not_ready", "low"].includes(raw)) return false;
  return null;
}

function feedbackRawMetrics(body: Record<string, unknown>) {
  const measurementId = text(body.measurement_id);
  const validationTaskId = text(body.validation_task_id) || text(body.task_id);
  const proofScope = text(body.proof_scope);
  const highTrustGenerationReady = bool(body.high_trust_generation_ready);
  return {
    ...(body.raw_metrics && typeof body.raw_metrics === "object" ? body.raw_metrics as Record<string, unknown> : {}),
    ...(measurementId ? { measurement_id: measurementId } : {}),
    ...(validationTaskId ? { validation_task_id: validationTaskId } : {}),
    ...(proofScope ? { proof_scope: proofScope } : {}),
    ...(highTrustGenerationReady != null ? { high_trust_generation_ready: highTrustGenerationReady } : {}),
  };
}

async function loadRows(): Promise<{ rows: ReelsBrainMetricRow[]; warning: string | null }> {
  const db = getSupabaseAdmin();
  if (!db) return { rows: [], warning: "Supabase не настроен" };
  return loadReelsBrainFeedbackRows(db as any, 300) as Promise<{ rows: ReelsBrainMetricRow[]; warning: string | null }>;
}

export async function GET() {
  const { rows, warning } = await loadRows();
  return NextResponse.json({
    ok: true,
    feedback_loop: buildReelsBrainFeedbackLoop(rows),
    rows: rows.slice(0, 50),
    warning,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!Number(body.recipe_id)) {
      return NextResponse.json({ ok: false, error: "нужен recipe_id опубликованного ролика" }, { status: 400 });
    }
    if (!Number(body.views)) {
      return NextResponse.json({ ok: false, error: "нужны views, чтобы Reels Brain понял outcome" }, { status: 400 });
    }
    const response = await internalFetch(`${req.nextUrl.origin}/api/factory/post-metrics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...body,
        source: body.source || "reels_brain_feedback",
        raw_metrics: feedbackRawMetrics(body),
      }),
      signal: AbortSignal.timeout(25000),
    });
    const result = await response.json().catch(() => ({}));
    const { rows, warning } = await loadRows();
    return NextResponse.json({
      ok: response.ok && (result as { ok?: boolean }).ok !== false,
      post_metrics: result,
      feedback_loop: buildReelsBrainFeedbackLoop(rows),
      warning,
    }, { status: response.ok ? 200 : 500, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "reels-brain feedback crash: " + String((error as Error)?.message || error).slice(0, 160) }, { status: 500 });
  }
}
