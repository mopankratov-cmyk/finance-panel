import { NextResponse } from "next/server";
import { creatifyStatus } from "@/lib/factory/creatify";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { recordUgcJob } from "@/lib/factory/ugcJobs";

export const dynamic = "force-dynamic";

// Статус UGC-видео (Creatify): token зашит в task_id (cf.<base64url>). Stateless.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const token = id.startsWith("cf.") ? id.slice(3) : "";
    if (!token) return NextResponse.json({ status: "error", error: "плохой task_id" });
    const s = await creatifyStatus(token);
    const ugcJob = await recordUgcJob(getSupabaseAdmin(), {
      provider: "creatify",
      token,
      status: s.status === "done" ? "done" : s.status === "error" ? "failed" : "rendering",
      dlqCategory: s.status === "error" ? "provider" : null,
      outputUrl: s.videoUrl || null,
      error: s.error || null,
      inputPayload: { source: "ugc_creatify_status", raw_status: s.raw || null },
    });
    const warnings = ugcJob.warning ? [ugcJob.warning] : [];
    if (s.status === "done") return NextResponse.json({ status: "done", video_url: s.videoUrl, ugc_job_id: ugcJob.id, warnings, progress: "" });
    if (s.status === "error") return NextResponse.json({ status: "failed", error: s.error, ugc_job_id: ugcJob.id, warnings });
    if (s.status === "preview_ready") return NextResponse.json({ status: "preview_ready", preview_url: s.previewUrl, ugc_job_id: ugcJob.id, warnings, progress: "превью готово — можно запускать render" });
    return NextResponse.json({ status: "rendering", ugc_job_id: ugcJob.id, warnings, progress: "рендер UGC-актёра (Creatify)…" });
  } catch (e) {
    return NextResponse.json({ status: "error", error: "ugc-creatify-status crash: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
