import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/sync/helpers";
import { runIndependentSyncJobs } from "@/lib/sync/orchestrator";

// Второй cron-слот: джобы, которые не влезали в /api/sync/all, потому что funnel
// (в своём отдельном слоте — см. vercel.json) занимала весь 60с-бюджет функции.
// Все задачи независимы, поэтому запускаем их параллельно. Ozon Seller API для
// аналитики/остатков читается live на страницах, здесь прогреваем только 6ч-кэш
// Performance-рекламы для всех активных Ozon-кабинетов.
const JOBS = ["commissions", "feedbacks", "ozon-adverts"] as const;

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;

  const secret = process.env.CRON_SECRET;
  const base = new URL(request.url).origin;
  const headers: Record<string, string> = secret ? { Authorization: `Bearer ${secret}` } : {};

  const result = await runIndependentSyncJobs(JOBS, base, headers);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
