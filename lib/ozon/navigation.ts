export function withOzonCabinetScope(href: string, cabinetId: string) {
  if (!cabinetId) return href;
  const url = new URL(href, "https://ozon-dashboard.local");
  url.searchParams.set("cabinet", cabinetId);
  return `${url.pathname}${url.search}${url.hash}`;
}
