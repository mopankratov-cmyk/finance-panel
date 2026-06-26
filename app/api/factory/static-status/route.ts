import { NextRequest, NextResponse } from "next/server";
import { remotionStatus } from "@/lib/factory/remotionRender";
import { logGeneration } from "@/lib/factory/genHistory";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Прокси статуса рендера статики для студии (браузер не ходит на render-VM напрямую — токен/CORS).
// GET ?id=<render-job-id> → { status: in_progress|done|error, videoUrl?(PNG), error?, retryable? }
export async function GET(req: NextRequest) {
  try {
    const id = (req.nextUrl.searchParams.get("id") || "").trim();
    if (!id) return NextResponse.json({ status: "error", error: "нужен id" }, { status: 400 });
    const sp = req.nextUrl.searchParams;
    const s = await remotionStatus(id);
    const historyEnabled = sp.get("log_history") !== "false";
    if (historyEnabled && s.status === "done" && s.videoUrl) {
      await logGeneration({
        tool: "remotion",
        engine: "remotion",
        node_type: "static_post",
        prompt: (sp.get("headline") || "").slice(0, 4000) || null,
        params: { task_id: id, format: sp.get("format") || null },
        output_url: s.videoUrl,
        status: "generated",
        source: "static_status",
        reason: "static_render_done",
        article: sp.get("article") || null,
        niche: sp.get("niche") || null,
      });
    } else if (historyEnabled && s.status === "error" && s.retryable === false) {
      await logGeneration({
        tool: "remotion",
        engine: "remotion",
        node_type: "static_post",
        prompt: (sp.get("headline") || "").slice(0, 4000) || null,
        params: { task_id: id, format: sp.get("format") || null },
        status: "artifact_fail",
        source: "static_status",
        reason: s.error || "static_render_failed",
        article: sp.get("article") || null,
        niche: sp.get("niche") || null,
      });
    }
    return NextResponse.json(s);
  } catch (e) {
    return NextResponse.json({ status: "error", error: "статус static-рендера упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
