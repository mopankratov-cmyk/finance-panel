const FINANCE_SIDEBAR_PATHS = [
  "/summary",
  "/pnl",
  "/losses",
  "/opiu",
  "/calendar",
  "/payments",
  "/accounts",
  "/loans",
  "/costs",
];

const SYSTEM_SIDEBAR_PATHS = [
  "/cabinets",
  "/users",
  "/sync",
];

export function isFinanceSidebarPath(pathname: string): boolean {
  return FINANCE_SIDEBAR_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function isSystemSidebarPath(pathname: string): boolean {
  return SYSTEM_SIDEBAR_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
