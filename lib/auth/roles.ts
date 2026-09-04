import type { Role } from "./session";

// Стартовая страница по роли
export const ROLE_HOME: Record<Role, string> = {
  director: "/",
  finance: "/pnl",
  manager: "/ozon",
  ozon_manager: "/ozon",
  seller: "/wb/connect",
  warehouse: "/warehouse",
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

export const ROLE_LABEL: Record<Role, string> = {
  director: "Директор",
  finance: "Финотдел / аналитик",
  manager: "Менеджер МП",
  ozon_manager: "Менеджер Ozon",
  seller: "Внешний селлер WB",
  warehouse: "Оператор склада",
};

// Доступные префиксы путей по роли. director — всё.
const ACCESS: Record<Role, string[]> = {
  director: ["*"],
  finance: ["/", "/calendar", "/payments", "/payroll", "/accounts", "/loans", "/opiu", "/pnl", "/summary", "/losses", "/costs", "/supplies", "/warehouse", "/repricer", "/price-solver", "/agent", "/sync", "/ozon", "/wb", "/adverts", "/rnp", "/seo", "/sklejki", "/reviews", "/product", "/unit", "/ctrtest", "/planning", "/abc", "/trends", "/market", "/card-editor", "/uniquizer"],
  manager: ["/", "/ozon", "/wb", "/adverts", "/rnp", "/seo", "/sklejki", "/reviews", "/product", "/unit", "/ctrtest", "/planning", "/costs", "/warehouse", "/agent", "/abc", "/trends", "/market", "/card-editor", "/uniquizer"],
  // Менеджер Ozon ведёт кабинеты Ozon и товародвижение по ним. Финансовый
  // контур компании, WB-контур и системные настройки ему не нужны и потому
  // закрыты: роль описывает работу человека, а не «всё, что не жалко».
  ozon_manager: ["/", "/ozon", "/warehouse"],
  // Внешний селлер работает только в собственном WB-контуре. Управляющие
  // инструменты (публикация контента, цены, системные настройки) не открываем.
  //
  // Склад ему открыт целиком, но это не дыра: модуль считает всё по юрлицу, а
  // юрлица селлеру видны только те, чьи кабинеты принадлежат его организации
  // (lib/warehouse/entityAccess.ts). Чужой склад он не увидит даже по прямой
  // ссылке — юрлицо не пройдёт resolveEntity.
  seller: ["/warehouse", "/wb/rnp", "/wb/planning", "/wb/funnel", "/wb/adverts", "/wb/rk", "/wb/supplies", "/wb/unit", "/wb/product", "/wb/seo", "/wb/sklejki", "/wb/reviews", "/wb/ctr", "/wb/shelf", "/wb/market", "/wb/trends", "/wb/abc", "/wb/health", "/wb/connect", "/wb/team"],
  // Оператор фулфилмента работает только в модуле «Склад»: приёмка, отгрузка, брак.
  // Решение владельца: внутри модуля видит всё, включая себестоимость.
  warehouse: ["/warehouse"],
};

/**
 * Роли, работающие в выданном им списке кабинетов.
 *
 * Такому сотруднику видны только его кабинеты, а агрегаты «все» и группы —
 * лишь в пределах выданного. Признак вынесен отдельно, чтобы новая роль не
 * требовала правки десятка мест, каждое из которых сравнивало роль со
 * строкой «manager» и молча пропускало всё остальное.
 */
export function isCabinetScopedRole(role: Role | string | null | undefined): boolean {
  return role === "manager" || role === "ozon_manager";
}

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
