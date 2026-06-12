import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";

const WB_ADV_TOKEN = process.env.WB_TOKEN_ADVERT;
const FULLSTATS_URL = "https://advert-api.wildberries.ru/adv/v3/fullstats";
// fullstats: лимит 1 запрос/мин, до 100 кампаний за раз.
// 100 в батче → при текущем числе живых кампаний хватает одного запроса без паузы.
const ID_BATCH = 100;
// сколько дней истории тянем
const DAYS_BACK = 14;

// fullstats с паузами между батчами может идти дольше дефолта — поднимаем лимит
export const maxDuration = 60;

interface NmStat {
  nmId?: number;
  views?: number;
  clicks?: number;
  sum?: number;
  orders?: number;
  sum_price?: number;
}
interface AppStat {
  nms?: NmStat[];
}
interface DayStat {
  date?: string;
  views?: number;
  clicks?: number;
  ctr?: number;
  cpc?: number;
  sum?: number;
  orders?: number;
  sum_price?: number;
  apps?: AppStat[];
}
interface AdvertStat {
  advertId?: number;
  days?: DayStat[];
}

export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const db = getSupabaseAdmin();

  if (!db) {
    return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  }
  if (!WB_ADV_TOKEN) {
    return NextResponse.json({ error: "WB_TOKEN_ADVERT не настроен" }, { status: 500 });
  }

  try {
    // Статистику тянем только по живым кампаниям (активные + на паузе),
    // архивные (status 7) не тратят бюджет и раздувают запрос.
    const { data: advRows, error: advErr } = await db
      .from("wb_adverts")
      .select("advert_id, status")
      .in("status", [9, 11]);
    if (advErr) throw new Error(advErr.message);

    const ids = (advRows ?? []).map((r) => r.advert_id as number);
    if (!ids.length) {
      await writeSyncLog("advert-stats", "ok", 0, null, startedAt);
      return NextResponse.json({ ok: true, rows: 0, note: "нет живых кампаний" });
    }

    const end = new Date();
    const begin = new Date(Date.now() - DAYS_BACK * 86400000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const dayRows: Record<string, unknown>[] = [];
    // расход по nm_id по дням — агрегируем по всем кампаниям
    const nmDaily = new Map<string, { nm_id: number; date: string; views: number; clicks: number; spent: number; orders: number; orders_sum: number }>();

    for (let i = 0; i < ids.length; i += ID_BATCH) {
      const batch = ids.slice(i, i + ID_BATCH);
      if (i > 0) await new Promise((r) => setTimeout(r, 61000)); // лимит 1 req/min

      const url = new URL(FULLSTATS_URL);
      url.searchParams.set("ids", batch.join(","));
      url.searchParams.set("beginDate", fmt(begin));
      url.searchParams.set("endDate", fmt(end));

      const res = await fetch(url.toString(), {
        headers: { Authorization: WB_ADV_TOKEN },
        cache: "no-store",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`WB ${res.status}: ${text.slice(0, 200)}`);
      }

      const stats = ((await res.json()) ?? []) as AdvertStat[];
      for (const adv of stats) {
        if (!adv.advertId || !adv.days) continue;
        for (const day of adv.days) {
          if (!day.date) continue;
          const date = day.date.slice(0, 10);
          dayRows.push({
            advert_id: adv.advertId,
            date,
            views: day.views ?? 0,
            clicks: day.clicks ?? 0,
            ctr: day.ctr ?? null,
            cpc: day.cpc ?? null,
            sum_spent: day.sum ?? 0,
            orders: day.orders ?? 0,
            sum_orders: day.sum_price ?? 0,
          });

          for (const app of day.apps ?? []) {
            for (const nm of app.nms ?? []) {
              if (!nm.nmId) continue;
              const key = `${nm.nmId}|${date}`;
              const agg = nmDaily.get(key) ?? {
                nm_id: nm.nmId,
                date,
                views: 0,
                clicks: 0,
                spent: 0,
                orders: 0,
                orders_sum: 0,
              };
              agg.views += nm.views ?? 0;
              agg.clicks += nm.clicks ?? 0;
              agg.spent += nm.sum ?? 0;
              agg.orders += nm.orders ?? 0;
              agg.orders_sum += nm.sum_price ?? 0;
              nmDaily.set(key, agg);
            }
          }
        }
      }
    }

    const nmRows = [...nmDaily.values()].map((r) => ({ ...r, synced_at: new Date().toISOString() }));

    const e1 = await chunkedUpsert("wb_advert_stats", dayRows, "advert_id,date");
    if (e1) {
      await writeSyncLog("advert-stats", "error", null, e1, startedAt);
      return NextResponse.json({ error: e1 }, { status: 500 });
    }
    const e2 = await chunkedUpsert("wb_advert_nm_daily", nmRows, "nm_id,date");
    if (e2) {
      await writeSyncLog("advert-stats", "error", null, e2, startedAt);
      return NextResponse.json({ error: e2 }, { status: 500 });
    }

    await writeSyncLog("advert-stats", "ok", dayRows.length, null, startedAt);
    return NextResponse.json({ ok: true, advertDays: dayRows.length, nmDays: nmRows.length });
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : "";
    const msg = (err instanceof Error ? err.message : "Unknown error") + cause;
    await writeSyncLog("advert-stats", "error", null, msg, startedAt);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
