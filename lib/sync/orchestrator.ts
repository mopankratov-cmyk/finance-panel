const FIRST_WAVE = ["orders", "sales", "stocks", "adverts"] as const;
const DEPENDENT_WAVE = ["advert-stats"] as const;

export type CoreSyncJob = (typeof FIRST_WAVE)[number] | (typeof DEPENDENT_WAVE)[number];

export interface SyncOrchestratorResult {
  ok: boolean;
  results: Record<string, unknown>;
}

export async function runIndependentSyncJobs(
  jobs: readonly string[],
  base: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<SyncOrchestratorResult> {
  const results: Record<string, unknown> = {};
  let ok = true;

  await Promise.all(jobs.map(async (job) => {
    try {
      const res = await fetchImpl(`${base}/api/sync/${job}`, {
        headers,
        cache: "no-store",
      });
      const raw = await res.json().catch(() => null);
      const validPayload = raw !== null && typeof raw === "object" && !Array.isArray(raw);
      const payload = objectPayload(raw);
      const jobOk = res.ok && validPayload && payload.ok === true && !payload.error;
      if (!jobOk) ok = false;
      results[job] = {
        ...payload,
        ...(!validPayload ? { error: "Некорректный JSON-ответ дочерней синхронизации" } : {}),
        ...(validPayload && payload.ok !== true && !payload.error ? { error: "Дочерняя синхронизация не подтвердила успех" } : {}),
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

export async function runCoreSyncJobs(
  base: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<SyncOrchestratorResult> {
  const results: Record<string, unknown> = {};
  let ok = true;

  const run = async (job: CoreSyncJob) => {
    try {
      const res = await fetchImpl(`${base}/api/sync/${job}`, {
        headers,
        cache: "no-store",
      });
      const raw = await res.json().catch(() => null);
      const validPayload = raw !== null && typeof raw === "object" && !Array.isArray(raw);
      const payload = objectPayload(raw);
      const jobOk = res.ok && validPayload && payload.ok === true && !payload.error;
      if (!jobOk) ok = false;
      results[job] = {
        ...payload,
        ...(!validPayload ? { error: "Некорректный JSON-ответ дочерней синхронизации" } : {}),
        ...(validPayload && payload.ok !== true && !payload.error ? { error: "Дочерняя синхронизация не подтвердила успех" } : {}),
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
  await Promise.all([
    ...FIRST_WAVE.filter((job) => job !== "adverts").map(run),
    advertsChain,
  ]);

  return { ok, results };
}
