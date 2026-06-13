import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const HF_BASE = "https://platform.higgsfield.ai";

// Статус слайда воронки = поллинг Higgsfield job-set.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const credentials = process.env.HF_CREDENTIALS;
  if (!credentials || !id) return NextResponse.json({ status: "error", error: "нет id/ключа" });
  try {
    const r = await fetch(`${HF_BASE}/v1/job-sets/${id}`, { headers: { Authorization: `Key ${credentials}` }, cache: "no-store", signal: AbortSignal.timeout(20000) });
    if (!r.ok) return NextResponse.json({ status: "error", error: `HF ${r.status}` });
    const js = (await r.json()) as { jobs?: { status: string; results: { raw?: { url: string }; min?: { url: string } } | null; created_at?: string }[] };
    const job = js.jobs?.[0];
    if (!job) return NextResponse.json({ status: "error", error: "нет задачи" });
    const age = job.created_at ? Math.round((Date.now() - new Date(job.created_at).getTime()) / 1000) : null;
    if (job.status === "completed") {
      const url = job.results?.raw?.url ?? job.results?.min?.url ?? null;
      return url ? NextResponse.json({ status: "done", image_url: url, age_sec: age }) : NextResponse.json({ status: "error", error: "нет URL" });
    }
    if (job.status === "failed" || job.status === "nsfw") return NextResponse.json({ status: "failed", error: job.status === "nsfw" ? "модерация" : "не удалось" });
    return NextResponse.json({ status: "in_progress", progress: `генерю · ${age ?? "?"}с`, age_sec: age });
  } catch (e) {
    return NextResponse.json({ status: "error", error: String(e).slice(0, 120) });
  }
}
