// fbs-orders — сборочные задания Marketplace: признак схемы продажи для РНП.
const FIRST_WAVE = ["orders", "sales", "stocks", "adverts", "fbs-orders"] as const;
const DEPENDENT_WAVE = ["advert-stats"] as const;

export type CoreSyncJob = (typeof FIRST_WAVE)[number] | (typeof DEPENDENT_WAVE)[number];

export interface SyncOrchestratorResult {
  ok: boolean;
  results: Record<string, unknown>;
}

export interface CoreSyncOptions {
  includeSales?: boolean;
  includeStocks?: boolean;
}

export const WB_HOURLY_CORE_SYNC_OPTIONS = {
  includeSales: false,
  includeStocks: false,
} as const;

export function resolveSyncBase(
  base: string,
  productionUrl = process.env.BASE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL,
): string {
  const fallback = base.replace(/\/$/, "");
  const configured = productionUrl?.trim();
  if (!configured) return fallback;
  try {
    const url = new URL(configured.includes("://") ? configured : `https://${configured}`);
    return url.origin;
  } catch {
    return fallback;
  }
}

export async function runIndependentSyncJobs(
  jobs: readonly string[],
  base: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<SyncOrchestratorResult> {
  const results: Record<string, unknown> = {};
  let ok = true;
  const syncBase = resolveSyncBase(base);

  await Promise.all(jobs.map(async (job) => {
    try {
      const res = await fetchImpl(`${syncBase}/api/sync/${job}`, {
        headers,
        cache: "no-store",
      });
      const raw = await res.json().catch(() => null);
      const validPayload = raw !== null && typeof raw === "object" && !Array.isArray(raw);
      const payload = objectPayload(raw);
      const jobOk = res.ok && validPayload && payload.ok === true && !payload.error && !hasErrorList(payload);
      if (!jobOk) ok = false;
      results[job] = {
        ...payload,
        ...(!validPayload ? { error: "Некорректный JSON-ответ дочерней синхронизации" } : {}),
        ...(validPayload && payload.ok !== true && !payload.error && !hasErrorList(payload)
          ? { error: "Дочерняя синхронизация не подтвердила успех" }
          : {}),
        status: res.status,
      };
    } catch (error) {
      ok = false;
      results[job] = { error: error instanceof Error ? error.message : "Unknown error" };
    }
  }));

  return { ok, results };
}

function objectPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function hasErrorList(payload: Record<string, unknown>): boolean {
  return Array.isArray(payload.errors) && payload.errors.some((value) => typeof value === "string" && value.length > 0);
}

export async function runCoreSyncJobs(
  base: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
  options: CoreSyncOptions = WB_HOURLY_CORE_SYNC_OPTIONS,
): Promise<SyncOrchestratorResult> {
  const results: Record<string, unknown> = {};
  let ok = true;
  const syncBase = resolveSyncBase(base);

  const run = async (job: CoreSyncJob) => {
    try {
      const res = await fetchImpl(`${syncBase}/api/sync/${job}`, {
        headers,
        cache: "no-store",
      });
      const raw = await res.json().catch(() => null);
      const validPayload = raw !== null && typeof raw === "object" && !Array.isArray(raw);
      const payload = objectPayload(raw);
      const jobOk = res.ok && validPayload && payload.ok === true && !payload.error && !hasErrorList(payload);
      if (!jobOk) ok = false;
      results[job] = {
        ...payload,
        ...(!validPayload ? { error: "Некорректный JSON-ответ дочерней синхронизации" } : {}),
        ...(validPayload && payload.ok !== true && !payload.error && !hasErrorList(payload)
          ? { error: "Дочерняя синхронизация не подтвердила успех" }
          : {}),
        status: res.status,
      };
    } catch (error) {
      ok = false;
      results[job] = { error: error instanceof Error ? error.message : "Unknown error" };
    }
  };

  // Эти таблицы независимы. Раньше пять последовательных запросов плюс тяжёлые
  // AI-инсайты делили один 60с-бюджет Vercel и весь /all падал по таймауту.
  // Статистика рекламы читает список кампаний, поэтому цепляем её после adverts,
  // но не заставляем ждать окончания orders/sales/stocks.
  const advertsChain = (async () => {
    await run("adverts");
    for (const job of DEPENDENT_WAVE) await run(job);
  })();
  const independentJobs = FIRST_WAVE.filter((job) => (
    job !== "adverts"
    && (job !== "sales" || options.includeSales !== false)
    && (job !== "stocks" || options.includeStocks !== false)
  ));
  await Promise.all([
    ...independentJobs.map(run),
    advertsChain,
  ]);

  return { ok, results };
}
