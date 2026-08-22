import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { moscowToday } from "@/lib/wb/rkJournalDates";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import {
  wbAdvertBlock,
  wbAdvertBlockBid,
  WB_RK_BLOCK_UNKNOWN,
  type WbRkBlock,
} from "@/lib/wb/advertBlocks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const READ_ROLES = ["director", "finance", "manager", "seller"] as const;
const DAYS_DEFAULT = 5;
const DAYS_MAX = 60;

// Журнал РК: строка = (артикул, вид размещения), колонки = дни.
//
// Источников два, и это осознанно. Закрытые дни берём из снимков 06:00 —
// в них зафиксирована ставка того дня, восстановить её иначе нельзя. Дни, на
// которые снимка ещё нет (сегодня и вся история до внедрения журнала),
// считаются на лету из слоя кампаний: без ставки, но с честными метриками.

interface JournalRow {
  cabinet_id: string | null;
  date: string;
  nm_id: number;
  block: string;
  bid: number | string | null;
  views: number | null;
  clicks: number | null;
  spent: number | string | null;
  carts: number | null;
  orders: number | null;
  orders_sum: number | string | null;
}

interface CampaignDayRow {
  cabinet_id: string | null;
  advert_id: number;
  nm_id: number;
  date: string;
  views: number | null;
  clicks: number | null;
  spent: number | string | null;
  carts: number | null;
  orders: number | null;
  orders_sum: number | string | null;
}

interface AdvertRow {
  cabinet_id: string | null;
  advert_id: number;
  name: string | null;
  status: number | null;
  bid_type: string | null;
  bid_cpm_rub: number | string | null;
  bid_search_rub: number | string | null;
  bid_shelf_rub: number | string | null;
  block_override: string | null;
  nm_ids: number[] | null;
}

interface Cell {
  bid: number | null;
  views: number;
  clicks: number;
  spent: number;
  carts: number;
  orders: number;
  ordersSum: number;
  /** false — день посчитан на лету, ставка того дня неизвестна. */
  snapshot: boolean;
}

const num = (value: number | string | null | undefined) => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return parsed != null && Number.isFinite(parsed) ? parsed : 0;
};

function emptyCell(snapshot: boolean): Cell {
  return { bid: null, views: 0, clicks: 0, spent: 0, carts: 0, orders: 0, ordersSum: 0, snapshot };
}

