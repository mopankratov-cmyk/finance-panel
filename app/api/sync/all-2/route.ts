import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/sync/helpers";

// Второй cron-слот: джобы, которые не влезали в /api/sync/all, потому что funnel
// (в своём отдельном слоте — см. vercel.json) занимала весь 60с-бюджет функции.
// Ни commissions, ни feedbacks не делают внутренних пауз на rate-limit, поэтому
// вдвоём укладываются в один 60с-вызов.
const JOBS = ["commissions", "feedbacks"] as const;

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
