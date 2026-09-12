import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { cabinetIdFromParam } from "@/lib/rnp/resolveShop";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { requestAllowedNmIds, requestAllowsNm } from "@/lib/wb/requestProductScope";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { loadHourlyDashboard } from "@/lib/cache/hourlyDashboard";
import { closedMoscowDates } from "@/lib/wb/sklejki";
import { buildWbFunnelDayMetrics, resolveFunnelPeriod } from "@/lib/wb/funnelMetrics";
import { ctrPaymentModel, type CtrPaymentModel } from "@/lib/wb/ctrCampaignPick";
import type { WbAdvertBlockInput } from "@/lib/wb/advertBlocks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface FunnelRow { nm_id: number; date: string; open_card: number; add_to_cart: number; orders: number; orders_sum: number }
interface AdRow { nm_id: number; date: string; views: number; clicks: number; spent: number }
interface AdCampaignRow extends AdRow { advert_id: number }
interface AdvertMetaRow extends WbAdvertBlockInput { advert_id: number }

// Контракт inferno: {metrics: {nm: {iso: {views, clicks, carts, orders_count, ctr, cr, orders_sum}}}} — посуточные дата-ячейки.
export async function GET(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ metrics: {} });

  const sp = new URL(req.url).searchParams;
  const p_cabinet = cabinetIdFromParam(sp.get("cabinet")); // null → все кабинеты
  if (!(await hasCabinetAccess(p_cabinet))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }
  const allowedNmIds = await requestAllowedNmIds(p_cabinet);
  // Произвольный период (?date_from=&date_to=) поверх дефолтных 30 закрытых дней.
  const requested = resolveFunnelPeriod(sp.get("date_from"), sp.get("date_to"));
  if (!requested.ok) return NextResponse.json({ error: requested.error }, { status: 400 });
  const since = requested.period?.start ?? closedMoscowDates(30)[0];
  // Без запрошенного периода верхней границы нет — ключ кэша остаётся прежним,
  // и снимок, прогретый кроном без дат, никуда не девается.
  const until = requested.period?.end;
  const payload = await loadHourlyDashboard(
    "wb-funnel-day-metrics",
    // Схема снимка: 4 и раньше считали CTR суммой по всем кампаниям сразу —
    // ЕРК, CPC и CPM в одной доле. Снимки той схемы переиспользовать нельзя.
    { cabinetId: p_cabinet, since, until, schema: 5 },
    // Обе выборки листаются пачками по четыре страницы: тридцать дней на
    // кабинет с сотнями товаров — это десятки тысяч строк, а каждый заход в
    // базу стоит 100–300 мс. Последовательное листание складывало их в секунды.
    async () => {
      const [funnelRows, adRows, campaignRows] = await Promise.all([
        loadAllSupabasePages<FunnelRow>((from, to) => {
          let query = db
            .from("wb_funnel_daily")
            .select("nm_id, date, open_card, add_to_cart, orders, orders_sum")
            .gte("date", since)
            .order("date", { ascending: true })
            .order("nm_id", { ascending: true })
            .range(from, to);
          if (until) query = query.lte("date", until);
          if (p_cabinet) query = query.eq("cabinet_id", p_cabinet);
          if (allowedNmIds) query = query.in("nm_id", allowedNmIds.size ? [...allowedNmIds] : [-1]);
          return query;
        }, { label: "Воронка WB", concurrency: 4 }),
        loadAllSupabasePages<AdRow>((from, to) => {
          let query = db
            .from("wb_advert_nm_daily")
            .select("nm_id, date, views, clicks, spent")
            .gte("date", since)
            .order("date", { ascending: true })
            .order("nm_id", { ascending: true })
            .range(from, to);
          if (until) query = query.lte("date", until);
          if (p_cabinet) query = query.eq("cabinet_id", p_cabinet);
          if (allowedNmIds) query = query.in("nm_id", allowedNmIds.size ? [...allowedNmIds] : [-1]);
          return query;
        }, { label: "Реклама WB", concurrency: 4 }),
        // Разрез по кампаниям — только ради выбора, по которому считается CTR.
        // Суммы остаются за витриной выше: этот слой у крупного кабинета в семь
        // раз толще (46 тысяч строк за 30 дней против 6,7 тысячи), и читать его
        // целиком значило бы платить всемеро за уже посчитанное. Живая проверка
        // 12.09.2026 показала это прямо: полное чтение упёрлось в предохранитель
        // на 30 000 строк и роут отвечал ошибкой.
        //
        // Пустые строки не нужны: кампания числилась, но товар в этот день не
        // крутила. В суммы они не добавляют ничего, а в выборе не участвуют.
        loadAllSupabasePages<AdCampaignRow>((from, to) => {
          let query = db
            .from("wb_advert_nm_campaign_daily")
            .select("nm_id, date, views, clicks, spent, advert_id")
            .gte("date", since)
            .or("views.gt.0,clicks.gt.0,spent.gt.0")
            .order("date", { ascending: true })
            .order("nm_id", { ascending: true })
            .range(from, to);
          if (until) query = query.lte("date", until);
          if (p_cabinet) query = query.eq("cabinet_id", p_cabinet);
          if (allowedNmIds) query = query.in("nm_id", allowedNmIds.size ? [...allowedNmIds] : [-1]);
          return query;
        }, { label: "Реклама WB по кампаниям", concurrency: 4 }),
      ]);

      // Разметка кампаний: тип ставки и модель оплаты. Без неё ЕРК не отличить
      // от CPM — он и представляется как CPM, а выдаёт его только bid_type.
      const advertIds = [...new Set(campaignRows.map((row) => Number(row.advert_id)).filter(Number.isFinite))];
      const models = new Map<number, CtrPaymentModel | "erk" | null>();
      for (let index = 0; index < advertIds.length; index += 500) {
        const chunk = advertIds.slice(index, index + 500);
        const { data: adverts } = await db
          .from("wb_adverts")
          .select("advert_id, bid_type, payment_type, placement_search, placement_shelf, bid_cpm_rub, bid_search_rub, bid_shelf_rub, block_override")
          .in("advert_id", chunk);
        for (const advert of (adverts ?? []) as AdvertMetaRow[]) {
          models.set(Number(advert.advert_id), ctrPaymentModel(advert));
        }
      }

      const scopedFunnelRows = funnelRows.filter((row) => requestAllowsNm(allowedNmIds, row.nm_id));
      const scopedAdRows = adRows.filter((row) => requestAllowsNm(allowedNmIds, row.nm_id));
      const scopedCampaignRows = campaignRows.filter((row) => requestAllowsNm(allowedNmIds, row.nm_id));
      const { metrics, ctrPicks } = buildWbFunnelDayMetrics(scopedFunnelRows, scopedAdRows, {
        rows: scopedCampaignRows,
        // Кампания без разметки — не «обычная», а неизвестная: правило отбора
        // обязано её отбросить, а не принять за CPM по умолчанию.
        modelOf: (advertId) => models.get(advertId) ?? null,
      });

      return { metrics, ctrPicks };
    },
    {
      forceRefresh: sp.get("refresh") === "1",
      backgroundRefresh: sp.get("background") === "1",
    },
  );
  return NextResponse.json(payload, { headers: { "X-Dashboard-Cache": "hourly-snapshot" } });
}
