import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const HG_BASE = "https://api.heygen.com";

// Статус AI-аватар видео (stateless): video_id декодируется из task_id (av.<base64url>),
// poll v1/video_status.get → video_url когда completed. Стор не нужен (serverless-инстансы не делят память).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let videoId = "";
  try { if (id.startsWith("av.")) videoId = Buffer.from(id.slice(3), "base64url").toString("utf8"); } catch { /* */ }
  if (!videoId) return NextResponse.json({ status: "error", error: "плохой task_id" });
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) return NextResponse.json({ status: "error", error: "HEYGEN_API_KEY не настроен" });
  try {
    const r = await fetch(`${HG_BASE}/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`, {
      headers: { "X-Api-Key": apiKey }, cache: "no-store", signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return NextResponse.json({ status: "rendering", progress: "рендер аватара…" });
    const j = (await r.json()) as { data?: { status?: string; video_url?: string; error?: { message?: string } } };
    const st = j.data?.status;
    if (st === "completed") return NextResponse.json({ status: "done", video_url: j.data?.video_url ?? null, progress: "" });
    if (st === "failed") return NextResponse.json({ status: "failed", error: j.data?.error?.message || "рендер не удался" });
    return NextResponse.json({ status: "rendering", progress: "рендер аватара…" });
  } catch {
    return NextResponse.json({ status: "rendering", progress: "рендер аватара…" });
  }
}
