import { CHINA_NICHES, type ChinaNiche } from "./chinaNiches";
import { ASSORTMENT_BASE_PATH, type AssortmentDirection } from "./constants";

/**
 * «Китайские площадки — ссылки»: ниши «Китай (1688)» для ручного просмотра — поиск 1688 по продажам, поиск Taobao и AlphaShop (ИИ-агент
 * 1688 для закупщиков). Без сбора и без ключа: ссылка открывает площадку в браузере человека, панель ничего не скачивает и не хранит.
 * Цены на площадках есть — в панель их не переносим. Чистые функции (годятся и для экрана, и для тестов).
 */

/** Страница ссылок модуля: доступна всегда, со снимком 1688 и без него. */
export const CHINA_LINKS_PATH = `${ASSORTMENT_BASE_PATH}/china-links`;

export type ChinaPlatform = "1688" | "taobao" | "alphashop";

export interface PlatformLink {
  platform: ChinaPlatform;
  label: string;
  url: string;
  note: string;
}

/** AlphaShop (遨虾) — поиска по адресу нет: главная, ключ ниши вставляется вручную (нужна регистрация). */
export const ALPHASHOP_URL = "https://www.alphashop.cn/";

const enc = (value: string) => encodeURIComponent(value.trim());

/** Поиск 1688 по ключу; bySales — по убыванию продаж за 30 дней (так страницу открывали в пробе 06.10). */
export function search1688Url(keyword: string, bySales = true): string {
  const base = `https://s.1688.com/selloffer/offer_search.htm?keywords=${enc(keyword)}&charset=utf8`;
  return bySales ? `${base}&sortType=va_rmdarkgmv30&descendOrder=true` : base;
}

/** Поиск Taobao по ключу, по продажам (Taobao просит вход). */
export function taobaoSearchUrl(keyword: string): string {
  return `https://s.taobao.com/search?q=${enc(keyword)}&sort=sale-desc`;
}

/** Три ссылки ниши: 1688 по продажам, Taobao, AlphaShop. Ключ — основной китайский ключ ниши (тот же, что у недельного снимка). */
export function nicheLinks(niche: Pick<ChinaNiche, "zh">): PlatformLink[] {
  const keyword = niche.zh[0] ?? "";
  return [
    { platform: "1688", label: "1688 — по продажам", url: search1688Url(keyword), note: "оптовая выдача, сортировка по продажам за 30 дней" },
    { platform: "taobao", label: "Taobao — поиск", url: taobaoSearchUrl(keyword), note: "розница Китая; площадка просит вход" },
    { platform: "alphashop", label: "AlphaShop", url: ALPHASHOP_URL, note: "ИИ-агент 1688 для закупщиков: вставьте китайский ключ; нужна регистрация" },
  ];
}

/** Ниши раздела (null — все), в порядке набора. */
export function nichesFor(direction: AssortmentDirection | null): ChinaNiche[] {
  return CHINA_NICHES.filter((n) => direction == null || n.direction === direction);
}

/** Короткое название ниши для переключателя: без «женская / женский» — раздел и так женский. */
export function nicheShortLabel(ru: string): string {
  const short = ru.replace(/(^|\s)женск(?:ая|ий|ое|ие)\s+/i, "$1").trim();
  return short ? short[0].toUpperCase() + short.slice(1) : ru;
}

/**
 * Ссылка «на 1688» у карточки топа: карточка 1688 по номеру (адрес строится из номера, допустим только номер из цифр), иначе — поиск по
 * китайскому названию.
 */
export function offerLink(offerId: string, titleZh: string): { url: string; kind: "card" | "search" } {
  if (/^\d{6,16}$/.test(offerId)) return { url: `https://detail.1688.com/offer/${offerId}.html`, kind: "card" };
  return { url: search1688Url(titleZh.slice(0, 40), false), kind: "search" };
}
