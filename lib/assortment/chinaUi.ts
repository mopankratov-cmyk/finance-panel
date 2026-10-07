import { plural } from "@/lib/warehouse/plural";
import type { ChinaChange, ChinaOfferCard, ChinaRefCopies } from "./chinaStore";

/**
 * «Китай (1688)» — тексты экрана (вкладка раздела, строка «ставки фабрик» в ленте «Залетает»). Чистые функции без базы и сети — годятся
 * для браузера. Границы: цены и продавцов не показываем; оптовые продажи в Китае — не спрос WB; рекомендация — не решение о закупке.
 * У каждого числа — происхождение: факт 1688 / расчёт / оценка / гипотеза.
 */

export const CHINA_TAB_LABEL = "Китай (1688)";

/** Подпись блока: что это и чем не является. */
export const CHINA_SCREEN_NOTE = "Оптовые продажи в Китае — не спрос WB; цены не показываем. Это наблюдение рынка 1688, а не решение о закупке.";

/** «2026-10-05» → «05.10». */
export const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

export type BadgeKind = "fact" | "estimate" | "hypothesis";

/** Значки карточки топа: текст и происхождение (по словам 1688, по нашей оценке или со слов продавца). */
export function offerBadges(card: Pick<ChinaOfferCard, "badges" | "isNew">): Array<{ key: string; text: string; kind: BadgeKind; title: string }> {
  const out: Array<{ key: string; text: string; kind: BadgeKind; title: string }> = [];
  if (card.badges.includes("yx")) out.push({ key: "yx", text: "严选 · отбор 1688", kind: "fact", title: "Карточка из подборки «严选» 1688 — отметка площадки" });
  if (card.badges.includes("inspected")) out.push({ key: "inspected", text: "проверено 1688", kind: "fact", title: "Официальная проверка 1688 — отметка площадки" });
  if (card.isNew) out.push({ key: "new", text: "новинка — оценка", kind: "estimate", title: "Новинка по номеру карточки (номера растут со временем) — оценка" });
  if (card.badges.includes("claims_new")) out.push({ key: "claims_new", text: "«新款» — со слов продавца", kind: "hypothesis", title: "Продавец пишет «новинка» в названии — заявление, гипотеза" });
  if (card.badges.includes("unisex")) out.push({ key: "unisex", text: "унисекс — со слов продавца", kind: "hypothesis", title: "В названии продавца и «男», и «女» — заявление продавца, гипотеза" });
  return out;
}

/** Неделя к неделе по позиции в выдаче: «новое в топе», «поднялось на N», «опустилось на N»; «как было» и без сравнения — ничего. */
export function changeText(change: ChinaChange | null): { text: string; tone: "new" | "up" | "down" } | null {
  if (!change) return null;
  if (change.kind === "new") return { text: "новое в топе", tone: "new" };
  if (change.kind === "rose") return { text: `поднялось на ${change.from - change.to}`, tone: "up" };
  if (change.kind === "fell") return { text: `опустилось на ${change.to - change.from}`, tone: "down" };
  return null;
}

/** Счётчик продаж 1688 — накопленный и округлённый «корзиной»: «5000+» — нижняя граница; период 1688 не указывает. */
export function soldText(card: Pick<ChinaOfferCard, "soldText" | "soldMin">): string | null {
  if (card.soldText) return `продано ${card.soldText}`;
  if (card.soldMin != null) return `продано от ${card.soldMin.toLocaleString("ru-RU")}`;
  return null;
}

/** Первый номер рилса, по которому есть снимок копий на 1688 (порядок — как в рилсе). */
export function chinaCopiesFor(refs: readonly string[], copies: Readonly<Record<string, ChinaRefCopies>> | null | undefined): ChinaRefCopies | null {
  if (!copies) return null;
  for (const ref of refs) {
    const hit = copies[ref];
    if (hit) return hit;
  }
  return null;
}

const DAY_MS = 24 * 3600 * 1000;

/**
 * Отрезок прироста словами: снимки ровно через неделю — «за неделю», иначе — «с ДД.ММ». Номер мог выпадать из недельного снимка (в неделю —
 * до 20 номеров из рилсов), и прошлый снимок того же запроса бывает на 2–3 недели старше: «+3 за неделю» тогда было бы неправдой.
 */
export function deltaPeriod(observedOn: string, previousOn: string): string {
  const days = Math.round((Date.parse(`${observedOn}T00:00:00Z`) - Date.parse(`${previousOn}T00:00:00Z`)) / DAY_MS);
  return days === 7 ? "за неделю" : `с ${dm(previousOn)}`;
}

/** Прирост копий в скобках: «(+2 за неделю)», «(+3 с 14.09)», «(−1 за неделю)», «(за неделю столько же)»; без прошлого снимка — пусто. */
export function copiesDeltaText(delta: number | null, observedOn: string, previousOn: string | null): string {
  if (delta == null || !previousOn) return "";
  const period = deltaPeriod(observedOn, previousOn);
  if (delta > 0) return ` (+${delta} ${period})`;
  if (delta < 0) return ` (−${Math.abs(delta)} ${period})`;
  return period === "за неделю" ? " (за неделю столько же)" : ` (столько же, сколько ${dm(previousOn)})`;
}

/**
 * Строка «ставки фабрик» в карточке рилса: «на 1688: 3 копии (+2 за неделю)». Число копий — карточки 1688 с номером в названии; поиск
 * 1688 смысловой и находит часть карточек, поэтому это оценка снизу; прирост — расчёт к прошлому снимку номера того же запроса (не всегда
 * ровно неделю назад — тогда «с ДД.ММ»).
 */
export function copiesLine(c: ChinaRefCopies): { text: string; note: string } {
  const delta = copiesDeltaText(c.delta, c.observedOn, c.previousOn);
  const text = c.offers > 0
    ? `На 1688: ${c.offers} ${plural(c.offers, "копия", "копии", "копий")}${delta}`
    : `На 1688 копий по номеру не нашли${c.delta != null && c.delta < 0 ? delta : ""}`;
  const note = `оценка снизу: поиск 1688 находит часть карточек${c.delta != null ? "; прирост — расчёт" : ""}; снимок ${dm(c.observedOn)}`;
  return { text, note };
}