function dayList(from: string, to: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end && days.length <= DAYS_MAX) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export async function GET(request: NextRequest) {
  const gate = await requireApiSession([...READ_ROLES]);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Сервис данных временно недоступен" }, { status: 503 });

  const sp = new URL(request.url).searchParams;
  const cabinetParam = sp.get("cabinet");
  const cabinetId = cabinetParam && cabinetParam !== "all" ? cabinetParam : null;
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }

  const daysRaw = Number(sp.get("days") ?? DAYS_DEFAULT);
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.round(daysRaw), 1), DAYS_MAX) : DAYS_DEFAULT;
  const todayMsk = moscowToday();
  const to = sp.get("to") && /^\d{4}-\d{2}-\d{2}$/.test(sp.get("to") as string) ? (sp.get("to") as string) : todayMsk;
  const fromDate = new Date(`${to}T00:00:00Z`);
  fromDate.setUTCDate(fromDate.getUTCDate() - (days - 1));
  const from = fromDate.toISOString().slice(0, 10);
  const dates = dayList(from, to);

  // Кампании нужны и для разметки дней без снимка, и для экрана разметки.
  // Запрос строится внутри колбэка: builder PostgREST одноразовый, повторное
  // использование одного объекта на вторую страницу молча ломает выборку.
  const adverts = await loadAllSupabasePages<AdvertRow>(
    (start, end) => {
      const q = db
        .from("wb_adverts")
        .select("cabinet_id, advert_id, name, status, bid_type, bid_cpm_rub, bid_search_rub, bid_shelf_rub, block_override, nm_ids");
      return (cabinetId ? q.eq("cabinet_id", cabinetId) : q).order("advert_id", { ascending: true }).range(start, end);
    },
    { maxPages: 60, label: "Журнал РК: кампании", concurrency: 4 },
  ).catch(() => [] as AdvertRow[]);

  const advertByKey = new Map<string, AdvertRow>();
  for (const advert of adverts) advertByKey.set(`${advert.cabinet_id ?? ""}|${advert.advert_id}`, advert);

  const blockOf = (advert: AdvertRow | undefined): WbRkBlock | null => advert
    ? wbAdvertBlock({
      bid_type: advert.bid_type,
      bid_search_rub: advert.bid_search_rub == null ? null : num(advert.bid_search_rub),
      bid_shelf_rub: advert.bid_shelf_rub == null ? null : num(advert.bid_shelf_rub),
      bid_cpm_rub: advert.bid_cpm_rub == null ? null : num(advert.bid_cpm_rub),
      block_override: advert.block_override,
    })
    : null;

  // Снимки закрытых дней.
  const snapshots = await loadAllSupabasePages<JournalRow>(
    (start, end) => {
      const q = db
        .from("wb_rk_journal_daily")
        .select("cabinet_id, date, nm_id, block, bid, views, clicks, spent, carts, orders, orders_sum")
        .gte("date", from)
        .lte("date", to);
      return (cabinetId ? q.eq("cabinet_id", cabinetId) : q).order("date", { ascending: true }).range(start, end);
    },
    { maxPages: 60, label: "Журнал РК: снимки", concurrency: 4 },
  ).catch(() => [] as JournalRow[]);

  const snapshotDates = new Set(snapshots.map((row) => row.date));
  const liveDates = dates.filter((date) => !snapshotDates.has(date));

  // Дни без снимка — из слоя кампаний.
  let live: CampaignDayRow[] = [];
  if (liveDates.length) {
    live = await loadAllSupabasePages<CampaignDayRow>(
      (start, end) => {
        const q = db
          .from("wb_advert_nm_campaign_daily")
          .select("cabinet_id, advert_id, nm_id, date, views, clicks, spent, carts, orders, orders_sum")
          .in("date", liveDates);
        return (cabinetId ? q.eq("cabinet_id", cabinetId) : q).order("date", { ascending: true }).range(start, end);
      },
      { maxPages: 120, label: "Журнал РК: дни без снимка", concurrency: 4 },
    ).catch(() => [] as CampaignDayRow[]);
  }

  // (артикул, блок) → день → ячейка
  const rows = new Map<string, { nm: number; block: string; cells: Map<string, Cell> }>();
  const cellOf = (nm: number, block: string, date: string, snapshot: boolean) => {
    const rowKey = `${nm}|${block}`;
    const row = rows.get(rowKey) ?? { nm, block, cells: new Map<string, Cell>() };
    rows.set(rowKey, row);
    const cell = row.cells.get(date) ?? emptyCell(snapshot);
    row.cells.set(date, cell);
    return cell;
  };

  for (const row of snapshots) {
    const cell = cellOf(row.nm_id, row.block, row.date, true);
    cell.bid = row.bid == null ? cell.bid : num(row.bid);
    cell.views += num(row.views);
    cell.clicks += num(row.clicks);
    cell.spent += num(row.spent);
    cell.carts += num(row.carts);
    cell.orders += num(row.orders);
    cell.ordersSum += num(row.orders_sum);
  }

  // Ставка на «живых» днях — текущая ставка кампании, а не историческая.
  // Помечаем ячейку snapshot: false, чтобы экран не выдавал её за снятую.
  for (const row of live) {
    const advert = advertByKey.get(`${row.cabinet_id ?? ""}|${row.advert_id}`);
    const block = blockOf(advert);
    const cell = cellOf(row.nm_id, block ?? WB_RK_BLOCK_UNKNOWN, row.date, false);
    const spent = num(row.spent);
    cell.views += num(row.views);
    cell.clicks += num(row.clicks);
    cell.spent += spent;
    cell.carts += num(row.carts);
    cell.orders += num(row.orders);
    cell.ordersSum += num(row.orders_sum);
    const bid = advert
      ? wbAdvertBlockBid({
        bid_search_rub: advert.bid_search_rub == null ? null : num(advert.bid_search_rub),
        bid_shelf_rub: advert.bid_shelf_rub == null ? null : num(advert.bid_shelf_rub),
        bid_cpm_rub: advert.bid_cpm_rub == null ? null : num(advert.bid_cpm_rub),
      }, block)
      : null;
    if (bid != null && bid > 0 && cell.bid == null) cell.bid = bid;
  }

  // Кампании без разметки — для экрана «Без разметки»: WB не отдаёт вид
  // размещения, и владелец расставляет его руками один раз на кампанию.
  const unmarked = adverts
    .filter((advert) => blockOf(advert) == null)
    .map((advert) => ({
      advertId: advert.advert_id,
      cabinetId: advert.cabinet_id,
      name: advert.name,
      status: advert.status,
      bidType: advert.bid_type,
      bidSearch: advert.bid_search_rub == null ? null : num(advert.bid_search_rub),
      bidShelf: advert.bid_shelf_rub == null ? null : num(advert.bid_shelf_rub),
      nmIds: advert.nm_ids ?? [],
    }));

  const items = [...rows.values()].map((row) => ({
    nm: row.nm,
    block: row.block,
    days: Object.fromEntries([...row.cells.entries()].map(([date, cell]) => [date, {
      bid: cell.bid,
      views: cell.views,
      clicks: cell.clicks,
      spent: Math.round(cell.spent * 100) / 100,
      carts: cell.carts,
      orders: cell.orders,
      ordersSum: Math.round(cell.ordersSum * 100) / 100,
      snapshot: cell.snapshot,
    }])),
  }));

  return NextResponse.json({
    from,
    to,
    dates,
    items,
    unmarked,
    campaigns: adverts.length,
    snapshotDates: [...snapshotDates].sort(),
  });
}

/** Ручная разметка вида размещения: одна кампания — один блок. */
export async function POST(request: NextRequest) {
  const gate = await requireApiSession(["director", "finance", "manager"]);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Сервис данных временно недоступен" }, { status: 503 });

  const body = await request.json().catch(() => null) as
    | { advertId?: number; cabinetId?: string | null; block?: string | null }
    | null;
  if (!body?.advertId) return NextResponse.json({ error: "Нужен advertId" }, { status: 400 });
  if (!(await hasCabinetAccess(body.cabinetId ?? null))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }

  const allowed = new Set(["cpc_search", "cpc_shelf", "cpm_search", "cpm_shelf", "erk"]);
  const block = body.block == null || body.block === "" ? null : String(body.block);
  if (block != null && !allowed.has(block)) {
    return NextResponse.json({ error: "Неизвестный вид размещения" }, { status: 400 });
  }

  let query = db.from("wb_adverts").update({ block_override: block }).eq("advert_id", body.advertId);
  query = body.cabinetId ? query.eq("cabinet_id", body.cabinetId) : query.is("cabinet_id", null);
  const { error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  return NextResponse.json({ ok: true, advertId: body.advertId, block });
}
