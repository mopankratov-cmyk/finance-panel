import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const HF_BASE = "https://platform.higgsfield.ai";

interface SoulJob { status: string; results: { raw?: { url: string }; min?: { url: string } } | null; created_at?: string }
interface SoulJobSet { id: string; jobs: SoulJob[] }

// Статус задачи генерации изображения (Higgsfield job-set) → контракт лабы.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const credentials = process.env.HF_CREDENTIALS;
  if (!credentials) return NextResponse.json({ status: "error", error: "HF_CREDENTIALS не настроен" }, { status: 500 });
  if (!id) return NextResponse.json({ status: "error", error: "Нужен id" }, { status: 400 });

  try {
    const res = await fetch(`${HF_BASE}/v1/job-sets/${id}`, {
      headers: { Authorization: `Key ${credentials}` }, cache: "no-store", signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return NextResponse.json({ status: "error", error: `Higgsfield ${res.status}` }, { status: 502 });
    const js = (await res.json()) as SoulJobSet;
    const job = js.jobs?.[0];
    if (!job) return NextResponse.json({ status: "error", error: "нет задачи" });

    const age = job.created_at ? Math.round((Date.now() - new Date(job.created_at).getTime()) / 1000) : null;
    if (job.status === "completed") {
      const url = job.results?.raw?.url ?? job.results?.min?.url ?? null;
      if (!url) return NextResponse.json({ status: "error", error: "нет URL результата" });
      return NextResponse.json({ status: "done", image_url: url, age_sec: age });
    }
    if (job.status === "failed" || job.status === "nsfw") {
      return NextResponse.json({ status: "error", error: job.status === "nsfw" ? "отклонено модерацией" : "генерация не удалась" });
    }
    return NextResponse.json({ status: "in_progress", progress: `генерация · ${age ?? "?"}с`, age_sec: age });
  } catch (e) {
    return NextResponse.json({ status: "error", error: String(e).slice(0, 120) }, { status: 502 });
  }
}
