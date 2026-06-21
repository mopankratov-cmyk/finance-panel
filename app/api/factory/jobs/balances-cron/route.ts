import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Vercel Cron entry-point для суточного снимка балансов сервисов + алерта «кончаются бабки».
// Авторизует по Bearer-токену (CRON_SECRET) → дёргает balances-tick (POST) и возвращает результат.
// Зарегистрировано в vercel.json:
//   { "path": "/api/factory/jobs/balances-cron", "schedule": "0 7 * * *" }   (каждый день в 7:00 UTC)

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const secret = process.env.CRON_SECRET || "";
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const origin = req.nextUrl.origin;
  const tick = await fetch(`${origin}/api/factory/jobs/balances-tick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret }),
    signal: AbortSignal.timeout(55000),
  }).then((r) => r.json()).catch((e) => ({ error: String(e).slice(0, 120) }));

  return NextResponse.json({ ok: true, balances_tick: tick });
}
