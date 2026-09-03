const FINANCE_HYDRATION_PATHS = ["/accounts", "/calendar", "/loans", "/payments", "/payroll"] as const;

export function needsFinanceHydration(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return FINANCE_HYDRATION_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
