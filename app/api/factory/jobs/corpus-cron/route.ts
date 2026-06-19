import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Vercel Cron entry-point для еженедельного тикера корпуса (R4).
// Авторизует по Bearer-токену (CRON_SECRET) → дёргает corpus-tick (POST) и возвращает результат.
// Добавить в vercel.json:
//   "crons": [{ "path": "/api/factory/jobs/corpus-cron", "schedule": "0 3 * * 1" }]
// (каждый понедельник в 3:00 UTC)

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const secret = process.env.CRON_SECRET || "";
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const origin = req.nextUrl.origin;
    const r = await fetch(`${origin}/api/factory/jobs/corpus-tick`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret }),
      signal: AbortSignal.timeout(55000),
    });
    const result = await r.json().catch(() => ({}));
    return NextResponse.json({ ok: true, corpus_tick: result });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 150) }, { status: 502 });
  }
}
