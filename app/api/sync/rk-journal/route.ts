import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { moscowYesterday } from "@/lib/wb/rkJournalDates";
import { wbAdvertBlock, wbAdvertBlockBid, WB_RK_BLOCK_UNKNOWN, type WbRkBlock } from "@/lib/wb/advertBlocks";

// Снимок журнала РК: раз в сутки в 06:00 МСК за вчерашний день.
//
// Зачем снимок, если метрики лежат в wb_advert_nm_campaign_daily: ставка живёт
// только «сейчас» (wb_adverts перезаписывается каждым прогоном синка), поэтому
// без фиксации нельзя ответить «какая ставка стояла в тот день». Плюс WB
// правит статистику задним числом, а решения принимаются по той картине,
// которая была на утро.
export const maxDuration = 120;

interface CampaignDayRow {
  cabinet_id: string | null;
  advert_id: number;
  nm_id: number;
  views: number | null;
  clicks: number | null;
  spent: number | string | null;
  spent_allocated: number | string | null;
  carts: number | null;
  orders: number | null;
  orders_sum: number | string | null;
}

interface AdvertRow {
  cabinet_id: string | null;
  advert_id: number;
  bid_type: string | null;
  bid_cpm_rub: number | string | null;
  bid_search_rub: number | string | null;
  bid_shelf_rub: number | string | null;
  block_override: string | null;
}

const num = (value: number | string | null | undefined) => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return parsed != null && Number.isFinite(parsed) ? parsed : 0;
};

