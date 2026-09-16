import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { resolveCtrSearchCampaign } from "@/lib/ctrtest/campaignBinding";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const WINDOW_DAYS = 14;

/**
 * Предпросмотр поисковой кампании и её суточного трафика — для калькулятора
 * итераций в мастере создания теста, ДО того как тест вообще создан.
 *
 * Не пишет ничего в ctr_tests: та же резолюция, что при первом `start`
 * (lib/ctrtest/campaignBinding.ts), но здесь только чтение. Реальная
 * привязка происходит один раз при старте — этот роут может вызываться
 * сколько угодно раз, пока человек крутит настройки в мастере.
 */
export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const sp = new URL(request.url).searchParams;
  const nmId = Number(sp.get("nm"));
  if (!Number.isInteger(nmId) || nmId <= 0) return fail("Некорректный nm", 400);
  const { cabinetId } = await resolveShopCabinet(sp.get("cabinet") ?? undefined);
  if (!cabinetId) return fail("Выберите один реальный WB-кабинет", 400);
  if (!(await hasCabinetAccess(cabinetId))) return fail("Нет доступа к кабинету", 403);
  const mode = sp.get("mode") === "unified" ? "unified" : "search_only";
  // Человек мог выбрать кампанию в пикере руками — тогда прогноз считаем по
  // ней, а не по авторезолюции (та может найти другую при 2+ кандидатах).
  const manualAdvertId = sp.get("advert") ? Number(sp.get("advert")) : null;

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const resolution = manualAdvertId
    ? ({ status: "resolved" as const, advertId: manualAdvertId, candidates: [] })
    : await resolveCtrSearchCampaign(db, cabinetId, nmId, mode);
  if (resolution.status !== "resolved") {
    return NextResponse.json({ data: { resolution, dailyViews: null, ctrPercent: null }, error: null });
  }

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const { data } = await db
    .from("wb_advert_nm_campaign_daily")
    .select("views, clicks, date")
    .eq("cabinet_id", cabinetId)
    .eq("nm_id", nmId)
    .eq("advert_id", resolution.advertId)
    .gte("date", since);

  const rows = (data ?? []) as { views: number | null; clicks: number | null; date: string }[];
  // Среднее по дням, КОГДА кампания реально показывалась, а не по всему окну:
  // если она запущена 5 дней назад, делить на 14 занизило бы суточный трафик
  // вдвое с лишним и дал бы ложно пессимистичный план.
  const daysWithData = new Set(rows.map((row) => row.date)).size || 1;
  const totalViews = rows.reduce((sum, row) => sum + Number(row.views ?? 0), 0);
  const totalClicks = rows.reduce((sum, row) => sum + Number(row.clicks ?? 0), 0);
  const dailyViews = totalViews / daysWithData;
  const ctrPercent = totalViews > 0 ? (totalClicks / totalViews) * 100 : null;

  return NextResponse.json({ data: { resolution, dailyViews, ctrPercent }, error: null });
}
