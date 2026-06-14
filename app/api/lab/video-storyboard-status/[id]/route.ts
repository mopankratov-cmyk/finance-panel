import { NextResponse } from "next/server";
import { getVideo } from "@/lib/lab/videoStore";

export const dynamic = "force-dynamic";
const HF_BASE = "https://platform.higgsfield.ai";

async function pollHf(jobId: string) {
  const credentials = process.env.HF_CREDENTIALS;
  if (!credentials) return null;
  try {
    const r = await fetch(`${HF_BASE}/v1/job-sets/${jobId}`, { headers: { Authorization: `Key ${credentials}` }, cache: "no-store", signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    const js = (await r.json()) as { jobs?: { status: string; results: { raw?: { url: string }; min?: { url: string } } | null }[] };
    return js.jobs?.[0] ?? null;
  } catch { return null; }
}

// Статус видео-сториборда: сценарий + видео (frames=[url]) когда готово.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // stateless: hfJobId декодируется из task_id; стор — фолбэк (для старых id/recover)
  let hfJobId = "";
  if (id.startsWith("hf.")) { try { hfJobId = Buffer.from(id.slice(3), "base64url").toString("utf8"); } catch { /* */ } }
  const t = getVideo(id);
  if (!hfJobId && t) hfJobId = t.hfJobId;
  if (!hfJobId) return NextResponse.json({ status: "error", error: "задача не найдена" });
  const base = { scenario_title: t?.scenario_title, beats: t?.beats, script: t?.script };
  const job = await pollHf(hfJobId);
  if (!job) return NextResponse.json({ ...base, status: "rendering", progress: "рендер видео…" });
  if (job.status === "completed") {
    const url = job.results?.raw?.url ?? job.results?.min?.url ?? null;
    return NextResponse.json({ ...base, status: "done", frames: url ? [url] : [], video_url: url, progress: "" });
  }
  if (job.status === "failed" || job.status === "nsfw") return NextResponse.json({ ...base, status: "failed", error: job.status === "nsfw" ? "отклонено модерацией" : "рендер не удался" });
  return NextResponse.json({ ...base, status: "rendering", progress: "рендер видео…" });
}
