const FINANCE_SIDEBAR_PATHS = [
  "/summary",
  "/pnl",
  "/losses",
  "/opiu",
  "/calendar",
  "/payments",
  "/payroll",
  "/accounts",
  "/loans",
  "/costs",
];

const SYSTEM_SIDEBAR_PATHS = [
  "/cabinets",
  "/users",
  "/sync",
];

const AGENT_SIDEBAR_PATHS = [
  "/agent",
];

export function isFinanceSidebarPath(pathname: string): boolean {
  return FINANCE_SIDEBAR_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function isSystemSidebarPath(pathname: string): boolean {
  return SYSTEM_SIDEBAR_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function isAgentSidebarPath(pathname: string): boolean {
  return AGENT_SIDEBAR_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
