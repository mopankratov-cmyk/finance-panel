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
//
// Снимок при этом НЕ считается доказательством того, что день собран целиком:
// синк статистики обходит кампании срезами, и к 06:00 половина кабинета в слой
// ещё не доехала. Поэтому источник выбирается по покрытию (chooseRkDaySources),
// а снимок за неполный день остаётся памятью о ставке и виде размещения — той
// правде, которой в слое нет вовсе.

import { wbAdvertBlock, wbAdvertBlockBid, WB_RK_BLOCKS, WB_RK_BLOCK_ATTRIBUTED, WB_RK_BLOCK_UNKNOWN, type WbRkBlock } from "./advertBlocks";

export interface RkSnapshotRow {
  cabinet_id?: string | null;
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
  /**
   * Ставка второй площадки у видов «поиск + полки». WB держит две разные
   * ставки, а колонка на экране одна: показывать только поисковую значит
   * молча прятать вторую (у 77 из 78 таких кампаний они не совпадают).
   * null — либо вид не двойной, либо ставки равны и вторая ничего не добавит.
   */
  bidAlt: number | null;
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
  /** Вид размещения, на котором кампания сожгла больше всего денег в окне. */
  block: string;
  name: string | null;
  /**
   * Вид размещения по дням. Заполнен, ТОЛЬКО если он менялся внутри окна —
   * WB разрешает включать и выключать площадки на живую, и кампания,
   * крутившаяся в понедельник в поиске, а во вторник на полках, обязана
   * попасть в обе карточки, а не в ту, что настроена сегодня.
   */
  blocks?: Record<string, string>;
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
  return { bid: null, bidAlt: null, views: 0, clicks: 0, spent: 0, spentAllocated: 0, carts: 0, orders: 0, ordersSum: 0, snapshot };
}

const isRealBlock = (value: string | null | undefined): value is WbRkBlock =>
  WB_RK_BLOCKS.includes(value as WbRkBlock);

/** Пара «кампания × артикул» за день — общий ключ обоих источников. */
const sourceKey = (cabinetId: string | null | undefined, date: string, advertId: number | null | undefined, nm: number) =>
  `${cabinetId ?? ""}|${date}|${advertId ?? "-"}|${nm}`;

export interface RkDaySources {
  /** Дни, где снимок покрывает не меньше слоя и остаётся источником метрик. */
  snapshotDates: string[];
  /** Дни, где слой знает больше снимка: метрики берём из него. */
  liveDates: string[];
}

/**
 * Какой источник за какой день считать правдой.
 *
 * Раньше правило было «есть хоть одна строка снимка — день закрыт», и этого
 * хватало, чтобы заморозить утренний огрызок дня навсегда: синк статистики
 * обходит кампании срезами по 50 и за прогон берёт четыре среза, поэтому к
 * 06:00 в слое лежат первые несколько сотен кампаний, а остальные доезжают
 * через десять часов — в снимок этого дня уже никогда. По кабинету на 1174
 * кампании снимок удерживал 15–25% дневного расхода, и экран расходился с РНП
 * вчетверо.
 *
 * Сравниваем покрытие в парах «кампания × артикул»: снимок остаётся источником,
 * только если он знает ВСЁ, что знает слой. Считать пары числом мало — у
 * снимка и слоя может совпасть размер при разном составе, и день с чужой
 * кампанией снова замёрзнет неполным. Иначе метрики берём из слоя, а снимок
 * продолжает работать памятью о ставке и виде размещения того дня.
 */
