import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const HF_BASE = "https://platform.higgsfield.ai";

interface SoulJob {
  status: "queued" | "in_progress" | "completed" | "failed" | "nsfw";
  results: { raw?: { url: string }; min?: { url: string } } | null;
}

// Статус задачи генерации видео. UI опрашивает, пока не completed.
export async function GET(request: NextRequest) {
  const credentials = process.env.HF_CREDENTIALS;
  if (!credentials) return NextResponse.json({ error: "HF_CREDENTIALS не настроен" }, { status: 500 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Нужен id" }, { status: 400 });

  try {
    const res = await fetch(`${HF_BASE}/v1/job-sets/${id}`, {
      headers: { Authorization: `Key ${credentials}` },
      cache: "no-store",
    });
    if (!res.ok) return NextResponse.json({ error: `Higgsfield ${res.status}` }, { status: 502 });
    const js = (await res.json()) as { jobs?: SoulJob[] };
    const job = js.jobs?.[0];
    const videoUrl = job?.status === "completed" ? job.results?.raw?.url ?? job.results?.min?.url ?? null : null;
    return NextResponse.json({ status: job?.status ?? "unknown", videoUrl });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "error" }, { status: 500 });
  }
}
