import { internalFetch } from "@/lib/internalFetch";

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
  endpoint: "market-niches" | "market-pulse" | "sklejki",
  scope: WbDashboardScope,
  subjectId?: number,
): string {
  const pathname = endpoint === "sklejki"
    ? "/api/sklejki"
    : endpoint === "market-niches"
      ? "/api/market/niches"
      : "/api/market/pulse";
  const url = new URL(pathname, origin);
  url.searchParams.set("cabinet", scope.cabinetId || "all");
  url.searchParams.set("refresh", "1");
  if (endpoint === "market-pulse") {
    url.searchParams.set("subject_id", String(subjectId));
    url.searchParams.set("gran", "week");
    url.searchParams.set("weeks", "4");
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

export async function warmWbSecondaryDashboards(origin: string, scopes: WbDashboardScope[]) {
  const startedAt = Date.now();
  const snapshots: Array<{
    scope: string;
    ok: boolean;
    sklejki: WarmCallResult;
    marketNiches: WarmCallResult;
    marketPulse: WarmCallResult & { skipped?: boolean };
  }> = [];

  const warm = async (scope: WbDashboardScope) => {
    const [sklejki, nichesResult] = await Promise.all([
      fetchWarmSnapshot(wbDashboardWarmUrl(origin, "sklejki", scope)),
      fetchWarmSnapshot(wbDashboardWarmUrl(origin, "market-niches", scope)),
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
      ok: sklejki.ok && nichesResult.ok && marketPulse.ok,
      sklejki: { ok: sklejki.ok, status: sklejki.status, error: sklejki.error },
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
