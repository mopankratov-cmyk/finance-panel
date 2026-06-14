import type { Role } from "./session";

// Стартовая страница по роли
export const ROLE_HOME: Record<Role, string> = {
  director: "/",
  finance: "/pnl",
  manager: "/ozon",
};

export const ROLE_LABEL: Record<Role, string> = {
  director: "Директор",
  finance: "Финотдел / аналитик",
  manager: "Менеджер МП",
};

// Доступные префиксы путей по роли. director — всё.
const ACCESS: Record<Role, string[]> = {
  director: ["*"],
  finance: ["/", "/calendar", "/payments", "/accounts", "/loans", "/opiu", "/pnl", "/summary", "/losses", "/costs", "/supplies", "/agent", "/sync", "/ozon", "/inferno", "/abc", "/trends", "/card-editor", "/carousel"],
  manager: ["/", "/ozon", "/inferno", "/content", "/costs", "/agent", "/abc", "/trends", "/card-editor", "/carousel"],
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
