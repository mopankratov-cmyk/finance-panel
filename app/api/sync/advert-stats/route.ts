import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { getWbSyncTargets } from "@/lib/sync/cabinets";

const FULLSTATS_URL = "https://advert-api.wildberries.ru/adv/v3/fullstats";
// fullstats: лимит 1 запрос/мин на токен, до 100 кампаний за раз.
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
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const targets = await getWbSyncTargets();
  if (!targets.length) {
    return NextResponse.json({ error: "Нет активных кабинетов и WB_TOKEN_ADVERT не настроен" }, { status: 500 });
  }

  const end = new Date();
  const begin = new Date(Date.now() - DAYS_BACK * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  let advertDays = 0;
  let nmDays = 0;
  const errors: string[] = [];

  try {
    for (const t of targets) {
      // Живые кампании этого кабинета (активные + на паузе); архивные не тратят бюджет.
      let aq = db.from("wb_adverts").select("advert_id, status").in("status", [9, 11]);
      aq = t.cabinetId === null ? aq.is("cabinet_id", null) : aq.eq("cabinet_id", t.cabinetId);
      const { data: advRows, error: advErr } = await aq;
      if (advErr) {
        errors.push(`${t.name}: ${advErr.message}`);
        continue;
      }

      const ids = (advRows ?? []).map((r) => r.advert_id as number);
      if (!ids.length) continue;

      const dayRows: Record<string, unknown>[] = [];
      const nmDaily = new Map<string, { nm_id: number; date: string; views: number; clicks: number; spent: number; orders: number; orders_sum: number; cabinet_id: string | null }>();

      let failed = false;
      for (let i = 0; i < ids.length; i += ID_BATCH) {
        const batch = ids.slice(i, i + ID_BATCH);
        if (i > 0) await new Promise((r) => setTimeout(r, 61000)); // лимит 1 req/min на токен

        const url = new URL(FULLSTATS_URL);
        url.searchParams.set("ids", batch.join(","));
        url.searchParams.set("beginDate", fmt(begin));
        url.searchParams.set("endDate", fmt(end));

        const res = await fetch(url.toString(), { headers: { Authorization: t.advertToken }, cache: "no-store" });
        if (!res.ok) {
          errors.push(`${t.name}: WB ${res.status}: ${(await res.text()).slice(0, 120)}`);
          failed = true;
          break;
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
              cabinet_id: t.cabinetId,
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
                  cabinet_id: t.cabinetId,
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
      if (failed) continue;

      const nmRows = [...nmDaily.values()].map((r) => ({ ...r, synced_at: new Date().toISOString() }));

      const e1 = await chunkedUpsert("wb_advert_stats", dayRows, "advert_id,date");
      if (e1) {
        errors.push(`${t.name}: ${e1}`);
        continue;
      }
      const e2 = await chunkedUpsert("wb_advert_nm_daily", nmRows, "nm_id,date");
      if (e2) {
        errors.push(`${t.name}: ${e2}`);
        continue;
      }
      advertDays += dayRows.length;
      nmDays += nmRows.length;
    }

    const ok = errors.length === 0;
    await writeSyncLog("advert-stats", ok ? "ok" : "error", advertDays, errors.join("; ") || null, startedAt);
    return NextResponse.json({ ok, advertDays, nmDays, cabinets: targets.length, errors });
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : "";
    const msg = (err instanceof Error ? err.message : "Unknown error") + cause;
    await writeSyncLog("advert-stats", "error", null, msg, startedAt);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
