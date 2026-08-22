// Сборка строк журнала РК из двух источников (см. app/api/wb/rk-journal).
//
// Экран повторяет кабинет WB: строка — артикул, внутри — его кампании.
// Поэтому базовая единица здесь кампания: из неё складывается и вид
// размещения, и итог по артикулу, а обратно из блока кампанию не достать.
//
// Закрытые дни приходят снимками 06:00 — в них зафиксирована ставка того дня.
// Дни без снимка считаются на лету из слоя кампаний: метрики честные, ставка
// текущая, и ячейка помечена snapshot: false, чтобы экран не выдавал её за
// снятую.

import { wbAdvertBlock, wbAdvertBlockBid, WB_RK_BLOCK_ATTRIBUTED, WB_RK_BLOCK_UNKNOWN, type WbRkBlock } from "./advertBlocks";

export interface RkSnapshotRow {
  date: string;
  nm_id: number;
  advert_id?: number | null;
  block: string;
  bid: number | string | null;
  views?: number | null;
  clicks?: number | null;
  spent?: number | string | null;
  spent_allocated?: number | string | null;
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
  /** Доля расхода кампании, которую WB не разнёс по артикулам. */
  spent_allocated?: number | string | null;
  carts?: number | null;
  orders?: number | null;
  orders_sum?: number | string | null;
}

export interface RkAdvertRow {
  cabinet_id: string | null;
  advert_id: number;
  name?: string | null;
  status?: number | null;
  bid_type?: string | null;
  payment_type?: string | null;
  placement_search?: boolean | null;
  placement_shelf?: boolean | null;
  bid_cpm_rub?: number | string | null;
  bid_search_rub?: number | string | null;
  bid_shelf_rub?: number | string | null;
  block_override?: string | null;
  nm_ids?: number[] | null;
}

export interface RkCell {
  bid: number | null;
  views: number;
  clicks: number;
  /** Полный расход, отнесённый на артикул: измеренное WB плюс разложенное. */
  spent: number;
  /** Сколько из spent восстановлено раскладкой, а не измерено. */
  spentAllocated: number;
  carts: number;
  orders: number;
  ordersSum: number;
  snapshot: boolean;
}

export interface RkCampaign {
  advertId: number | null;
  name: string | null;
  block: string;
  /** Сколько артикулов ведёт кампания: её имя может быть от соседнего. */
  nmCount: number | null;
  days: Record<string, RkCell>;
}

export interface RkJournalItem {
  nm: number;
  /** Итог по артикулу за день — сумма его кампаний. */
  days: Record<string, RkCell>;
  campaigns: RkCampaign[];
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
    payment_type: advert.payment_type,
    placement_search: advert.placement_search,
    placement_shelf: advert.placement_shelf,
    bid_search_rub: advert.bid_search_rub == null ? null : rkNum(advert.bid_search_rub),
    bid_shelf_rub: advert.bid_shelf_rub == null ? null : rkNum(advert.bid_shelf_rub),
    bid_cpm_rub: advert.bid_cpm_rub == null ? null : rkNum(advert.bid_cpm_rub),
    block_override: advert.block_override,
  });
}

function emptyCell(snapshot: boolean): RkCell {
  return { bid: null, views: 0, clicks: 0, spent: 0, spentAllocated: 0, carts: 0, orders: 0, ordersSum: 0, snapshot };
}

interface MetricSource {
  views?: number | null;
  clicks?: number | null;
  spent?: number | string | null;
  spent_allocated?: number | string | null;
  carts?: number | null;
  orders?: number | null;
  orders_sum?: number | string | null;
}

function addTo(cell: RkCell, row: MetricSource) {
  const allocated = rkNum(row.spent_allocated);
  cell.views += rkNum(row.views);
  cell.clicks += rkNum(row.clicks);
  // Слой хранит факт WB и разложенное отдельно; журналу нужен полный расход.
  cell.spent += rkNum(row.spent) + allocated;
  cell.spentAllocated += allocated;
  cell.carts += rkNum(row.carts);
  cell.orders += rkNum(row.orders);
  cell.ordersSum += rkNum(row.orders_sum);
}

const round = (value: number) => Math.round(value * 100) / 100;

function finishCells(cells: Map<string, RkCell>): Record<string, RkCell> {
  return Object.fromEntries([...cells.entries()].map(([date, cell]) => [date, {
    ...cell,
    spent: round(cell.spent),
    spentAllocated: round(cell.spentAllocated),
    ordersSum: round(cell.ordersSum),
  }]));
}

