// Ozon Performance API (реклама). OAuth2 client_credentials → Bearer.
const BASE = "https://api-performance.ozon.ru";

export interface PerfCreds { clientId: string; secret: string }

const numRu = (v: unknown) => Number(String(v ?? "0").replace(/\s/g, "").replace(",", ".")) || 0;

// fetch с таймаутом 20с — не висеть при стопоре сети/прокси.
function tfetch(url: string, opts: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(20000) });
}

export async function getPerfToken(c: PerfCreds): Promise<string | null> {
  try {
    const res = await tfetch(`${BASE}/api/client/token`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: c.clientId, client_secret: c.secret, grant_type: "client_credentials" }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { access_token?: string };
    return j.access_token ?? null;
  } catch {
    return null;
  }
}

export async function validatePerf(c: PerfCreds): Promise<boolean> {
  return (await getPerfToken(c)) != null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const result = new Array<R>(values.length);
  let next = 0;
  const runners = Array.from(
    { length: Math.min(values.length, Math.max(1, Math.floor(concurrency))) },
    async () => {
      while (next < values.length) {
        const index = next++;
        result[index] = await worker(values[index], index);
      }
    },
  );
  await Promise.all(runners);
  return result;
}

interface PerfProductReportOptions {
  throwOnError?: boolean;
}

export function performanceReportQuality(
  totalCampaigns: number,
  selectedCampaigns: number,
  totalBatches: number,
  completedBatches: number,
) {
  return {
    available: totalBatches === 0 || completedBatches > 0,
    partial: totalCampaigns > selectedCampaigns || completedBatches < totalBatches,
  };
}

// Per-SKU расход на рекламу за период (async-отчёт Performance по SKU-кампаниям).
// {bySku:{sku:{spent,ordersMoney}}} — расход и продажи с рекламы по каждому товару.
export async function perfProductReport(
  c: PerfCreds,
  fromIso: string,
  toIso: string,
  maxCampaigns = 60,
  options: PerfProductReportOptions = {},
): Promise<{
  bySku: Record<string, { spent: number; ordersMoney: number }>;
  partial: boolean;
  errors: string[];
} | null> {
  const fail = (message: string): null => {
    if (options.throwOnError) throw new Error(message);
    return null;
  };
  const token = await getPerfToken(c);
  if (!token) return fail("Performance auth: токен не получен");
  const auth = { Authorization: `Bearer ${token}` };
  try {
    // 1) SKU-кампании
    const cr = await tfetch(`${BASE}/api/client/campaign`, { headers: auth, cache: "no-store" });
    if (!cr.ok) return fail(`Performance campaigns: HTTP ${cr.status}`);
    const cj = (await cr.json()) as { list?: { id: string | number; advObjectType?: string; state?: string }[] };
    const allIds = (cj.list ?? []).filter((c) => c.advObjectType === "SKU").map((c) => String(c.id));
    const ids = allIds.slice(0, maxCampaigns);
    if (!ids.length) return { bySku: {}, partial: false, errors: [] };

    const bySku: Record<string, { spent: number; ordersMoney: number }> = {};
    // 2) отчёт батчами по 10 кампаний. Ozon нестабильно создаёт пять async-
    // отчётов одновременно; два параллельных батча укладываются в 60с и не
    // превращают весь кабинет в ошибку при временном сбое одного отчёта.
    const batches = Array.from({ length: Math.ceil(ids.length / 10) }, (_, index) => ids.slice(index * 10, index * 10 + 10));
    const loadBatch = async (batch: string[]) => {
      const gen = await tfetch(`${BASE}/api/client/statistics/json`, {
        method: "POST", headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ campaigns: batch, from: fromIso, to: toIso, groupBy: "NO_GROUP_BY" }),
        cache: "no-store",
      });
      if (!gen.ok) return { ok: false as const, error: `create HTTP ${gen.status}` };
      const uuid = ((await gen.json()) as { UUID?: string }).UUID;
      if (!uuid) return { ok: false as const, error: "create: UUID отсутствует" };
      // 3) поллинг (до 15с на батч)
      let ready = false;
      let lastState = "pending";
      for (let t = 0; t < 10; t++) {
        await sleep(1500);
        const st = await tfetch(`${BASE}/api/client/statistics/${uuid}`, { headers: auth, cache: "no-store" });
        if (!st.ok) {
          lastState = `HTTP ${st.status}`;
          continue;
        }
        lastState = ((await st.json()) as { state?: string }).state ?? "unknown";
        if (lastState === "OK") { ready = true; break; }
        if (["ERROR", "FAILED"].includes(lastState)) break;
      }
      if (!ready) return { ok: false as const, error: `status ${lastState}` };
      // 4) скачать
      const rep = await tfetch(`${BASE}/api/client/statistics/report?UUID=${uuid}`, { headers: auth, cache: "no-store" });
      if (!rep.ok) return { ok: false as const, error: `download HTTP ${rep.status}` };
      const data = (await rep.json()) as Record<string, { report?: { rows?: { sku?: string; moneySpent?: string; ordersMoney?: string }[] } }>;
      for (const camp of Object.values(data)) {
        for (const row of camp.report?.rows ?? []) {
          const sku = String(row.sku ?? "");
          if (!sku) continue;
          const e = bySku[sku] ?? { spent: 0, ordersMoney: 0 };
          e.spent += numRu(row.moneySpent);
          e.ordersMoney += numRu(row.ordersMoney);
          bySku[sku] = e;
        }
      }
      return { ok: true as const, error: null };
    };
    const results = await runWithConcurrency(batches, 2, loadBatch);
    const completedBatches = results.filter((result) => result.ok).length;
    const errors = results.flatMap((result, index) => result.ok ? [] : [`batch ${index + 1}: ${result.error}`]);
    const quality = performanceReportQuality(allIds.length, ids.length, batches.length, completedBatches);
    if (!quality.available) return fail(`Performance report: ${errors.join("; ") || "нет готовых батчей"}`);
    return { bySku, partial: quality.partial, errors };
  } catch (error) {
    if (options.throwOnError) throw error instanceof Error ? error : new Error(String(error));
    return null;
  }
}

// Посуточный расход на рекламу (сумма по всем кампаниям) + заказы с рекламы.
export async function perfDailySpend(
  c: PerfCreds, dateFrom: string, dateTo: string,
): Promise<{ byDate: Record<string, { spent: number; ordersMoney: number; orders: number }> } | null> {
  const token = await getPerfToken(c);
  if (!token) return null;
  try {
    const res = await tfetch(`${BASE}/api/client/statistics/daily/json?dateFrom=${dateFrom}&dateTo=${dateTo}`, {
      headers: { Authorization: `Bearer ${token}` }, next: { revalidate: 1800 },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { rows?: { date: string; moneySpent: string; orders: string; ordersMoney: string }[] };
    const byDate: Record<string, { spent: number; ordersMoney: number; orders: number }> = {};
    for (const r of j.rows ?? []) {
      const d = String(r.date).slice(0, 10);
      const e = byDate[d] ?? { spent: 0, ordersMoney: 0, orders: 0 };
      e.spent += numRu(r.moneySpent);
      e.ordersMoney += numRu(r.ordersMoney);
      e.orders += numRu(r.orders);
      byDate[d] = e;
    }
    return { byDate };
  } catch {
    return null;
  }
}
