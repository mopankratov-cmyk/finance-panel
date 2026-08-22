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
  endpoint: "funnel-metrics" | "market-niches" | "market-pulse" | "seo" | "sklejki" | "unit" | "adverts" | "supplies",
  scope: WbDashboardScope,
  subjectId?: number,
): string {
  const pathname = endpoint === "funnel-metrics" ? "/api/design/day-metrics"
    : endpoint === "seo" ? "/api/seo/skus"
      : endpoint === "sklejki" ? "/api/sklejki"
    : endpoint === "market-niches" ? "/api/market/niches"
      : endpoint === "market-pulse" ? "/api/market/pulse"
        : endpoint === "adverts" ? "/api/adverts/list"
          : endpoint === "supplies" ? "/api/supplies"
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
  // Сначала один раз прогреваем общий PIM. Он компонуется из кабинетных
  // снимков, поэтому последующие Sklejki/PIM не дублируют Content API.
  const pim = await warmPimCards({ cabinetId: null, label: "Все кабинеты" });
  const snapshots: Array<{
    scope: string;
    ok: boolean;
    sklejki: WarmCallResult;
    pim: WarmCallResult;
    unit: WarmCallResult;
    seo: WarmCallResult;
    funnelMetrics: WarmCallResult;
    marketNiches: WarmCallResult;
    adverts: WarmCallResult;
    supplies: WarmCallResult;
    marketPulse: WarmCallResult & { skipped?: boolean };
  }> = [];

  const warm = async (scope: WbDashboardScope) => {
    // «Реклама» и «Поставки» тоже греются: под ними общий снимок месячных
    // агрегатов (loadCachedAdvertReportRows). Холодный он собирается тяжёлым
    // RPC и под нагрузкой уходит в statement timeout — пользователь получал
    // 500 на первом заходе. Прогрев уносит эту сборку в фон крона.
    // Воронка живёт на трёх пресетах окна. Раньше грелось только окно 7 дней:
    // «Вчера» и «30 дней» пользователь всегда собирал сам (у тяжёлых кабинетов
    // 10с+ на холодном снимке). Дополнительные окна греем БЕЗ refresh=1 —
    // достаточно собрать холодный снимок нового дня один раз, дальше кэш
    // отдаёт мгновенно и обновляется в фоне сам.
    const coldOnly = (window: number) => {
      const url = new URL(wbDashboardWarmUrl(origin, "seo", scope));
      url.searchParams.set("window", String(window));
      url.searchParams.delete("refresh");
      return fetchWarmSnapshot(url.toString());
    };
    const [sklejki, nichesResult, unit, seo, seoYesterday, seoMonth, funnelMetrics, adverts, supplies] = await Promise.all([
      fetchWarmSnapshot(wbDashboardWarmUrl(origin, "sklejki", scope)),
      fetchWarmSnapshot(wbDashboardWarmUrl(origin, "market-niches", scope)),
      fetchWarmSnapshot(wbDashboardWarmUrl(origin, "unit", scope)),
      fetchWarmSnapshot(wbDashboardWarmUrl(origin, "seo", scope)),
      coldOnly(1),
      coldOnly(30),
      fetchWarmSnapshot(wbDashboardWarmUrl(origin, "funnel-metrics", scope)),
      fetchWarmSnapshot(wbDashboardWarmUrl(origin, "adverts", scope)),
      fetchWarmSnapshot(wbDashboardWarmUrl(origin, "supplies", scope)),
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
      ok: sklejki.ok && pim.ok && unit.ok && seo.ok && seoYesterday.ok && seoMonth.ok && funnelMetrics.ok
        && nichesResult.ok && marketPulse.ok && adverts.ok && supplies.ok,
      sklejki: { ok: sklejki.ok, status: sklejki.status, error: sklejki.error },
      pim: { ok: pim.ok, status: pim.status, error: pim.error },
      unit: { ok: unit.ok, status: unit.status, error: unit.error },
      seo: { ok: seo.ok, status: seo.status, error: seo.error },
      seoWindows: { yesterday: seoYesterday.ok, month: seoMonth.ok },
      funnelMetrics: { ok: funnelMetrics.ok, status: funnelMetrics.status, error: funnelMetrics.error },
      marketNiches: { ok: nichesResult.ok, status: nichesResult.status, error: nichesResult.error },
      adverts: { ok: adverts.ok, status: adverts.status, error: adverts.error },
      supplies: { ok: supplies.ok, status: supplies.status, error: supplies.error },
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
