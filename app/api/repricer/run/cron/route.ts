import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/sync/helpers";
import { getActiveWbCabinets } from "@/lib/wb/cabinetTokens";
import { loadStrategies, runRepricer, persistDecisions } from "@/lib/repricer/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET — крон-прогон репрайсера по всем активным кабинетам (защита CRON_SECRET).
// Расписание: после /api/sync/all (свежие данные). Привязку в vercel.json делает владелец.
export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;

  const strategies = await loadStrategies();
  if (!strategies.length) return NextResponse.json({ skipped: "нет стратегий (миграция не применена?)" });

  const runDate = new Date().toISOString().slice(0, 10);
  const cabs = await getActiveWbCabinets();
  const targets: (string | null)[] = cabs.length ? cabs.map((c) => c.id) : [null];
  const results: Record<string, unknown> = {};
  for (const cab of targets) {
    try {
      const rows = await runRepricer(cab, strategies);
      const proposed = await persistDecisions(runDate, cab, rows);
      results[cab ?? "all"] = { total: rows.length, proposed };
    } catch (e) {
      results[cab ?? "all"] = { error: String((e as Error)?.message || e) };
    }
  }
  return NextResponse.json({ runDate, results });
}
