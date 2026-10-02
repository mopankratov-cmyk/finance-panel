import { stripColorTail } from "./collections";

/**
 * «Где купить образец» (улучшение 5 от 01.10.2026). Чистые функции.
 *
 * Фабрика своя (Серпухов) — искать её не нужно; нужен физический образец
 * модели для разбора конструкции. Поэтому только ссылки на поиск модели там,
 * где её реально купить: сайт бренда, мультибрендовые витрины, вторичный
 * рынок. Цены не читаем и не сравниваем (граница ТЗ) — человек сам смотрит
 * наличие и доставку. Фото модели наружу не отправляем: ссылки на наше
 * хранилище приватные.
 */

export interface SampleLink {
  label: string;
  url: string;
  note: string;
}

/** Название модели без расцветки: «Boky - Textured Camel» → «Boky». */
export function modelHead(title: string | null): string {
  return stripColorTail((title ?? "").split(/\s+[-–—|]\s+|,\s+/)[0].replace(/\s+/g, " ").trim());
}

export function sampleQuery(ref: { brand: string | null; title: string | null }): string {
  const head = modelHead(ref.title);
  const brand = (ref.brand ?? "").trim();
  if (!brand) return head;
  return head.toLowerCase().includes(brand.toLowerCase()) ? head : `${brand} ${head}`.trim();
}

const q = (value: string) => encodeURIComponent(value);

export function sampleLinks(ref: { brand: string | null; title: string | null; article: string | null; url: string | null }): SampleLink[] {
  const query = sampleQuery(ref);
  const links: SampleLink[] = [];
  if (ref.url) links.push({ label: "Сайт бренда", url: ref.url, note: "карточка, где модель нашли" });
  if (!query) return links;
  links.push(
    { label: "Lyst", url: `https://www.lyst.com/search/?q=${q(query)}`, note: "мультибрендовые магазины, часть с доставкой в РФ через посредника" },
    { label: "Farfetch", url: `https://www.farfetch.com/shopping/search/items.aspx?q=${q(query)}`, note: "бутики и универмаги" },
    { label: "Vinted", url: `https://www.vinted.com/catalog?search_text=${q(query)}`, note: "вторичный рынок — образец для разбора бывает дешевле" },
    { label: "eBay", url: `https://www.ebay.com/sch/i.html?_nkw=${q(query)}`, note: "вторичный рынок, международная доставка" },
    { label: "Wildberries", url: `https://www.wildberries.ru/catalog/0/search.aspx?search=${q(query)}`, note: "есть ли модель или похожие уже в РФ" },
  );
  if (ref.article) {
    links.push({ label: "Поиск по артикулу", url: `https://www.google.com/search?q=${q(`"${ref.article}"${ref.brand ? ` ${ref.brand}` : ""}`)}`, note: "точное совпадение артикула у других продавцов" });
  }
  return links;
}
