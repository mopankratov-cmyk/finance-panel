import { NextResponse } from "next/server";
import { creatifyStatus } from "@/lib/factory/creatify";

export const dynamic = "force-dynamic";

// Статус UGC-видео (Creatify): token зашит в task_id (cf.<base64url>). Stateless.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const token = id.startsWith("cf.") ? id.slice(3) : "";
    if (!token) return NextResponse.json({ status: "error", error: "плохой task_id" });
    const s = await creatifyStatus(token);
    if (s.status === "done") return NextResponse.json({ status: "done", video_url: s.videoUrl, progress: "" });
    if (s.status === "error") return NextResponse.json({ status: "failed", error: s.error });
    if (s.status === "preview_ready") return NextResponse.json({ status: "preview_ready", preview_url: s.previewUrl, progress: "превью готово — можно запускать render" });
    return NextResponse.json({ status: "rendering", progress: "рендер UGC-актёра (Creatify)…" });
  } catch (e) {
    return NextResponse.json({ status: "error", error: "ugc-creatify-status crash: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
