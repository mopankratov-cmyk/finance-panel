import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/sync/helpers";
import { internalFetch } from "@/lib/internalFetch";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { generateInsights } from "@/lib/agent/rules";

// Последовательный прогон всех синков — один cron-слот (Hobby) и кнопка «обновить всё».
// Порядок важен:
//  - adverts до advert-stats (статистика читает живые кампании из wb_adverts);
//  - funnel ПЕРЕД advert-stats: у advert-stats паузы 61с/батч (WB 1 req/min), они съедают
//    60с-бюджет функции, и воронка не доходит. Воронка аналитически важнее → идёт раньше.
const JOBS = ["orders", "sales", "stocks", "adverts", "funnel", "advert-stats", "supplies-sheet"] as const;

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const secret = process.env.CRON_SECRET;
  const base = new URL(request.url).origin;
  const headers: Record<string, string> = secret ? { Authorization: `Bearer ${secret}` } : {};

  const results: Record<string, unknown> = {};
  for (const job of JOBS) {
    try {
      const res = await fetch(`${base}/api/sync/${job}`, { headers, cache: "no-store" });
      results[job] = { status: res.status, ...(await res.json().catch(() => ({}))) };
    } catch (err) {
      results[job] = { error: err instanceof Error ? err.message : "Unknown error" };
    }
  }

  // После синхронизации — пересобрать правиловые алерты «что требует внимания»
  try {
    const db = getSupabaseAdmin();
    if (db) {
      const drafts = await generateInsights();
      await db.from("agent_insights").delete().filter("data->>src", "eq", "rules");
      if (drafts.length) await db.from("agent_insights").insert(drafts.map((d) => ({ ...d, is_read: false })));
      results["insights"] = { generated: drafts.length };
    }
  } catch (err) {
    results["insights"] = { error: err instanceof Error ? err.message : "Unknown error" };
  }

  // Бэкстоп серверной очереди генераций: будим тик — разгрести зависшие джобы, если цепочка тиков оборвалась.
  try {
    await internalFetch(`${base}/api/factory/jobs/tick`, { method: "POST", cache: "no-store", signal: AbortSignal.timeout(20000) });
    results["factory_jobs_tick"] = { woke: true };
  } catch (err) {
    results["factory_jobs_tick"] = { error: err instanceof Error ? err.message : "Unknown error" };
  }

  return NextResponse.json({ ok: true, results });
}
