import { wbAdvertBlock, type WbAdvertBlockInput } from "./advertBlocks";
import { reliableCtr } from "./ctrQuality";

/**
 * Какая кампания отвечает за CTR артикула в этот день.
 *
 * 05.10.2026 владелец: «CTR нужен на всех РК» — ЕРК вернулась в расчёт. Прежнее
 * правило (11.09) исключало ЕРК, и у кабинета, где вся реклама — ЕРК (Retail
 * Family), CTR по дням не было вовсе: кампании тратили тысячи рублей и крутили
 * десятки тысяч показов, а клетки пустые. Смешения шкал внутри артикула по-
 * прежнему нет: в клетке одна кампания и подпись её вида; ЕРК видна отдельным
 * вариантом фильтра, и столбец можно привести к одной шкале.
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

/** Модель оплаты кампании. */
export type CtrPaymentModel = "cpc" | "cpm";
/** Вид кампании для CTR: оплата за клик, за показы или единая ставка. */
export type CtrCampaignKind = CtrPaymentModel | "erk";

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
 * ЕРК возвращается отдельным значением, а не `null` и не «cpm»: у него в
 * карточке WB написано `payment_type: "cpm"`, и без отдельного значения он
 * слился бы с обычным CPM. Отличает ЕРК только тип ставки — `bid_type: "unified"`.
 */
export function ctrPaymentModel(advert: WbAdvertBlockInput | null | undefined): CtrCampaignKind | null {
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
 * Что известно о дне: лучшая кампания каждого вида и сколько отброшено.
 *
 * Хранится по кампании на вид, а не одна выбранная, чтобы фильтр «вид
 * размещения» на экране переключался без похода на сервер и без второго
 * правила отбора на клиенте.
 */
export interface CtrDayPick {
  cpc: CtrCandidate | null;
  cpm: CtrCandidate | null;
  erk: CtrCandidate | null;
  /** Сколько кампаний в этот день отброшено: неразмеченные, нерабочие, уступившие своему виду. */
  dropped: number;
}

export type CtrModelFilter = "any" | CtrCampaignKind;

/**
 * Лучшая кампания дня при выбранном фильтре.
 *
 * «Больше потратила» — решение владельца: из параллельных рабочей была та,
 * на которую шли деньги. Сравнение по показам дало бы почти то же самое (на
 * живых данных расхождение в одну клетку из 929), но расход — это намерение, а
 * показы — следствие, и объяснять человеку проще намерение. При ничьей берём
 * CPM, затем CPC, затем ЕРК — как раньше шли виды: порядок стабилен, число не
 * прыгает от перезагрузки к перезагрузке.
 */
export function pickCtrCampaign(pick: CtrDayPick | null | undefined, filter: CtrModelFilter): CtrCandidate | null {
  if (!pick) return null;
  if (filter === "cpc") return pick.cpc;
  if (filter === "cpm") return pick.cpm;
  if (filter === "erk") return pick.erk;
  let best: CtrCandidate | null = null;
  for (const candidate of [pick.cpm, pick.cpc, pick.erk]) {
    if (candidate && (!best || candidate.spent > best.spent)) best = candidate;
  }
  return best;
}

/** Каким видом кампании посчитан CTR клетки. */
export function ctrPickModel(pick: CtrDayPick | null | undefined, filter: CtrModelFilter): CtrCampaignKind | null {
  const chosen = pickCtrCampaign(pick, filter);
  if (!chosen) return null;
  if (chosen === pick?.cpm) return "cpm";
  if (chosen === pick?.erk) return "erk";
  return "cpc";
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
 * Кандидат обязан пройти два условия: иметь определённый вид (CPC, CPM или
 * ЕРК — неразмеченные выбывают) и потратить не меньше порога. Всё, что не
 * прошло, попадает в `dropped` — число нужно экрану, чтобы сказать человеку, что
 * цифра собрана не из всего, что он видит в столбце показов.
 */
export function buildCtrDayPick(
  rows: readonly CtrCampaignRowInput[],
  modelOf: (advertId: number) => CtrCampaignKind | null,
): CtrDayPick {
  const pick: CtrDayPick = { cpc: null, cpm: null, erk: null, dropped: 0 };
  for (const row of rows) {
    const model = modelOf(row.advertId);
    const working = (model === "cpc" || model === "cpm" || model === "erk") && row.spent >= CTR_MIN_CAMPAIGN_SPEND;
    if (!working) {
      // Пустая строка кампании — не отброшенный кандидат, а её отсутствие:
      // товар был в кампании, но она его в этот день не крутила.
      if (row.views > 0 || row.clicks > 0 || row.spent > 0) pick.dropped += 1;
      continue;
    }
    const candidate: CtrCandidate = { advertId: row.advertId, views: row.views, clicks: row.clicks, spent: row.spent };
    const slot = model === "cpc" ? "cpc" : model === "erk" ? "erk" : "cpm";
    const current = pick[slot];
    if (!current || candidate.spent > current.spent) {
      if (current) pick.dropped += 1;
      pick[slot] = candidate;
    } else {
      pick.dropped += 1;
    }
  }
  // Расход округляем ОДИН раз, после выбора лучшей внутри вида: на экран он
  // едет целым (ctrPickToWire), и выбор между видами при «ничьей» на клиенте
  // иначе разошёлся бы с окном разбора, считающим по дробным (149,6 против
  // 150,4: сервер брал ЕРК, клиент после округления — CPM). Внутри вида
  // сравнение идёт по дробным, пока не выбран победитель.
  for (const slot of ["cpc", "cpm", "erk"] as const) {
    const chosen = pick[slot];
    if (chosen) pick[slot] = { ...chosen, spent: Math.round(chosen.spent) };
  }
  return pick;
}

type CtrCandidateWire = [number, number, number, number];
/**
 * Компактная форма для ответа API: массивы вместо объектов экономят мегабайты.
 * Четвёртый элемент (ЕРК) добавлен 05.10.2026; индексы 0–2 не менялись, а
 * снимок прежней формы читается — у него ЕРК просто нет.
 */
export type CtrDayPickWire = [cpc: CtrCandidateWire | null, cpm: CtrCandidateWire | null, dropped: number, erk?: CtrCandidateWire | null];

export function ctrPickToWire(pick: CtrDayPick): CtrDayPickWire {
  const wire = (candidate: CtrCandidate | null) =>
    candidate ? ([candidate.advertId, candidate.views, candidate.clicks, Math.round(candidate.spent)] as CtrCandidateWire) : null;
  return [wire(pick.cpc), wire(pick.cpm), pick.dropped, wire(pick.erk)];
}

export function ctrPickFromWire(wire: CtrDayPickWire | null | undefined): CtrDayPick | null {
  if (!Array.isArray(wire)) return null;
  const candidate = (value: CtrCandidateWire | null | undefined): CtrCandidate | null =>
    Array.isArray(value) ? { advertId: value[0], views: value[1], clicks: value[2], spent: value[3] } : null;
  return { cpc: candidate(wire[0]), cpm: candidate(wire[1]), erk: candidate(wire[3]), dropped: Number(wire[2] ?? 0) };
}

export const CTR_MODEL_LABEL: Record<CtrCampaignKind, string> = {
  cpc: "CPC",
  cpm: "CPM",
  erk: "ЕРК",
};
