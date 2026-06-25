import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Legacy compatibility cron entry-point для суточного снимка балансов сервисов + алерта «кончаются бабки».
// Главный execution path завода уже переведён на graph-run; этот роут остаётся как cron-совместимый бэкап.
// Авторизует по Bearer-токену (CRON_SECRET) → дёргает balances-tick (POST) и возвращает результат.
// Зарегистрировано в vercel.json:
//   { "path": "/api/factory/jobs/balances-cron", "schedule": "0 7 * * *" }   (каждый день в 7:00 UTC)

export async function GET(req: NextRequest) {
  try {
    const auth = req.headers.get("authorization") || "";
    const secret = process.env.CRON_SECRET || "";
    if (secret && auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const origin = req.nextUrl.origin;
    const tick = await internalFetch(`${origin}/api/factory/jobs/balances-tick`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret }),
      signal: AbortSignal.timeout(55000),
    }).then((r) => r.json()).catch((e) => ({ error: String(e).slice(0, 120) }));

    return NextResponse.json({ ok: true, balances_tick: tick });
  } catch (e) {
    return NextResponse.json({ error: "jobs/balances-cron crash: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
