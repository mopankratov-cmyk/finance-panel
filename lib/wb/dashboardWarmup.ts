import { internalFetch } from "@/lib/internalFetch";
import { loadCabinetPimRowsHourly } from "@/lib/wb/cards";
import { WB_MARKET_DEFAULT_GRAN, wbMarketClosedDateRange } from "@/lib/wb/marketDefaults";

interface WbDashboardScope {
  cabinetId: string | null;
  label: string;
}

interface WarmCallResult {
  ok: boolean;
  status: number;
  error?: string;
}

export function wbDashboardWarmUrl(
  origin: string,
  endpoint: "funnel-metrics" | "market-niches" | "market-pulse" | "seo" | "sklejki" | "unit",
  scope: WbDashboardScope,
  subjectId?: number,
): string {
  const pathname = endpoint === "funnel-metrics" ? "/api/design/day-metrics"
    : endpoint === "seo" ? "/api/seo/skus"
      : endpoint === "sklejki" ? "/api/sklejki"
    : endpoint === "market-niches" ? "/api/market/niches"
      : endpoint === "market-pulse" ? "/api/market/pulse"
        : "/api/unit/table";
  const url = new URL(pathname, origin);
  url.searchParams.set("cabinet", scope.cabinetId || "all");
  url.searchParams.set("refresh", "1");
  if (endpoint === "market-pulse") {
    const period = wbMarketClosedDateRange();
    url.searchParams.set("subject_id", String(subjectId));
    url.searchParams.set("gran", WB_MARKET_DEFAULT_GRAN);
    url.searchParams.set("date_from", period.dateFrom);
    url.searchParams.set("date_to", period.dateTo);
  }
  return url.toString();
}

async function fetchWarmSnapshot(url: string): Promise<WarmCallResult & { body?: unknown }> {
  try {
    const response = await internalFetch(url, { cache: "no-store" });
    const body = await response.json().catch(() => ({})) as { error?: unknown };
    const error = typeof body.error === "string" ? body.error : undefined;
    return { ok: response.ok && !error, status: response.status, error, body };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : "Внутренний запрос не выполнен" };
  }
}

async function warmPimCards(scope: WbDashboardScope): Promise<WarmCallResult> {
  try {
    await loadCabinetPimRowsHourly(scope.cabinetId, { forceRefresh: true });
    return { ok: true, status: 200 };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : "Карточки WB не загружены" };
  }
}

export async function warmWbSecondaryDashboards(origin: string, scopes: WbDashboardScope[]) {
  const startedAt = Date.now();
  const snapshots: Array<{
    scope: string;
    ok: boolean;
    sklejki: WarmCallResult;
    pim: WarmCallResult;
    unit: WarmCallResult;
    seo: WarmCallResult;
    funnelMetrics: WarmCallResult;
    marketNiches: WarmCallResult;
    marketPulse: WarmCallResult & { skipped?: boolean };
  }> = [];

  const warm = async (scope: WbDashboardScope) => {
    const [sklejki, nichesResult, pim, unit, seo, funnelMetrics] = await Promise.all([
      fetchWarmSnapshot(wbDashboardWarmUrl(origin, "sklejki", scope)),
      fetchWarmSnapshot(wbDashboardWarmUrl(origin, "market-niches", scope)),
      warmPimCards(scope),
      fetchWarmSnapshot(wbDashboardWarmUrl(origin, "unit", scope)),
      fetchWarmSnapshot(wbDashboardWarmUrl(origin, "seo", scope)),
      fetchWarmSnapshot(wbDashboardWarmUrl(origin, "funnel-metrics", scope)),
    ]);
    const niches = nichesResult.body && typeof nichesResult.body === "object" && "niches" in nichesResult.body
      ? (nichesResult.body as { niches?: Array<{ id?: unknown }> }).niches
      : undefined;
    const subjectId = Number(niches?.[0]?.id);
    const marketPulse = nichesResult.ok && Number.isFinite(subjectId)
      ? await fetchWarmSnapshot(wbDashboardWarmUrl(origin, "market-pulse", scope, subjectId))
      : { ok: nichesResult.ok, status: nichesResult.status, error: nichesResult.error, skipped: true };
    const result = {
      scope: scope.label,
      ok: sklejki.ok && pim.ok && unit.ok && seo.ok && funnelMetrics.ok && nichesResult.ok && marketPulse.ok,
      sklejki: { ok: sklejki.ok, status: sklejki.status, error: sklejki.error },
      pim: { ok: pim.ok, status: pim.status, error: pim.error },
      unit: { ok: unit.ok, status: unit.status, error: unit.error },
      seo: { ok: seo.ok, status: seo.status, error: seo.error },
      funnelMetrics: { ok: funnelMetrics.ok, status: funnelMetrics.status, error: funnelMetrics.error },
      marketNiches: { ok: nichesResult.ok, status: nichesResult.status, error: nichesResult.error },
      marketPulse: { ok: marketPulse.ok, status: marketPulse.status, error: marketPulse.error, skipped: "skipped" in marketPulse ? marketPulse.skipped : undefined },
    };
    snapshots.push(result);
  };

  if (scopes.length) {
    await warm(scopes[0]);
    for (let offset = 1; offset < scopes.length; offset += 2) {
      await Promise.all(scopes.slice(offset, offset + 2).map(warm));
    }
  }

  return {
    ok: snapshots.every((snapshot) => snapshot.ok),
    snapshots,
    durationMs: Date.now() - startedAt,
  };
}
