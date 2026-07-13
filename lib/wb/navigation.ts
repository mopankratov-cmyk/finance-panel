export interface WbNavigationItem {
  label: string;
  href: string;
}

// Рабочие экраны WB показываются напрямую: владелец должен видеть весь набор
// инструментов без наведения на группы и без промежуточных раскрывающихся меню.
export const WB_NAVIGATION_ITEMS: WbNavigationItem[] = [
  { label: "РНП", href: "/wb/rnp" },
  { label: "Воронка / Репрайсер", href: "/wb/funnel" },
  { label: "Реклама", href: "/wb/adverts" },
  { label: "Поставки", href: "/wb/supplies" },
  { label: "Юнит-экономика", href: "/wb/unit" },
  { label: "Товары", href: "/wb/product" },
  { label: "SEO", href: "/wb/seo" },
  { label: "Склейки", href: "/wb/sklejki" },
  { label: "Отзывы", href: "/wb/reviews" },
  { label: "CTR-тесты", href: "/wb/ctr" },
  { label: "Рынок", href: "/wb/market" },
];

export const WB_MOBILE_NAVIGATION: WbNavigationItem[] = [
  { label: "РНП", href: "/wb/rnp" },
  { label: "Реклама", href: "/wb/adverts" },
  { label: "Поставки", href: "/wb/supplies" },
  { label: "Склейки", href: "/wb/sklejki" },
];

export function isWbNavigationItemActive(pathname: string, href: string) {
  if (href === "/wb/rnp") return pathname === "/wb" || pathname.startsWith("/wb/rnp");
  return pathname === href || pathname.startsWith(`${href}/`);
}
