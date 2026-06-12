import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/sync/helpers";

// Последовательный прогон всех синков — один cron-слот (Hobby) и кнопка «обновить всё».
// Порядок важен: adverts до advert-stats (статистика читает живые кампании из wb_adverts).
const JOBS = ["orders", "sales", "stocks", "adverts", "advert-stats", "funnel"] as const;

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

  return NextResponse.json({ ok: true, results });
}