export function chooseRkDaySources(snapshots: RkSnapshotRow[], live: RkCampaignDayRow[]): RkDaySources {
  const pairs = (rows: { cabinet_id?: string | null; date: string; advert_id?: number | null; nm_id: number }[]) => {
    const byDate = new Map<string, Set<string>>();
    for (const row of rows) {
      const set = byDate.get(row.date) ?? new Set<string>();
      set.add(`${row.cabinet_id ?? ""}|${row.advert_id ?? "-"}|${row.nm_id}`);
      byDate.set(row.date, set);
    }
    return byDate;
  };
  const snapped = pairs(snapshots);
  const raw = pairs(live);
  const snapshotDates: string[] = [];
  const liveDates: string[] = [];
  for (const date of [...new Set([...snapped.keys(), ...raw.keys()])].sort()) {
    const snappedSet = snapped.get(date);
    const rawSet = raw.get(date);
    const covered = (snappedSet?.size ?? 0) > 0
      && [...(rawSet ?? [])].every((pair) => snappedSet!.has(pair));
    if (covered) snapshotDates.push(date);
    else liveDates.push(date);
  }
  return { snapshotDates, liveDates };
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

/**
 * У двух источников РАЗНАЯ семантика поля `spent`, и это главная ловушка
 * журнала.
 *
 * Сырой слой (`wb_advert_nm_campaign_daily`) хранит измеренный WB расход, а
 * разложенный остаток кампании лежит отдельно в `spent_allocated` — журналу
 * нужна их сумма. А снимок (`wb_rk_journal_daily`) кладёт в `spent` УЖЕ полную
 * сумму и дублирует разложенное рядом «на память» (см. sync/rk-journal). Пока
 * читатель применял формулу сырого слоя ко всем строкам, каждый снятый день
 * считал разложенное ДВАЖДЫ: по кабинету это около 5% лишнего расхода, а по
 * карточке, где WB не разнёс расход вовсе, — ровно вдвое. Отсюда и расхождение
 * с РНП, который читает витрину, где раскладка учтена один раз.
 */
function addTo(cell: RkCell, row: MetricSource, spentIsFull: boolean) {
  const allocated = rkNum(row.spent_allocated);
  cell.views += rkNum(row.views);
  cell.clicks += rkNum(row.clicks);
  cell.spent += spentIsFull ? rkNum(row.spent) : rkNum(row.spent) + allocated;
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

  interface Row {
    nm: number;
    advertId: number | null;
    name: string | null;
    block: string;
    /** Вид размещения по дням: WB меняет площадки кампании на живую. */
    blockByDate: Map<string, string>;
    cells: Map<string, RkCell>;
  }
  const rows = new Map<string, Row>();
  const cellOf = (seed: Omit<Row, "cells" | "blockByDate">, date: string, snapshot: boolean) => {
    // Строки снимка до перехода на кампании остались без advert_id — они
    // группируются по виду размещения, как и раньше.
    const key = `${seed.nm}|${seed.advertId ?? seed.block}`;
    const row = rows.get(key) ?? { ...seed, blockByDate: new Map<string, string>(), cells: new Map<string, RkCell>() };
    if (seed.name && !row.name) row.name = seed.name;
    // Вид размещения раньше брался из ПЕРВОГО попавшегося источника, а снимки
    // читаются раньше живого слоя. Кампания, попавшая в старый снимок до того,
    // как WB отдал её настройки, навсегда оставалась «вид не определён» — и
    // карточка её вида честно писала «нет кампаний», хотя кампания есть.
    // Известный вид всегда сильнее неизвестного.
    if (row.block === WB_RK_BLOCK_UNKNOWN && seed.block !== WB_RK_BLOCK_UNKNOWN) row.block = seed.block;
    const knownForDay = row.blockByDate.get(date);
    if (!knownForDay || knownForDay === WB_RK_BLOCK_UNKNOWN) row.blockByDate.set(date, seed.block);
    rows.set(key, row);
    const cell = row.cells.get(date) ?? emptyCell(snapshot);
    row.cells.set(date, cell);
    return cell;
  };

  const { liveDates } = chooseRkDaySources(snapshots, live);
  const liveDateSet = new Set(liveDates);

  // Память снимка: ставка и вид размещения того дня. Нужна и за дни, метрики
  // которых мы берём из слоя, — ни ставки, ни площадок в слое нет вовсе.
  const memory = new Map<string, RkSnapshotRow>();
  for (const row of snapshots) memory.set(sourceKey(row.cabinet_id, row.date, row.advert_id, row.nm_id), row);
  const liveKeys = new Set<string>();
  for (const row of live) liveKeys.add(sourceKey(row.cabinet_id, row.date, row.advert_id, row.nm_id));

  /**
   * Вид размещения на КОНКРЕТНЫЙ день. Снятый вид — факт того дня; нынешние
   * настройки кампании о вчерашнем размещении не свидетельствуют. Справочник
   * подставляется только там, где снимок вида не знал.
   */
  const blockOfDay = (frozen: string | null | undefined, advert: RkAdvertRow | undefined): string =>
    isRealBlock(frozen) ? frozen : rkAdvertBlock(advert) ?? frozen ?? WB_RK_BLOCK_UNKNOWN;

  /** Ставки блока: основная и вторая площадка у видов «поиск + полки». */
  const applyBids = (cell: RkCell, advert: RkAdvertRow, block: string) => {
    const search = advert.bid_search_rub == null ? null : rkNum(advert.bid_search_rub);
    const shelf = advert.bid_shelf_rub == null ? null : rkNum(advert.bid_shelf_rub);
    const cpm = advert.bid_cpm_rub == null ? null : rkNum(advert.bid_cpm_rub);
    if (cell.bid == null) {
      const bid = wbAdvertBlockBid(
        { bid_search_rub: search, bid_shelf_rub: shelf, bid_cpm_rub: cpm },
        isRealBlock(block) ? block : null,
      );
      if (bid != null && bid > 0) cell.bid = bid;
    }
    if (block !== "cpc_both" && block !== "cpm_both" && block !== "erk") return;
    const primary = search ?? cpm;
    if (primary != null && shelf != null && primary > 0 && shelf > 0 && primary !== shelf) cell.bidAlt = shelf;
  };

  for (const snapshot of snapshots) {
    // За дни, где слой знает больше снимка, метрики уступаются слою — но только
    // по тем парам, которые в слое действительно есть: строку, которую слой
    // потерял, снимок обязан донести сам.
    const key = sourceKey(snapshot.cabinet_id, snapshot.date, snapshot.advert_id, snapshot.nm_id);
    if (liveDateSet.has(snapshot.date) && liveKeys.has(key)) continue;
    // Название кампании снимок не хранит — берём из справочника, если она
    // ещё жива у WB.
    const advert = snapshot.advert_id == null ? undefined : advertById.get(snapshot.advert_id);
    const cell = cellOf({
      nm: snapshot.nm_id,
      advertId: snapshot.advert_id ?? null,
      name: advert?.name ?? null,
      block: blockOfDay(snapshot.block, advert),
    }, snapshot.date, true);
    cell.bid = snapshot.bid == null ? cell.bid : rkNum(snapshot.bid);
    addTo(cell, snapshot, true);
  }

  for (const row of live) {
    if (!liveDateSet.has(row.date)) continue;
    const advert = advertByKey.get(advertKey(row.cabinet_id, row.advert_id));
    const frozen = memory.get(sourceKey(row.cabinet_id, row.date, row.advert_id, row.nm_id));
    const block = blockOfDay(frozen?.block, advert);
    const cell = cellOf({
      nm: row.nm_id,
      advertId: row.advert_id,
      name: advert?.name ?? null,
      block,
    }, row.date, false);
    addTo(cell, row, false);
    // Ставка того дня — из снимка, если он её запомнил: нынешняя ставка из
    // справочника к прошедшему дню отношения не имеет.
    if (cell.bid == null && frozen?.bid != null) cell.bid = rkNum(frozen.bid);
    if (advert) applyBids(cell, advert, block);
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
    // Кампания принадлежит артикулу, если WB держит его в её составе — даже
    // когда в выбранном окне она его не показывала (крутилась раньше, заказ
    // пришёл позже). Показы и расход в окне — второй признак: состав у
    // завершённых кампаний WB уже не отдаёт.
    const owns = row.advertId != null && (advertById.get(row.advertId)?.nm_ids ?? []).includes(row.nm);
    const worked = owns || [...row.cells.values()].some((cell) => cell.views > 0 || cell.clicks > 0 || cell.spent > 0);
    const idle = [...row.cells.values()].every((cell) =>
      cell.views === 0 && cell.clicks === 0 && cell.spent === 0 && cell.carts === 0 && cell.orders === 0);
    if (idle) continue;
    if (worked) {
      // Подпись строки — вид, на котором кампания сожгла больше всего денег;
      // поденная раскладка едет рядом, чтобы карточки считались по дням, а не
      // по одному ярлыку на всё окно.
      const spentByBlock = new Map<string, number>();
      for (const [date, cell] of row.cells) {
        const dayBlock = row.blockByDate.get(date) ?? row.block;
        spentByBlock.set(dayBlock, (spentByBlock.get(dayBlock) ?? 0) + cell.spent);
      }
      const seen = [...new Set(row.blockByDate.values())];
      const dominant = seen.length <= 1
        ? seen[0] ?? row.block
        : [...spentByBlock.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? row.block;
      item.campaigns.push({
        advertId: row.advertId,
        block: dominant,
        name: row.name,
        ...(seen.length > 1 ? { blocks: Object.fromEntries(row.blockByDate) } : {}),
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
