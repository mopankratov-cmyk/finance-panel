import { advertCall } from "@/lib/wb/advertApi";
import { fetchWbStatistics } from "@/lib/wb/statisticsRequest";
import { getCtrMetricSnapshot } from "./metrics";
import { normalizeCtrSnapshot, type CtrMetricSnapshot } from "./model";

/**
 * Живые счётчики кампании для нового движка CTR-тестов.
 *
 * Прежний путь читал `wb_advert_nm_campaign_daily` — то, что успел выгрузить
 * синк дневных агрегатов. Для замера «набрали ли цель шага» и «устоялась ли
 * статистика» это не годится: данные в базе обновляются с шагом в часы, и на
 * тесте 13 смены шли строго в :05 каждые два часа — крон видел норму только
 * тогда, когда синк успевал. Здесь показы, клики и расход берутся у WB
 * напрямую, а воронка (открытия, корзины, заказы) остаётся из базы: у неё
 * живого источника нет.
 */

const FULLSTATS_URL = "https://advert-api.wildberries.ru/adv/v3/fullstats";
const DEADLINE_MS = 40_000;

interface NmStat { nmId?: number; views?: number; clicks?: number; sum?: number }
interface AdvertStat { advertId?: number; days?: { apps?: { nms?: NmStat[] }[] }[] }

export type LiveTotals =
  | { ok: true; views: number; clicks: number; spent: number }
  | { ok: false; error: string; rateLimited: boolean };

/**
 * Итог кампании по артикулу за окно дат. Окно (`from`..`to`, по Москве)
 * фиксируется на шаг: дельта считается как «сейчас минус на старте», и если
 * начало окна поплывёт между двумя опросами, разница покажет чужие сутки.
 */
export async function fetchCampaignNmTotals(input: {
  token: string;
  advertId: number;
  nmId: number;
  from: string;
  to: string;
}): Promise<LiveTotals> {
  const url = new URL(FULLSTATS_URL);
  url.searchParams.set("ids", String(input.advertId));
  url.searchParams.set("beginDate", input.from);
  url.searchParams.set("endDate", input.to);
  try {
    const response = await fetchWbStatistics({ url: url.toString(), token: input.token, deadline: Date.now() + DEADLINE_MS, fallbackWaitMs: 5_000 });
    if (!response.ok) {
      const message = `WB ${response.status}: ${(await response.text()).slice(0, 120)}`;
      // Любой 429 — это ожидание, а не сбой: лимитер WB общий на кабинет и делится с синками.
      return { ok: false, error: message, rateLimited: response.status === 429 };
    }
    const stats = ((await response.json()) ?? []) as AdvertStat[];
    let views = 0, clicks = 0, spent = 0;
    for (const advert of stats) {
      if (Number(advert.advertId) !== input.advertId) continue;
      for (const day of advert.days ?? []) {
        for (const app of day.apps ?? []) {
          for (const nm of app.nms ?? []) {
            if (Number(nm.nmId) !== input.nmId) continue;
            views += Number(nm.views ?? 0);
            clicks += Number(nm.clicks ?? 0);
            spent += Number(nm.sum ?? 0);
          }
        }
      }
    }
    return { ok: true, views, clicks, spent };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : "WB не ответил", rateLimited: false };
  }
}

export type LiveSnapshotResult =
  | { ok: true; snapshot: CtrMetricSnapshot }
  | { ok: false; error: string; rateLimited: boolean };

/** Снимок для шага: реклама живая, воронка из базы. */
export async function getLiveCtrSnapshot(input: {
  token: string;
  cabinetId: string;
  nmId: number;
  advertId: number;
  from: string;
  to: string;
}): Promise<LiveSnapshotResult> {
  const [totals, funnel] = await Promise.all([
    fetchCampaignNmTotals({ token: input.token, advertId: input.advertId, nmId: input.nmId, from: input.from, to: input.to }),
    getCtrMetricSnapshot(input.cabinetId, input.nmId, input.advertId).catch((cause: unknown) => cause instanceof Error ? cause : new Error("воронка недоступна")),
  ]);
  if (!totals.ok) return totals;
  if (funnel instanceof Error) return { ok: false, error: funnel.message, rateLimited: false };
  return {
    ok: true,
    snapshot: normalizeCtrSnapshot({
      impressions: totals.views,
      clicks: totals.clicks,
      spend: totals.spent,
      opens: funnel.opens,
      carts: funnel.carts,
      orders: funnel.orders,
      capturedAt: new Date().toISOString(),
    }),
  };
}

/** Статус кампании у WB: 9 — идёт, 11 — на паузе. null — ответа нет. */
export async function getAdvertStatus(token: string, advertId: number): Promise<number | null> {
  const result = await advertCall<{ adverts?: { id?: number; status?: number }[] }>({
    token,
    path: "/api/advert/v2/adverts",
    method: "GET",
    query: { ids: advertId },
  });
  if (!result.ok) return null;
  const status = result.data?.adverts?.find((advert) => Number(advert.id) === advertId)?.status;
  return typeof status === "number" ? status : null;
}
