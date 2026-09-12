import { wbAdvertBlock, type WbAdvertBlockInput } from "./advertBlocks";
import { reliableCtr } from "./ctrQuality";

/**
 * Какая кампания отвечает за CTR артикула в этот день.
 *
 * Колонка CTR в воронке годами показывала сумму по всем кампаниям сразу, а это
 * разные шкалы, сложенные в одно число. Живая сверка за 14 дней (12.09.2026):
 *
 *   ЕРК   4,48%   6,06 млн показов
 *   CPM   4,32%   8,22 млн показов
 *   CPC   3,77%   5,73 млн показов
 *
 * Разрыв между CPC и CPM — четверть относительных. Складывая их, панель
 * отвечала не «как работает обложка», а «какой смесью кампаний крутили товар»:
 * в 31,5% клеток с показами в один день работали две кампании и больше.
 *
 * Решение владельца (11.09.2026): смешения быть не должно, а из нескольких
 * параллельных берём ту, что потратила больше, — она и была рабочей.
 */

/** Модель оплаты для CTR. `erk` и `null` из расчёта выпадают. */
export type CtrPaymentModel = "cpc" | "cpm";

/**
 * Порог «кампания в этот день реально работала».
 *
 * Решение владельца. Кампания, потратившая за сутки десятки рублей, крутилась
 * остатками бюджета, и её доля клика описывает не обложку, а обрывок показа.
 * Порог по показам (CTR_MIN_VIEWS) отвечает на другой вопрос — хватает ли
 * знаменателя, чтобы доля вообще что-то значила; одно другого не заменяет.
 *
 * Цена порога измерена на живых данных за 14 дней: клеток с числом было 1 201,
 * остаётся 929. Отброшенное — дни, когда рабочей кампании попросту не было.
 */
export const CTR_MIN_CAMPAIGN_SPEND = 100;

/**
 * Модель оплаты кампании — через общий словарь видов размещения.
 *
 * Своего разбора здесь нет намеренно: разметка кампаний живёт в advertBlocks и
 * уже знает про `bid_type`, ручные переопределения и старые строки синка. Второй
 * разбор разошёлся бы с журналом РК на первой же правке.
 *
 * ЕРК возвращается отдельным значением, а не `null`: у него в карточке WB
 * написано `payment_type: "cpm"`, и правило «берём только cpc и cpm» пропустило
 * бы его внутрь. Отличает ЕРК только тип ставки — `bid_type: "unified"`.
 */
export function ctrPaymentModel(advert: WbAdvertBlockInput | null | undefined): CtrPaymentModel | "erk" | null {
  if (!advert) return null;
  const block = wbAdvertBlock(advert);
  if (!block) return null;
  if (block === "erk") return "erk";
  return block.startsWith("cpc") ? "cpc" : "cpm";
}

/** Кампания-кандидат за один день по одному артикулу. */
export interface CtrCandidate {
  advertId: number;
  views: number;
  clicks: number;
  spent: number;
}

/**
 * Что известно о дне: лучшая кампания каждой модели и сколько отброшено.
 *
 * Хранится по кампании на модель, а не одна выбранная, чтобы фильтр «вид
 * размещения» на экране переключался без похода на сервер и без второго
 * правила отбора на клиенте.
 */
export interface CtrDayPick {
  cpc: CtrCandidate | null;
  cpm: CtrCandidate | null;
  /** Сколько кампаний в этот день отброшено: ЕРК, неразмеченные, нерабочие. */
  dropped: number;
}

export type CtrModelFilter = "any" | CtrPaymentModel;

/**
 * Лучшая кампания дня при выбранном фильтре.
 *
 * «Больше потратила» — решение владельца: из двух параллельных рабочей была та,
 * на которую шли деньги. Сравнение по показам дало бы почти то же самое (на
 * живых данных расхождение в одну клетку из 929), но расход — это намерение, а
 * показы — следствие, и объяснять человеку проще намерение.
 */
