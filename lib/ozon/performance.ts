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

export interface PerfProductReportBatchState {
  campaigns: string[];
  uuid?: string;
  done?: boolean;
  bySku?: Record<string, { spent: number; ordersMoney: number }>;
  /** Расход по дням: дата → товар → расход. Нужен, чтобы складывать любой период. */
  byDay?: Record<string, Record<string, { spent: number; ordersMoney: number }>>;
}

/**
 * Формат отчёта. Незавершённый отчёт продолжается по сохранённому UUID, но
 * когда меняется сам запрос — например, добавляется разбивка по датам —
 * старый отчёт вернёт данные прежней формы. Признак формата отменяет
 * возобновление, чтобы отчёт заказали заново.
 */
export const PERF_REPORT_FORMAT = "date-v1";

export interface PerfProductReportResumeState {
  format?: string;
  periodFrom: string;
  periodTo: string;
  campaignIds: string[];
  batches: PerfProductReportBatchState[];
}

interface PerfProductReportOptions {
  throwOnError?: boolean;
  allowPending?: boolean;
  resumeState?: PerfProductReportResumeState | null;
  onState?: (state: PerfProductReportResumeState) => Promise<void> | void;
  pollAttempts?: number;
  pollIntervalMs?: number;
  maxBatchesPerRun?: number;
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

export function isOzonPerformanceReportDeferredMessage(value: unknown) {
  const message = String(value ?? "");
  if (!/Performance report/i.test(message)) return false;
  return /\bHTTP 429\b/i.test(message)
    || /status\s+(?:NOT_STARTED|IN_PROGRESS|PROCESSING|PENDING)/i.test(message)
    || /нет готовых батчей/i.test(message);
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
  byDay: Record<string, Record<string, { spent: number; ordersMoney: number }>>;
  partial: boolean;
  errors: string[];
  complete: boolean;
  resumeState: PerfProductReportResumeState;
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
    if (!ids.length) return {
      bySku: {},
      byDay: {},
      partial: false,
      errors: [],
      complete: true,
      resumeState: { periodFrom: fromIso, periodTo: toIso, campaignIds: [], batches: [] },
    };

    const bySku: Record<string, { spent: number; ordersMoney: number }> = {};
    const byDay: Record<string, Record<string, { spent: number; ordersMoney: number }>> = {};
    // Ozon готовит Performance-отчёты асинхронно. Сохраняем UUID и уже
    // скачанные батчи, чтобы serverless-запуск мог продолжить их через час,
    // а не создавать новые отчёты бесконечно.
    const canResume = options.resumeState
      && options.resumeState.format === PERF_REPORT_FORMAT
      && options.resumeState.periodFrom === fromIso
      && options.resumeState.periodTo === toIso
      && options.resumeState.campaignIds.join(",") === ids.join(",");
    const resumeState: PerfProductReportResumeState = canResume
      ? structuredClone(options.resumeState!)
      : {
          format: PERF_REPORT_FORMAT,
          periodFrom: fromIso,
          periodTo: toIso,
          campaignIds: ids,
          batches: Array.from(
            { length: Math.ceil(ids.length / 10) },
            (_, index) => ({ campaigns: ids.slice(index * 10, index * 10 + 10) }),
          ),
        };
    const persistState = async () => options.onState?.(structuredClone(resumeState));
    const loadBatch = async (batchState: PerfProductReportBatchState) => {
      if (batchState.done) return { ok: true as const, error: null, rateLimited: false };
      let uuid = batchState.uuid;
      if (!uuid) {
        const gen = await tfetch(`${BASE}/api/client/statistics/json`, {
          method: "POST", headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({ campaigns: batchState.campaigns, from: fromIso, to: toIso, groupBy: "DATE" }),
          cache: "no-store",
        });
        // 429 на создании — Ozon разрешает готовить отчёты по одному. Это не
        // ошибка батча, а «сейчас больше нельзя»: помечаем отдельно, чтобы
        // не сжечь остальные батчи такими же отказами в этом же заходе.
        if (!gen.ok) return { ok: false as const, error: `create HTTP ${gen.status}`, rateLimited: gen.status === 429 };
        uuid = ((await gen.json()) as { UUID?: string }).UUID;
        if (!uuid) return { ok: false as const, error: "create: UUID отсутствует", rateLimited: false };
        batchState.uuid = uuid;
        await persistState();
      }
      // По умолчанию сохраняем прежнее короткое ожидание для интерактивных
      // экранов. Фоновый синк задаёт больше попыток и сохраняет UUID между ними.
      let ready = false;
      let lastState = "pending";
      // Заказанный ранее отчёт либо уже готов, либо ещё нет — сидеть над ним
      // все попытки бессмысленно: заход успеет забрать другие готовые.
      const resumed = Boolean(batchState.uuid) && batchState.uuid === uuid;
      const pollAttempts = resumed ? 3 : Math.max(1, options.pollAttempts ?? 10);
      const pollIntervalMs = Math.max(0, options.pollIntervalMs ?? 1_500);
      for (let t = 0; t < pollAttempts; t++) {
        await sleep(pollIntervalMs);
        const st = await tfetch(`${BASE}/api/client/statistics/${uuid}`, { headers: auth, cache: "no-store" });
        if (!st.ok) {
          lastState = `HTTP ${st.status}`;
          continue;
        }
        lastState = ((await st.json()) as { state?: string }).state ?? "unknown";
        if (lastState === "OK") { ready = true; break; }
        if (["ERROR", "FAILED"].includes(lastState)) break;
      }
      if (!ready) {
        if (/^(?:ERROR|FAILED|HTTP 404)$/i.test(lastState)) {
          delete batchState.uuid;
          await persistState();
        }
        return { ok: false as const, error: `status ${lastState}`, rateLimited: false };
      }
      // 4) скачать
      const rep = await tfetch(`${BASE}/api/client/statistics/report?UUID=${uuid}`, { headers: auth, cache: "no-store" });
      if (!rep.ok) {
        if (rep.status === 404) {
          delete batchState.uuid;
          await persistState();
        }
        return { ok: false as const, error: `download HTTP ${rep.status}`, rateLimited: rep.status === 429 };
      }
      const data = (await rep.json()) as Record<string, { report?: { rows?: { date?: string; sku?: string; moneySpent?: string; ordersMoney?: string }[] } }>;
      const batchBySku: Record<string, { spent: number; ordersMoney: number }> = {};
      // Расход по дням на товар. Скользящее окно «последние N дней» отвечает
      // только на один вопрос — за эти N дней; на экране с периодом
      // 01.08-26.08 оно молчит, и колонка рекламы показывает нули. Посуточные
      // строки складываются под любой период, как это сделано для WB.
      const batchByDay: Record<string, Record<string, { spent: number; ordersMoney: number }>> = {};
      for (const camp of Object.values(data)) {
        for (const row of camp.report?.rows ?? []) {
          const sku = String(row.sku ?? "");
          if (!sku) continue;
          const day = String(row.date ?? "").slice(0, 10);
          if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
            const perDay = batchByDay[day] ?? (batchByDay[day] = {});
            const d = perDay[sku] ?? { spent: 0, ordersMoney: 0 };
            d.spent += numRu(row.moneySpent);
            d.ordersMoney += numRu(row.ordersMoney);
            perDay[sku] = d;
          }
          const e = batchBySku[sku] ?? { spent: 0, ordersMoney: 0 };
          e.spent += numRu(row.moneySpent);
          e.ordersMoney += numRu(row.ordersMoney);
          batchBySku[sku] = e;
        }
      }
      batchState.bySku = batchBySku;
      batchState.byDay = batchByDay;
      batchState.done = true;
      await persistState();
      return { ok: true as const, error: null, rateLimited: false };
    };
    // Создаём/поллим отчёты последовательно: параллельные create-запросы Ozon
    // регулярно отвечают 429. Состояние после каждого батча уже сохранено.
    // Сначала батчи с уже заказанным отчётом: их можно только скачать, отказа
    // по частоте они не вызывают. Новые заказы — в конце, и первый же отказ
    // прекращает заход.
    const allPending = resumeState.batches.filter((batch) => !batch.done);
    const pendingBatches = [
      ...allPending.filter((batch) => batch.uuid),
      ...allPending.filter((batch) => !batch.uuid),
    ];
    const maxBatchesPerRun = Math.max(1, Math.floor((options.maxBatchesPerRun ?? pendingBatches.length) || 1));
    const selectedBatches = pendingBatches.slice(0, maxBatchesPerRun);
    const results = [];
    for (const batch of selectedBatches) {
      const result = await loadBatch(batch);
      results.push(result);
      // Дальше в этом заходе создавать нечего: Ozon только что отказал по
      // частоте. Раньше цикл шёл к следующему батчу и получал такой же 429 —
      // за один заход сгорали все батчи, и отчёт не двигался с места ни разу.
      if (!result.ok && result.rateLimited) break;
    }
    for (const batch of resumeState.batches) {
      for (const [day, perSku] of Object.entries(batch.byDay ?? {})) {
        const target = byDay[day] ?? (byDay[day] = {});
        for (const [sku, value] of Object.entries(perSku)) {
          const aggregate = target[sku] ?? { spent: 0, ordersMoney: 0 };
          aggregate.spent += value.spent;
          aggregate.ordersMoney += value.ordersMoney;
          target[sku] = aggregate;
        }
      }
      for (const [sku, value] of Object.entries(batch.bySku ?? {})) {
        const aggregate = bySku[sku] ?? { spent: 0, ordersMoney: 0 };
        aggregate.spent += value.spent;
        aggregate.ordersMoney += value.ordersMoney;
        bySku[sku] = aggregate;
      }
    }
    const completedBatches = resumeState.batches.filter((batch) => batch.done).length;
    const errors = results.flatMap((result, index) => result.ok ? [] : [`batch ${index + 1}: ${result.error}`]);
    if (completedBatches < resumeState.batches.length && selectedBatches.length < pendingBatches.length) {
      errors.push(`ещё батчей: ${resumeState.batches.length - completedBatches}`);
    }
    const quality = performanceReportQuality(allIds.length, ids.length, resumeState.batches.length, completedBatches);
    const complete = completedBatches === resumeState.batches.length;
    if (!quality.available && !options.allowPending) return fail(`Performance report: ${errors.join("; ") || "нет готовых батчей"}`);
    return { bySku, byDay, partial: quality.partial, errors, complete, resumeState };
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
