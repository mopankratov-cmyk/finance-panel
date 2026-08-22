// Сборка строк журнала РК из двух источников (см. app/api/wb/rk-journal).
//
// Закрытые дни приходят снимками 06:00 — в них зафиксирована ставка того дня.
// Дни без снимка (сегодня и вся история до внедрения журнала) считаются на
// лету из слоя кампаний: метрики честные, ставка — текущая, и ячейка помечена
// snapshot: false, чтобы экран не выдавал её за снятую.

import { wbAdvertBlock, wbAdvertBlockBid, WB_RK_BLOCK_UNKNOWN, type WbRkBlock } from "./advertBlocks";

export interface RkSnapshotRow {
  date: string;
  nm_id: number;
  block: string;
  bid: number | string | null;
  views?: number | null;
  clicks?: number | null;
  spent?: number | string | null;
  carts?: number | null;
  orders?: number | null;
  orders_sum?: number | string | null;
}

export interface RkCampaignDayRow {
  cabinet_id: string | null;
  advert_id: number;
  nm_id: number;
  date: string;
  views?: number | null;
  clicks?: number | null;
  spent?: number | string | null;
  carts?: number | null;
  orders?: number | null;
  orders_sum?: number | string | null;
}

export interface RkAdvertRow {
  cabinet_id: string | null;
  advert_id: number;
  bid_type?: string | null;
  bid_cpm_rub?: number | string | null;
  bid_search_rub?: number | string | null;
  bid_shelf_rub?: number | string | null;
  block_override?: string | null;
}

export interface RkCell {
  bid: number | null;
  views: number;
  clicks: number;
  spent: number;
  carts: number;
  orders: number;
  ordersSum: number;
  snapshot: boolean;
}

export interface RkJournalItem {
  nm: number;
  block: string;
  days: Record<string, RkCell>;
}

export const rkNum = (value: number | string | null | undefined) => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return parsed != null && Number.isFinite(parsed) ? parsed : 0;
};

export function advertKey(cabinetId: string | null, advertId: number) {
  return `${cabinetId ?? ""}|${advertId}`;
}

export function rkAdvertBlock(advert: RkAdvertRow | undefined): WbRkBlock | null {
  if (!advert) return null;
  return wbAdvertBlock({
    bid_type: advert.bid_type,
    bid_search_rub: advert.bid_search_rub == null ? null : rkNum(advert.bid_search_rub),
    bid_shelf_rub: advert.bid_shelf_rub == null ? null : rkNum(advert.bid_shelf_rub),
    bid_cpm_rub: advert.bid_cpm_rub == null ? null : rkNum(advert.bid_cpm_rub),
    block_override: advert.block_override,
  });
}

/** Строки журнала: (артикул, вид размещения) → день → ячейка. */
export function buildRkJournalItems(
  snapshots: RkSnapshotRow[],
  live: RkCampaignDayRow[],
  adverts: RkAdvertRow[],
): RkJournalItem[] {
  const advertByKey = new Map<string, RkAdvertRow>();
  for (const advert of adverts) advertByKey.set(advertKey(advert.cabinet_id, advert.advert_id), advert);

  const rows = new Map<string, { nm: number; block: string; cells: Map<string, RkCell> }>();
  const cellOf = (nm: number, block: string, date: string, snapshot: boolean) => {
    const rowKey = `${nm}|${block}`;
    const row = rows.get(rowKey) ?? { nm, block, cells: new Map<string, RkCell>() };
    rows.set(rowKey, row);
    const cell = row.cells.get(date)
      ?? { bid: null, views: 0, clicks: 0, spent: 0, carts: 0, orders: 0, ordersSum: 0, snapshot };
    row.cells.set(date, cell);
    return cell;
  };

  for (const row of snapshots) {
    const cell = cellOf(row.nm_id, row.block, row.date, true);
    cell.bid = row.bid == null ? cell.bid : rkNum(row.bid);
    cell.views += rkNum(row.views);
    cell.clicks += rkNum(row.clicks);
    cell.spent += rkNum(row.spent);
    cell.carts += rkNum(row.carts);
    cell.orders += rkNum(row.orders);
    cell.ordersSum += rkNum(row.orders_sum);
  }

  for (const row of live) {
    const advert = advertByKey.get(advertKey(row.cabinet_id, row.advert_id));
    const block = rkAdvertBlock(advert);
    const cell = cellOf(row.nm_id, block ?? WB_RK_BLOCK_UNKNOWN, row.date, false);
    cell.views += rkNum(row.views);
    cell.clicks += rkNum(row.clicks);
    cell.spent += rkNum(row.spent);
    cell.carts += rkNum(row.carts);
    cell.orders += rkNum(row.orders);
    cell.ordersSum += rkNum(row.orders_sum);
    const bid = advert
      ? wbAdvertBlockBid({
        bid_search_rub: advert.bid_search_rub == null ? null : rkNum(advert.bid_search_rub),
        bid_shelf_rub: advert.bid_shelf_rub == null ? null : rkNum(advert.bid_shelf_rub),
        bid_cpm_rub: advert.bid_cpm_rub == null ? null : rkNum(advert.bid_cpm_rub),
      }, block)
      : null;
    if (bid != null && bid > 0 && cell.bid == null) cell.bid = bid;
  }

  return [...rows.values()].map((row) => ({
    nm: row.nm,
    block: row.block,
    days: Object.fromEntries([...row.cells.entries()].map(([date, cell]) => [date, {
      ...cell,
      spent: Math.round(cell.spent * 100) / 100,
      ordersSum: Math.round(cell.ordersSum * 100) / 100,
    }])),
  }));
}
