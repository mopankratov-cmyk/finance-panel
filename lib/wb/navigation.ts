export interface WbNavigationItem {
  label: string;
  href: string;
}

export interface WbNavigationScenario {
  id: "sales" | "operations" | "product" | "experiments" | "analytics";
  label: string;
  description: string;
  items: WbNavigationItem[];
}

export const WB_NAVIGATION_SCENARIOS: WbNavigationScenario[] = [
  {
    id: "sales",
    label: "Продажи и прибыль",
    description: "Понять результат и управлять ценой и рекламой",
    items: [
      { label: "РНП", href: "/wb/rnp" },
      { label: "Воронка / Репрайсер", href: "/wb/funnel" },
      { label: "Юнит-экономика", href: "/wb/unit" },
      { label: "Реклама", href: "/wb/adverts" },
    ],
  },
  {
    id: "operations",
    label: "План и поставка",
    description: "Спланировать объём, пополнить запас и закрыть риски",
    items: [
      { label: "План продаж и закупки", href: "/wb/planning" },
      { label: "Поставки", href: "/wb/supplies" },
      { label: "Здоровье", href: "/wb/health" },
      { label: "Задачи", href: "/wb/tasks" },
    ],
  },
  {
    id: "product",
    label: "Карточка и спрос",
    description: "Улучшить карточку, поиск и обратную связь",
    items: [
      { label: "Товары", href: "/wb/product" },
      { label: "SEO", href: "/wb/seo" },
      { label: "Склейки", href: "/wb/sklejki" },
      { label: "Отзывы", href: "/wb/reviews" },
    ],
  },
  {
    id: "experiments",
    label: "Тесты и контент",
    description: "Проверить гипотезу и подготовить следующий вариант",
    items: [
      { label: "CTR-тесты", href: "/wb/ctr" },
      { label: "UGC Studio", href: "/wb/ugc" },
    ],
  },
  {
    id: "analytics",
    label: "Аналитика рынка",
    description: "Найти вклад SKU, динамику и внешние возможности",
    items: [
      { label: "ABC-анализ", href: "/wb/abc" },
      { label: "Динамика", href: "/wb/trends" },
      { label: "Рынок", href: "/wb/market" },
    ],
  },
];

export const WB_MOBILE_NAVIGATION: WbNavigationItem[] = [
  { label: "РНП", href: "/wb/rnp" },
  { label: "Реклама", href: "/wb/adverts" },
  { label: "План", href: "/wb/planning" },
  { label: "Поставки", href: "/wb/supplies" },
];

export function isWbNavigationItemActive(pathname: string, href: string) {
  if (href === "/wb/rnp") return pathname === "/wb" || pathname.startsWith("/wb/rnp");
  return pathname === href || pathname.startsWith(`${href}/`);
}
