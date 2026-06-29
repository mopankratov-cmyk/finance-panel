import { NextResponse } from "next/server";
import { creatifyStartRender } from "@/lib/factory/creatify";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { recordUgcJob } from "@/lib/factory/ugcJobs";

export const dynamic = "force-dynamic";

// Явный старт рендера Creatify после готового превью.
// Статус-роут больше не дёргает платный /render/ на каждом poll.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const token = id.startsWith("cf.") ? id.slice(3) : "";
    if (!token) return NextResponse.json({ status: "error", error: "плохой task_id" }, { status: 400 });
    const s = await creatifyStartRender(token);
    const ugcJob = await recordUgcJob(getSupabaseAdmin(), {
      provider: "creatify",
      token,
      status: s.status === "error" ? "failed" : "rendering",
      dlqCategory: s.status === "error" ? "provider" : null,
      error: s.error || null,
      inputPayload: { source: "ugc_creatify_render" },
    });
    if (s.status === "error") return NextResponse.json({ status: "failed", error: s.error, ugc_job_id: ugcJob.id, warnings: ugcJob.warning ? [ugcJob.warning] : [] }, { status: 502 });
    return NextResponse.json({ status: "rendering", ugc_job_id: ugcJob.id, warnings: ugcJob.warning ? [ugcJob.warning] : [], progress: "рендер UGC-актёра (Creatify)…" });
  } catch (e) {
    return NextResponse.json({ status: "error", error: "ugc-creatify-render crash: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
