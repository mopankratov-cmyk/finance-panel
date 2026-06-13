import { NextResponse } from "next/server";
import { getVideo } from "@/lib/lab/videoStore";

export const dynamic = "force-dynamic";
const HF_BASE = "https://platform.higgsfield.ai";

// Дозабрать готовое видео по задаче (без повторной генерации).
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const t = getVideo(id);
  if (!t) return NextResponse.json({ ok: false, error: "задача не найдена" });
  const credentials = process.env.HF_CREDENTIALS;
  if (!credentials) return NextResponse.json({ ok: false, error: "HF не настроен" });
  try {
    const r = await fetch(`${HF_BASE}/v1/job-sets/${t.hfJobId}`, { headers: { Authorization: `Key ${credentials}` }, cache: "no-store", signal: AbortSignal.timeout(20000) });
    if (!r.ok) return NextResponse.json({ ok: false, error: `HF ${r.status}` });
    const js = (await r.json()) as { jobs?: { status: string; results: { raw?: { url: string }; min?: { url: string } } | null }[] };
    const job = js.jobs?.[0];
    const url = job?.results?.raw?.url ?? job?.results?.min?.url ?? null;
    return NextResponse.json({ ok: true, frames: url ? [url] : [], missing: url ? 0 : 1, script: t.script, gate: null });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e).slice(0, 120) });
  }
}
