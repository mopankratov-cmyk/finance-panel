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

export function isFinanceSidebarPath(pathname: string): boolean {
  return FINANCE_SIDEBAR_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
