/**
 * Три группы доказательств карточки модели: новизна, распространение, ритейл.
 * Чистые функции.
 *
 * ТЗ §5: каждое утверждение раскрывается до источника, даты, региона и способа
 * получения; недоступный факт — «нет данных» с причиной, а не ноль и не пустота.
 */

import { cleanBadge, type ObservationLite } from "./signals";

export type EvidenceGroup = "novelty" | "spread" | "retail";

export interface EvidenceObservation extends ObservationLite {
  method: string;
  region: string | null;
  source_url: string | null;
}

export interface EvidenceRow {
  label: string;
  value: string;
  detail: string;
  sourceUrl: string | null;
  missing: boolean;
}

export const GROUP_LABEL: Record<EvidenceGroup, string> = {
  novelty: "Новизна",
  spread: "Распространение",
  retail: "Ритейл",
};

const METRIC_LABEL: Record<string, string> = {
  first_seen: "Впервые у нас",
  published_at: "Опубликовано на сайте",
  new_badge: "Метка ритейлера",
  bestseller_badge: "Отметка бестселлера",
  reviews_count: "Отзывы на сайте магазина",
  rating: "Рейтинг на сайте магазина",
};

const BADGE_METRICS = new Set(["new_badge", "bestseller_badge"]);

const METHOD_LABEL: Record<string, string> = {
  import_url: "добавлено по ссылке",
  import_manual: "добавлено по фото",
  crawl_shopify: "автообход каталога",
  brightdata_asos: "сбор Bright Data с ASOS",
  brightdata_hm: "сбор Bright Data с H&M",
  shopify_published_at: "дата публикации из карточки",
  shopify_tags: "теги карточки",
};

const STATUS_LABEL: Record<string, string> = {
  observed: "наблюдение системы",
  retailer_claim: "заявление магазина",
  provider_estimate: "оценка поставщика данных",
  forecast: "прогноз",
  manual: "ввод вручную",
};

const DATE_METRICS = new Set(["first_seen", "published_at"]);

export function ruDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Moscow" });
}

function rowFrom(o: EvidenceObservation): EvidenceRow {
  const raw = o.value_text ?? (o.value_num != null ? String(o.value_num) : null);
  const value = raw == null
    ? `нет данных${o.null_reason ? ` — ${o.null_reason}` : ""}`
    : DATE_METRICS.has(o.metric) ? ruDate(raw) : BADGE_METRICS.has(o.metric) ? cleanBadge(raw) : raw;
  const detail = [
    BADGE_METRICS.has(o.metric) && raw ? `тег «${raw}»` : null,
    METHOD_LABEL[o.method] ?? o.method,
    STATUS_LABEL[o.status] ?? o.status,
    `записано ${ruDate(o.observed_at)}`,
    o.region || null,
  ].filter(Boolean).join(" · ");
  return { label: METRIC_LABEL[o.metric] ?? o.metric, value, detail, sourceUrl: o.source_url, missing: raw == null };
}

const missing = (label: string, value: string, detail: string): EvidenceRow => ({ label, value, detail, sourceUrl: null, missing: true });

/**
 * similarOtherBrands — сколько моделей других брендов похожи по фото; null —
 * отпечатки ещё не посчитаны (тогда честное «не проверялось»).
 */
export function buildEvidence(observations: EvidenceObservation[], similarOtherBrands: number | null = null): Record<EvidenceGroup, EvidenceRow[]> {
  const by = (group: EvidenceGroup) => observations
    .filter((o) => o.group_kind === group)
    .sort((a, b) => a.observed_at.localeCompare(b.observed_at))
    .map(rowFrom);
  const novelty = by("novelty");
  if (!observations.some((o) => o.metric === "published_at")) {
    novelty.push(missing("Опубликовано на сайте", "неизвестно", "сайт не отдал дату публикации"));
  }
  const spread = by("spread");
  if (spread.length === 0) {
    spread.push(missing("Независимые публикации", "нет данных", "соцсети пока не подключены"));
    if (similarOtherBrands === null) {
      spread.push(missing("Похожие модели у других брендов", "не проверялось", "отпечаток фото ещё не посчитан"));
    } else if (similarOtherBrands === 0) {
      spread.push(missing("Похожие модели у других брендов", "по фото не нашлось", "среди моделей раздела в ленте"));
    } else {
      spread.push({
        label: "Похожие модели у других брендов",
        value: `${similarOtherBrands} по фото`,
        detail: "сходство по фото — подсказка, а не доказательство одной модели; смотрите блок «Похожие модели»",
        sourceUrl: null,
        missing: false,
      });
    }
  }
  const retail = by("retail");
  if (retail.length === 0) {
    retail.push(missing("Метка новинки или бестселлера", "не найдена", "на странице её не было или страница закрыта для чтения"));
  }
  return { novelty, spread, retail };
}
