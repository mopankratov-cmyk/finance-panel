/**
 * Сигнал «нажат пункт меню модуля» — для раздела, который уже открыт. Без зависимостей: оболочка модуля (меню на всех его страницах)
 * не должна тянуть каталог и формы.
 *
 * Пересоздание раздела по адресу считает сервер (ключ страницы — вид и фильтры из адреса), а вкладка и фильтры меняются на клиенте
 * через history.replaceState. Раздел, открытый чистым адресом, при нажатии своего пункта меню получал тот же ключ — и оставался на
 * прежней вкладке с прежними фильтрами (аудит F29). Поэтому меню само сообщает разделу о нажатии, а раздел начинает заново.
 */
export const ASSORTMENT_MENU_EVENT = "assortment:menu-navigate";

/** Адрес пункта меню ведёт в этот раздел (без ?query, #якоря и завершающего «/»). */
export function isSectionMenuTarget(href: string, sectionHref: string): boolean {
  const clean = (value: string) => value.split(/[?#]/)[0].replace(/\/+$/, "");
  return clean(href) === clean(sectionHref);
}

/** Меню: «нажат пункт href» (onNavigate ссылки — до перехода и только при переходе внутри панели). */
export function announceMenuNavigate(target: EventTarget, href: string): void {
  target.dispatchEvent(new CustomEvent(ASSORTMENT_MENU_EVENT, { detail: { href } }));
}

/** Раздел подписывается на нажатия меню; возвращает отписку (для useEffect). */
export function onMenuNavigate(target: EventTarget, handler: (href: string) => void): () => void {
  const listener = (event: Event) => {
    const href = (event as CustomEvent<{ href?: unknown }>).detail?.href;
    if (typeof href === "string") handler(href);
  };
  target.addEventListener(ASSORTMENT_MENU_EVENT, listener);
  return () => target.removeEventListener(ASSORTMENT_MENU_EVENT, listener);
}