/** Строки журнала: артикул → его кампании → день → ячейка. */
export function buildRkJournalItems(
  snapshots: RkSnapshotRow[],
  live: RkCampaignDayRow[],
  adverts: RkAdvertRow[],
): RkJournalItem[] {
  const advertByKey = new Map<string, RkAdvertRow>();
  const advertById = new Map<number, RkAdvertRow>();
  for (const advert of adverts) {
    advertByKey.set(advertKey(advert.cabinet_id, advert.advert_id), advert);
    advertById.set(advert.advert_id, advert);
  }

  interface Row { nm: number; advertId: number | null; name: string | null; block: string; cells: Map<string, RkCell> }
  const rows = new Map<string, Row>();
  const cellOf = (seed: Omit<Row, "cells">, date: string, snapshot: boolean) => {
    // Строки снимка до перехода на кампании остались без advert_id — они
    // группируются по виду размещения, как и раньше.
    const key = `${seed.nm}|${seed.advertId ?? seed.block}`;
    const row = rows.get(key) ?? { ...seed, cells: new Map<string, RkCell>() };
    if (seed.name && !row.name) row.name = seed.name;
    rows.set(key, row);
    const cell = row.cells.get(date) ?? emptyCell(snapshot);
    row.cells.set(date, cell);
    return cell;
  };

  for (const snapshot of snapshots) {
    // Название кампании снимок не хранит — берём из справочника, если она
    // ещё жива у WB.
    const advert = snapshot.advert_id == null ? undefined : advertById.get(snapshot.advert_id);
    const cell = cellOf({
      nm: snapshot.nm_id,
      advertId: snapshot.advert_id ?? null,
      name: advert?.name ?? null,
      block: snapshot.block,
    }, snapshot.date, true);
    cell.bid = snapshot.bid == null ? cell.bid : rkNum(snapshot.bid);
    addTo(cell, snapshot);
  }

  for (const row of live) {
    const advert = advertByKey.get(advertKey(row.cabinet_id, row.advert_id));
    const block = rkAdvertBlock(advert);
    const cell = cellOf({
      nm: row.nm_id,
      advertId: row.advert_id,
      name: advert?.name ?? null,
      block: block ?? WB_RK_BLOCK_UNKNOWN,
    }, row.date, false);
    addTo(cell, row);
    const bid = advert
      ? wbAdvertBlockBid({
        bid_search_rub: advert.bid_search_rub == null ? null : rkNum(advert.bid_search_rub),
        bid_shelf_rub: advert.bid_shelf_rub == null ? null : rkNum(advert.bid_shelf_rub),
        bid_cpm_rub: advert.bid_cpm_rub == null ? null : rkNum(advert.bid_cpm_rub),
      }, block)
      : null;
    if (bid != null && bid > 0 && cell.bid == null) cell.bid = bid;
  }

  // Кампании собираются под артикулом, там же складывается его итог за день.
  const byNm = new Map<number, { nm: number; totals: Map<string, RkCell>; campaigns: RkCampaign[] }>();
  // Конверсии, приписанные чужими кампаниями, — по одной строке на артикул.
  const attributed = new Map<number, Map<string, RkCell>>();
  for (const row of rows.values()) {
    const item = byNm.get(row.nm) ?? { nm: row.nm, totals: new Map<string, RkCell>(), campaigns: [] };
    byNm.set(row.nm, item);
    // Кампания, которая этот артикул не показывала и денег на него не
    // тратила, его кампанией не является: WB просто приписал ей конверсию
    // соседнего товара. Такие строки сливаются в одну — как в кабинете WB.
    const worked = [...row.cells.values()].some((cell) => cell.views > 0 || cell.clicks > 0 || cell.spent > 0);
    const idle = [...row.cells.values()].every((cell) =>
      cell.views === 0 && cell.clicks === 0 && cell.spent === 0 && cell.carts === 0 && cell.orders === 0);
    if (idle) continue;
    if (worked) {
      item.campaigns.push({
        advertId: row.advertId,
        name: row.name,
        block: row.block,
        nmCount: row.advertId == null ? null : (advertById.get(row.advertId)?.nm_ids?.length ?? null),
        days: finishCells(row.cells),
      });
    } else {
      for (const [date, cell] of row.cells) {
        const bucket = attributed.get(row.nm) ?? new Map<string, RkCell>();
        attributed.set(row.nm, bucket);
        const target = bucket.get(date) ?? emptyCell(cell.snapshot);
        target.snapshot = target.snapshot && cell.snapshot;
        target.carts += cell.carts;
        target.orders += cell.orders;
        target.ordersSum += cell.ordersSum;
        bucket.set(date, target);
      }
    }
    for (const [date, cell] of row.cells) {
      const total = item.totals.get(date) ?? emptyCell(true);
      // День артикула считается снятым, только если снят целиком.
      total.snapshot = total.snapshot && cell.snapshot;
      total.views += cell.views;
      total.clicks += cell.clicks;
      total.spent += cell.spent;
      total.spentAllocated += cell.spentAllocated;
      total.carts += cell.carts;
      total.orders += cell.orders;
      total.ordersSum += cell.ordersSum;
      item.totals.set(date, total);
    }
  }

  for (const [nm, cells] of attributed) {
    const item = byNm.get(nm);
    if (!item) continue;
    item.campaigns.push({
      advertId: null,
      name: null,
      block: WB_RK_BLOCK_ATTRIBUTED,
      nmCount: null,
      days: finishCells(cells),
    });
  }

  const spendOf = (campaign: RkCampaign) =>
    Object.values(campaign.days).reduce((sum, cell) => sum + cell.spent, 0);

  return [...byNm.values()].filter((item) => item.campaigns.length).map((item) => ({
    nm: item.nm,
    days: finishCells(item.totals),
    // Кампании — по убыванию расхода: сверху та, что съела больше всех.
    campaigns: item.campaigns.sort((a, b) => spendOf(b) - spendOf(a)),
  }));
}
