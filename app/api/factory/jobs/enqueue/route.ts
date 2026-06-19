import { NextRequest, NextResponse, after } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { createJob } from "@/lib/factory/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Поставить генерации в СЕРВЕРНУЮ очередь — после этого кокпит можно закрыть, тики доведут.
// POST { jobs: [{article, hook, mode}, ...] }  ИЛИ  { article, hook, mode }
export async function POST(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const body = await req.json().catch(() => ({}));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any[] = Array.isArray(body.jobs) ? body.jobs : (body.hook || body.concept || body.article ? [body] : []);
  const items = raw
    .map((j) => ({ article: (j.article || j.sku_art || "").toString().slice(0, 40), hook: (j.hook || j.concept || "").toString().slice(0, 300), mode: j.mode }))
    .filter((j) => j.hook || j.article)
    .slice(0, 20);
  if (!items.length) return NextResponse.json({ error: "нужен hook/article" }, { status: 400 });

  const ids: string[] = [];
  for (const it of items) { const id = await createJob(db, it); if (id) ids.push(id); }
  if (!ids.length) return NextResponse.json({ error: "не удалось создать джобы" }, { status: 502 });

  // разбудить цепочку тиков ПОСЛЕ ответа (Vercel держит функцию через waitUntil)
  const origin = req.nextUrl.origin;
  after(async () => { try { await fetch(`${origin}/api/factory/jobs/tick`, { method: "POST", signal: AbortSignal.timeout(8000) }); } catch { /* подхватит list-резурекция или следующий enqueue */ } });

  return NextResponse.json({ queued: ids.length, ids });
}