export function pickCtrCampaign(pick: CtrDayPick | null | undefined, filter: CtrModelFilter): CtrCandidate | null {
  if (!pick) return null;
  if (filter === "cpc") return pick.cpc;
  if (filter === "cpm") return pick.cpm;
  if (!pick.cpc) return pick.cpm;
  if (!pick.cpm) return pick.cpc;
  return pick.cpm.spent >= pick.cpc.spent ? pick.cpm : pick.cpc;
}

/** Какой моделью оплаты посчитан CTR клетки. */
export function ctrPickModel(pick: CtrDayPick | null | undefined, filter: CtrModelFilter): CtrPaymentModel | null {
  const chosen = pickCtrCampaign(pick, filter);
  if (!chosen) return null;
  return chosen === pick?.cpm ? "cpm" : "cpc";
}

/**
 * CTR клетки: доля клика выбранной кампании.
 *
 * `null` — рабочей кампании не нашлось или показов слишком мало. Ноль здесь был
 * бы утверждением «рекламу крутили, кликов не было», а это другое событие.
 */
export function ctrOfPick(pick: CtrDayPick | null | undefined, filter: CtrModelFilter): number | null {
  const chosen = pickCtrCampaign(pick, filter);
  if (!chosen) return null;
  return reliableCtr(chosen.views, chosen.clicks);
}

export interface CtrCampaignRowInput {
  advertId: number;
  views: number;
  clicks: number;
  spent: number;
}

/**
 * Свернуть кампании одного дня в выбор.
 *
 * Кандидат обязан пройти два условия: быть CPC или CPM (ЕРК и неразмеченные
 * выбывают) и потратить не меньше порога. Всё, что не прошло, попадает в
 * `dropped` — число нужно экрану, чтобы сказать человеку, что цифра собрана не
 * из всего, что он видит в столбце показов.
 */
export function buildCtrDayPick(
  rows: readonly CtrCampaignRowInput[],
  modelOf: (advertId: number) => CtrPaymentModel | "erk" | null,
): CtrDayPick {
  const pick: CtrDayPick = { cpc: null, cpm: null, dropped: 0 };
  for (const row of rows) {
    const model = modelOf(row.advertId);
    const working = (model === "cpc" || model === "cpm") && row.spent >= CTR_MIN_CAMPAIGN_SPEND;
    if (!working) {
      // Пустая строка кампании — не отброшенный кандидат, а её отсутствие:
      // товар был в кампании, но она его в этот день не крутила.
      if (row.views > 0 || row.clicks > 0 || row.spent > 0) pick.dropped += 1;
      continue;
    }
    const candidate: CtrCandidate = { advertId: row.advertId, views: row.views, clicks: row.clicks, spent: row.spent };
    const slot = model === "cpc" ? "cpc" : "cpm";
    const current = pick[slot];
    if (!current || candidate.spent > current.spent) {
      if (current) pick.dropped += 1;
      pick[slot] = candidate;
    } else {
      pick.dropped += 1;
    }
  }
  return pick;
}

/** Компактная форма для ответа API: массивы вместо объектов экономят мегабайты. */
export type CtrDayPickWire = [cpc: [number, number, number, number] | null, cpm: [number, number, number, number] | null, dropped: number];

export function ctrPickToWire(pick: CtrDayPick): CtrDayPickWire {
  const wire = (candidate: CtrCandidate | null) =>
    candidate ? ([candidate.advertId, candidate.views, candidate.clicks, Math.round(candidate.spent)] as [number, number, number, number]) : null;
  return [wire(pick.cpc), wire(pick.cpm), pick.dropped];
}

export function ctrPickFromWire(wire: CtrDayPickWire | null | undefined): CtrDayPick | null {
  if (!Array.isArray(wire)) return null;
  const candidate = (value: [number, number, number, number] | null): CtrCandidate | null =>
    Array.isArray(value) ? { advertId: value[0], views: value[1], clicks: value[2], spent: value[3] } : null;
  return { cpc: candidate(wire[0]), cpm: candidate(wire[1]), dropped: Number(wire[2] ?? 0) };
}

export const CTR_MODEL_LABEL: Record<CtrPaymentModel, string> = {
  cpc: "CPC",
  cpm: "CPM",
};
