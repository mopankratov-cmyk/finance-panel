import { DEFAULT_CATALOG_FILTERS, filtersForForm, type CatalogFilters, type SectionView } from "./catalog";
import { isSectionMenuTarget } from "./menuSignal";

/**
 * Переходы раздела между вкладками и фильтрами каталога — чистые функции, чтобы их можно было проверить без экрана.
 * Фильтры каталога живут в разделе (уход на другую вкладку и возврат — на то же место); `key` пересоздаёт каталог, когда
 * фильтры заданы заново, а не изменены человеком.
 */
export interface CatalogNav {
  view: SectionView;
  filters: CatalogFilters;
  key: number;
  /** Ключ формы из адреса, которого раздел не знает (страница его отбросила); "" — ключ есть, но показать его нельзя; null — нет или уже снят. */
  rejected: string | null;
}

/** Ключи фильтров каталога в адресе: вне вкладки «Каталоги» их в адресе нет. */
export const CATALOG_URL_KEYS = ["source", "q", "fresh", "badge", "form", "photo"] as const;

export const initialNav = (view: SectionView, filters: CatalogFilters, rejected: string | null = null): CatalogNav => ({ view, filters, key: 0, rejected });

/** Смена вкладки: фильтры каталога помнятся. */
export const navSetView = (nav: CatalogNav, view: SectionView): CatalogNav => (nav.view === view ? nav : { ...nav, view });

/** «Показать модели» с «Форм»: форма и «и без фото» заданы заново, каталог пересоздан. */
export const navShowModels = (nav: CatalogNav, form: string): CatalogNav => ({ view: "catalog", filters: filtersForForm(form), key: nav.key + 1, rejected: null });

/**
 * «Весь ассортимент брендов — N» с «Новинок»: обещание в подписи — весь, поэтому запомненные фильтры (форма, бренд, поиск) сбрасываются.
 * N посчитано вместе с моделями без фото (photo=all), а при photo=auto сервер срезал бы список до моделей с фото, если их больше половины:
 * на кнопке было бы «2 334», а на экране «2 100» — поэтому режим фото задан явно.
 */
export const navOpenWholeCatalog = (nav: CatalogNav): CatalogNav => ({ view: "catalog", filters: { ...DEFAULT_CATALOG_FILTERS, photo: "all" }, key: nav.key + 1, rejected: null });

/** «Понятно» на плашке отброшенной формы: она больше не возвращается ни при смене вкладки, ни при перемонтировании каталога. */
export const navDismissRejected = (nav: CatalogNav): CatalogNav => (nav.rejected === null ? nav : { ...nav, rejected: null });

/** Плашка «такой формы нет»: пока ключ не снят, формы в фильтрах нет и ответ каталога уже получен (до этого сказать «не применена» не о чем). */
export const showRejectedNote = (rejected: string | null, form: string | null, ready: boolean): boolean => rejected !== null && !form && ready;

/** Фильтры, которые поменял человек в каталоге: запоминаем, не пересоздавая каталог. */
export const navSetFilters = (nav: CatalogNav, filters: CatalogFilters): CatalogNav => (nav.filters === filters ? nav : { ...nav, filters });

/** Адрес страницы после смены вкладки: вкладка — в ?view=, фильтры каталога — только на самой вкладке «Каталоги». */
export function urlForView(href: string, view: SectionView): string {
  const url = new URL(href);
  if (view === "new") url.searchParams.delete("view");
  else url.searchParams.set("view", view);
  if (view !== "catalog") for (const key of CATALOG_URL_KEYS) url.searchParams.delete(key);
  return url.toString();
}

// ---------------------------------------------------------------------------
// Меню модуля → раздел: «начать заново» (сигнал меню — в menuSignal.ts, чтобы оболочка модуля не тянула каталог)

/** Раздел с начала: «Новинки», фильтры каталога по умолчанию, каталог пересоздан, плашки отброшенной формы нет. */
export const navReset = (nav: CatalogNav): CatalogNav => ({ view: "new", filters: DEFAULT_CATALOG_FILTERS, key: nav.key + 1, rejected: null });

/** Нажат пункт меню: свой раздел начинается заново, чужой — ничего не меняет (это обычный переход). */
export const navAfterMenu = (nav: CatalogNav, href: string, sectionHref: string): CatalogNav => (isSectionMenuTarget(href, sectionHref) ? navReset(nav) : nav);
