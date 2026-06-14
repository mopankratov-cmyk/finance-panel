import { NextResponse } from "next/server";
import { getAvatar } from "@/lib/lab/avatarStore";

export const dynamic = "force-dynamic";
const HG_BASE = "https://api.heygen.com";

// Статус AI-аватар видео: poll v1/video_status.get → video_url когда completed.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const t = getAvatar(id);
  if (!t) return NextResponse.json({ status: "error", error: "задача не найдена" });
  const base = { title: t.title, spoken: t.spoken };
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) return NextResponse.json({ ...base, status: "error", error: "HEYGEN_API_KEY не настроен" });
  try {
    const r = await fetch(`${HG_BASE}/v1/video_status.get?video_id=${encodeURIComponent(t.videoId)}`, {
      headers: { "X-Api-Key": apiKey }, cache: "no-store", signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return NextResponse.json({ ...base, status: "rendering", progress: "рендер аватара…" });
    const j = (await r.json()) as { data?: { status?: string; video_url?: string; error?: { message?: string } } };
    const st = j.data?.status;
    if (st === "completed") return NextResponse.json({ ...base, status: "done", video_url: j.data?.video_url ?? null, progress: "" });
    if (st === "failed") return NextResponse.json({ ...base, status: "failed", error: j.data?.error?.message || "рендер не удался" });
    return NextResponse.json({ ...base, status: "rendering", progress: "рендер аватара…" });
  } catch {
    return NextResponse.json({ ...base, status: "rendering", progress: "рендер аватара…" });
  }
}
