import type { Role } from "./permissions";

export { ROLE_LABEL, isCabinetScopedRole } from "./permissions";

// Стартовая страница по роли
export const ROLE_HOME: Record<Role, string> = {
  director: "/",
  fin_director: "/pnl",
  financier: "/pnl",
  hr: "/payroll",
  wb_manager: "/wb/rnp",
  ozon_manager: "/ozon",
  buyer: "/supplies",
  warehouse: "/warehouse",
  seller_owner: "/wb/connect",
  seller: "/wb/connect",
};

/**
 * Куда вести человека, если он попал не туда — с корня сайта, по логотипу или
 * на закрытый ему путь.
 *
 * Для внешнего селлера ответ зависит от того, подключил ли он кабинет:
 * пока не подключил, ему нужен экран подключения, а дальше там смотреть нечего
 * — он уходит в аналитику. Раньше карта была статической, и селлер с уже
 * подключённым кабинетом каждый раз упирался в «Подключение WB».
 */
export function roleHome(session: { role: Role; cabinet_ids?: string[] } | null | undefined): string {
  if (!session) return "/login";
  if (session.role === "seller") {
    return (session.cabinet_ids?.length ?? 0) > 0 ? "/wb/rnp" : "/wb/connect";
  }
  return ROLE_HOME[session.role] || "/";
}


/**
 * Доступные префиксы путей по роли.
 *
 * Это ГРУБЫЙ гейт: он отвечает «куда пустить», а не «что там можно делать».
 * Тонкая проверка — матрица действий в lib/auth/permissions.ts. Пути остаются,
 * потому что дешевле не пустить человека на экран целиком, чем разбираться с
 * правами внутри него, и потому что прокси должен уметь отвечать до запуска
 * роута.
 */
const FINANCE_PATHS = ["/", "/calendar", "/payments", "/payroll", "/accounts", "/loans", "/opiu", "/pnl", "/summary", "/losses", "/costs", "/supplies", "/warehouse", "/repricer", "/price-solver", "/agent", "/sync", "/ozon", "/wb", "/adverts", "/rnp", "/seo", "/sklejki", "/reviews", "/product", "/unit", "/ctrtest", "/planning", "/abc", "/trends", "/market", "/card-editor", "/uniquizer"];

// Товарный контур менеджера. Маркетплейс отсекается отдельной осью
// (ROLE_MARKETPLACES), поэтому здесь перечислены общие для обоих экраны.
const MERCH_PATHS = ["/", "/adverts", "/rnp", "/seo", "/sklejki", "/reviews", "/product", "/unit", "/ctrtest", "/planning", "/costs", "/warehouse", "/agent", "/abc", "/trends", "/market", "/card-editor", "/uniquizer"];

const ACCESS: Record<Role, string[]> = {
  director: ["*"],
  fin_director: [...FINANCE_PATHS],
  // Финансист работает там же, где финдиректор: разница между ними не в
  // экранах, а в праве утвердить — а это уже матрица действий.
  financier: [...FINANCE_PATHS],
  // Кадры и зарплата. Финансовый контур компании и маркетплейсы закрыты (§7).
  hr: ["/", "/payroll"],
  // Менеджер WB: свой маркетплейс без чужого. Прежняя роль «менеджер МП»
  // держала оба контура сразу, и ТЗ §8 их разделяет.
  wb_manager: [...MERCH_PATHS, "/wb"],
  // Менеджер Ozon ведёт кабинеты Ozon и товародвижение по ним. Финансовый
  // контур компании, WB-контур и системные настройки ему не нужны и потому
  // закрыты: роль описывает работу человека, а не «всё, что не жалко».
  ozon_manager: ["/", "/ozon", "/warehouse"],
  // Закупщик: поставщики, заказы, приёмка и себестоимость.
  buyer: ["/", "/supplies", "/warehouse", "/costs", "/planning", "/unit", "/abc"],
  // Оператор фулфилмента работает только в модуле «Склад»: приёмка, отгрузка, брак.
  warehouse: ["/warehouse"],
  // Внешний контур работает только в собственных кабинетах. Управляющие
  // инструменты компании (системные настройки, финансы) не открываем.
  //
  // Склад ему открыт целиком, но это не дыра: модуль считает всё по юрлицу, а
  // юрлица внешнему пользователю видны только те, чьи кабинеты принадлежат его
  // организации (lib/warehouse/entityAccess.ts). Чужой склад он не увидит даже
  // по прямой ссылке — юрлицо не пройдёт resolveEntity.
  seller_owner: ["/warehouse", "/wb/rnp", "/wb/planning", "/wb/funnel", "/wb/adverts", "/wb/rk", "/wb/supplies", "/wb/unit", "/wb/product", "/wb/seo", "/wb/sklejki", "/wb/reviews", "/wb/ctr", "/wb/shelf", "/wb/market", "/wb/trends", "/wb/abc", "/wb/health", "/wb/connect", "/wb/team"],
  seller: ["/warehouse", "/wb/rnp", "/wb/planning", "/wb/funnel", "/wb/adverts", "/wb/rk", "/wb/supplies", "/wb/unit", "/wb/product", "/wb/seo", "/wb/sklejki", "/wb/reviews", "/wb/ctr", "/wb/shelf", "/wb/market", "/wb/trends", "/wb/abc", "/wb/health", "/wb/connect", "/wb/team"],
};


export function canAccess(role: Role, path: string): boolean {
  const rules = ACCESS[role] ?? [];
  if (rules.includes("*")) return true;
  // точное «/» только для лаунчера
  if (path === "/") return rules.includes("/");
  return rules.some((p) => p !== "/" && (path === p || path.startsWith(p + "/")));
}

export function allowedNav(role: Role, href: string): boolean {
  return canAccess(role, href);
}
