import { NextResponse } from "next/server";
import { falVideoStatus } from "@/lib/factory/falVideo";

export const dynamic = "force-dynamic";

// Статус премиум-видео (FAL): token зашит в task_id (fv.<base64url>). Stateless.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const token = id.startsWith("fv.") ? id.slice(3) : "";
    if (!token) return NextResponse.json({ status: "error", error: "плохой task_id" });
    const s = await falVideoStatus(token);
    if (s.status === "done") return NextResponse.json({ status: "done", video_url: s.videoUrl, progress: "" });
    if (s.status === "error") return NextResponse.json({ status: "failed", error: s.error });
    return NextResponse.json({ status: "rendering", progress: "рендер видео (FAL/Kling)…" });
  } catch (e) {
    return NextResponse.json({ status: "error", error: "video-fal-status crash: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
