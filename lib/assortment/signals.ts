/**
 * «Почему показали» и метка сигнала для карточки ленты. Чистые функции.
 *
 * Говорим только о том, что наблюдали: без «быстро растёт» при одном
 * наблюдении и без выдуманных продаж (ТЗ §7). Одна находка честно названа
 * одной находкой.
 */

export interface ObservationLite {
  group_kind: "novelty" | "spread" | "retail";
  metric: string;
  value_text: string | null;
  value_num: number | null;
  null_reason: string | null;
  status: string;
  observed_at: string;
}

export type SignalTone = "retail" | "novelty" | "single" | "manual";

export interface CardSignal {
  label: string;
  tone: SignalTone;
  why: string;
}

const ru = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Moscow" });
};

/** Тег магазина в человеческом виде: «LABEL:NEW» → «NEW», «bestsellers-resort» → «bestsellers resort». */
export function cleanBadge(tag: string): string {
  const tail = tag.includes(":") ? tag.slice(tag.lastIndexOf(":") + 1) : tag;
  return tail.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || tag;
}

export function pluralColors(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "цвет";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "цвета";
  return "цветов";
}

export function cardSignal(observations: ObservationLite[], options: { manual: boolean; colors: number }): CardSignal {
  const badge = observations.find((o) => o.group_kind === "retail" && o.metric === "new_badge" && o.value_text);
  const bestseller = observations.find((o) => o.group_kind === "retail" && o.metric === "bestseller_badge" && o.value_text);
  const published = observations.find((o) => o.metric === "published_at" && o.value_text);
  const spread = observations.filter((o) => o.group_kind === "spread" && (o.value_text || o.value_num != null));
  const parts: string[] = [];
  if (badge) parts.push(`метка «${cleanBadge(badge.value_text ?? "")}» на сайте`);
  if (bestseller) parts.push("в разделе бестселлеров на сайте");
  if (published?.value_text) parts.push(`опубликовано ${ru(published.value_text)}`);
  if (options.colors > 1) parts.push(`${options.colors} ${pluralColors(options.colors)} в одной модели`);
  if (spread.length === 0) parts.push("пока одна находка");

  const why = parts.length > 0 ? parts.join("; ") : "добавлено в ленту";
  if (badge) return { label: `Отмечено ритейлером: ${cleanBadge(badge.value_text ?? "")}`, tone: "retail", why };
  if (bestseller) return { label: "Отмечено ритейлером: бестселлер", tone: "retail", why };
  if (options.manual) return { label: "Добавлено вручную", tone: "manual", why };
  if (published) return { label: "Новинка", tone: "novelty", why };
  return { label: "Пока одна находка", tone: "single", why };
}