export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const startedAt = new Date();
  const sp = request.nextUrl.searchParams;
  const date = sp.get("date") ?? moscowYesterday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date должен быть ГГГГ-ММ-ДД" }, { status: 400 });
  }

  try {
    const stats = await loadAllSupabasePages<CampaignDayRow>(
      (start, end) => db.from("wb_advert_nm_campaign_daily")
        .select("cabinet_id, advert_id, nm_id, views, clicks, spent, spent_allocated, carts, orders, orders_sum")
        .eq("date", date)
        .order("advert_id", { ascending: true })
        .range(start, end),
      { maxPages: 200, label: "Журнал РК: статистика дня", concurrency: 4 },
    );

    if (!stats.length) {
      await writeSyncLog("rk-journal", "ok", 0, `Нет статистики кампаний за ${date}`, startedAt);
      return NextResponse.json({ ok: true, date, rows: 0, note: "нет статистики кампаний за дату" });
    }

    const adverts = await loadAllSupabasePages<AdvertRow>(
      (start, end) => db.from("wb_adverts")
        .select("cabinet_id, advert_id, bid_type, bid_cpm_rub, bid_search_rub, bid_shelf_rub, block_override")
        .order("advert_id", { ascending: true })
        .range(start, end),
      { maxPages: 200, label: "Журнал РК: кампании", concurrency: 4 },
    );
    const advertByKey = new Map<string, AdvertRow>();
    for (const advert of adverts) advertByKey.set(`${advert.cabinet_id ?? ""}|${advert.advert_id}`, advert);

    interface Agg {
      cabinet_id: string | null; nm_id: number; block: string;
      views: number; clicks: number; spent: number; carts: number; orders: number; orders_sum: number;
      spentAllocated: number;
      campaigns: number; bidWeighted: number; bidWeight: number; bidPlain: number; bidPlainCount: number;
    }
    const byKey = new Map<string, Agg>();

    for (const row of stats) {
      const advert = advertByKey.get(`${row.cabinet_id ?? ""}|${row.advert_id}`);
      const block: WbRkBlock | null = advert
        ? wbAdvertBlock({
          bid_type: advert.bid_type,
          bid_search_rub: advert.bid_search_rub == null ? null : num(advert.bid_search_rub),
          bid_shelf_rub: advert.bid_shelf_rub == null ? null : num(advert.bid_shelf_rub),
          bid_cpm_rub: advert.bid_cpm_rub == null ? null : num(advert.bid_cpm_rub),
          block_override: advert.block_override,
        })
        : null;
      const blockKey = block ?? WB_RK_BLOCK_UNKNOWN;
      const key = `${row.cabinet_id ?? ""}|${row.nm_id}|${blockKey}`;
      const agg = byKey.get(key) ?? {
        cabinet_id: row.cabinet_id, nm_id: row.nm_id, block: blockKey,
        views: 0, clicks: 0, spent: 0, spentAllocated: 0, carts: 0, orders: 0, orders_sum: 0,
        campaigns: 0, bidWeighted: 0, bidWeight: 0, bidPlain: 0, bidPlainCount: 0,
      };

      // Полный расход, отнесённый на артикул: измеренный WB плюс разложенный
      // остаток кампании. Разложенное дублируем отдельно — снимок должен
      // помнить, сколько в нём восстановлено.
      const allocated = num(row.spent_allocated);
      const spent = num(row.spent) + allocated;
      agg.views += num(row.views);
      agg.clicks += num(row.clicks);
      agg.spent += spent;
      agg.spentAllocated += allocated;
      agg.carts += num(row.carts);
      agg.orders += num(row.orders);
      agg.orders_sum += num(row.orders_sum);
      agg.campaigns += 1;

      // Ставка по строке — средняя по кампаниям, взвешенная расходом: строка
      // с 3 ₽ расхода не должна тянуть на себя ставку так же, как с 3 000 ₽.
      // Простое среднее держим отдельно — на случай дня без расходов.
      const bid = advert
        ? wbAdvertBlockBid({
          bid_search_rub: advert.bid_search_rub == null ? null : num(advert.bid_search_rub),
          bid_shelf_rub: advert.bid_shelf_rub == null ? null : num(advert.bid_shelf_rub),
          bid_cpm_rub: advert.bid_cpm_rub == null ? null : num(advert.bid_cpm_rub),
        }, block)
        : null;
      if (bid != null && bid > 0) {
        agg.bidWeighted += bid * spent;
        agg.bidWeight += spent;
        agg.bidPlain += bid;
        agg.bidPlainCount += 1;
      }
      byKey.set(key, agg);
    }

    const rows = [...byKey.values()].map((agg) => ({
      cabinet_id: agg.cabinet_id,
      date,
      nm_id: agg.nm_id,
      block: agg.block,
      // NULL, а не 0: «ставку не знаем» и «ставка ноль» — разные вещи.
      bid: agg.bidWeight > 0
        ? Math.round((agg.bidWeighted / agg.bidWeight) * 100) / 100
        : agg.bidPlainCount > 0
          ? Math.round((agg.bidPlain / agg.bidPlainCount) * 100) / 100
          : null,
      views: agg.views,
      clicks: agg.clicks,
      spent: Math.round(agg.spent * 100) / 100,
      spent_allocated: Math.round(agg.spentAllocated * 100) / 100,
      carts: agg.carts,
      orders: agg.orders,
      orders_sum: Math.round(agg.orders_sum * 100) / 100,
      campaigns: agg.campaigns,
      captured_at: new Date().toISOString(),
    }));

    let upsertError = await chunkedUpsert("wb_rk_journal_daily", rows, "cabinet_id,date,nm_id,block");
    if (upsertError && /spent_allocated/i.test(upsertError)) {
      // Окно совместимости, пока миграция раскладки не применена: spent уже
      // полный, теряется только пометка о доле восстановленного.
      upsertError = await chunkedUpsert(
        "wb_rk_journal_daily",
        rows.map(({ spent_allocated, ...row }) => row),
        "cabinet_id,date,nm_id,block",
      );
    }
    if (upsertError) {
      await writeSyncLog("rk-journal", "error", null, upsertError, startedAt);
      return NextResponse.json({ error: upsertError }, { status: 500 });
    }

    const unmarked = rows.filter((row) => row.block === WB_RK_BLOCK_UNKNOWN).length;
    await writeSyncLog("rk-journal", "ok", rows.length, unmarked ? `Без разметки: ${unmarked}` : null, startedAt);
    return NextResponse.json({ ok: true, date, rows: rows.length, campaignRows: stats.length, unmarked });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await writeSyncLog("rk-journal", "error", null, msg, startedAt);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
