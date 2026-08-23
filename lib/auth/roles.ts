import type { Role } from "./session";

// Стартовая страница по роли
export const ROLE_HOME: Record<Role, string> = {
  director: "/",
  finance: "/pnl",
  manager: "/ozon",
  seller: "/wb/connect",
};

export const ROLE_LABEL: Record<Role, string> = {
  director: "Директор",
  finance: "Финотдел / аналитик",
  manager: "Менеджер МП",
  seller: "Внешний селлер WB",
};

// Доступные префиксы путей по роли. director — всё.
const ACCESS: Record<Role, string[]> = {
  director: ["*"],
  finance: ["/", "/calendar", "/payments", "/accounts", "/loans", "/opiu", "/pnl", "/summary", "/losses", "/costs", "/supplies", "/warehouse", "/repricer", "/price-solver", "/agent", "/sync", "/ozon", "/wb", "/adverts", "/rnp", "/seo", "/sklejki", "/reviews", "/product", "/unit", "/ctrtest", "/planning", "/abc", "/trends", "/market", "/card-editor", "/uniquizer"],
  manager: ["/", "/ozon", "/wb", "/adverts", "/rnp", "/seo", "/sklejki", "/reviews", "/product", "/unit", "/ctrtest", "/planning", "/costs", "/warehouse", "/agent", "/abc", "/trends", "/market", "/card-editor", "/uniquizer"],
  // Внешний селлер работает только в собственном WB-контуре. Управляющие
  // инструменты (публикация контента, цены, системные настройки) не открываем.
  seller: ["/wb/rnp", "/wb/planning", "/wb/funnel", "/wb/adverts", "/wb/rk", "/wb/supplies", "/wb/unit", "/wb/product", "/wb/seo", "/wb/sklejki", "/wb/reviews", "/wb/ctr", "/wb/shelf", "/wb/market", "/wb/trends", "/wb/abc", "/wb/health", "/wb/connect"],
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
