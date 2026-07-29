type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const CARDS_URL = "https://content-api.wildberries.ru/content/v2/get/cards/list";

export interface WbCardCursor {
  updatedAt?: string;
  nmID?: number;
}

export interface WbCardPage<Row> {
  rows: Row[];
  cursor: WbCardCursor;
  caughtUp: boolean;
  pages: number;
}

export interface FetchWbCardPagesOptions<Row> {
  token: string;
  startCursor?: WbCardCursor;
  pageSize?: number;
  maxPages?: number;
  maxPagesThisRun?: number;
  requestTimeoutMs?: number;
  minIntervalMs?: number;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  onPage?: (page: WbCardPage<Row>) => Promise<void> | void;
}

export interface FetchWbCardsByNmIdsOptions<Row extends { nmID: number }> {
  token: string;
  nmIds: number[];
  requestTimeoutMs?: number;
  minIntervalMs?: number;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
}

function cursorKey(cursor: WbCardCursor): string {
  return `${cursor.updatedAt ?? ""}|${cursor.nmID ?? ""}`;
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function retryDelayMs(response: Response, fallbackMs: number): number {
  const wbRaw = response.headers.get("x-ratelimit-retry");
  const wbSeconds = wbRaw ? Number(wbRaw) : Number.NaN;
  if (Number.isFinite(wbSeconds)) return Math.max(0, wbSeconds * 1000);

  const raw = response.headers.get("retry-after");
  const seconds = raw ? Number(raw) : Number.NaN;
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const retryAt = raw ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : fallbackMs;
}

async function requestWithRateLimitRetry(
  request: () => Promise<Response>,
  sleep: (ms: number) => Promise<void>,
  fallbackMs: number,
) {
  let response = await request();
  for (let retry = 0; response.status === 429 && retry < 2; retry += 1) {
    // WB прямо требует ждать X-Ratelimit-Retry. Один повтор оказался
    // недостаточным: несколько виртуальных кабинетов одного продавца могли
    // одновременно повторить запрос и снова попасть в общий лимитер.
    await sleep(Math.min(retryDelayMs(response, fallbackMs), 60_000));
    response = await request();
  }
  return response;
}

async function readCardPayload<Row>(response: Response): Promise<{ cards?: Row[]; cursor?: WbCardCursor }> {
  if (!response.ok) throw new Error(`WB Content API ${response.status}: ${(await response.text()).slice(0, 180)}`);
  const text = await response.text();
  try {
    return JSON.parse(text) as { cards?: Row[]; cursor?: WbCardCursor };
  } catch {
    const snippet = compactText(text).slice(0, 180);
    throw new Error(snippet ? `WB Content API вернул не JSON: ${snippet}` : "WB Content API вернул пустой ответ");
  }
}

/**
 * Быстрый путь для кабинетов с точным allowlist: WB поддерживает textSearch
 * только для одного артикула за запрос, поэтому ищем разрешённые nmID
 * последовательно и соблюдаем интервал Content API.
 */
export async function fetchWbCardsByNmIds<Row extends { nmID: number }>(
  options: FetchWbCardsByNmIdsOptions<Row>,
): Promise<Row[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
  const minIntervalMs = options.minIntervalMs ?? 600;
  const nmIds = [...new Set(options.nmIds.filter((nmId) => Number.isInteger(nmId) && nmId > 0))];
  const rows = new Map<number, Row>();
  let requestsMade = 0;

  const fetchExactCard = async (nmId: number): Promise<Row | undefined> => {
    if (requestsMade > 0 && minIntervalMs > 0) await sleep(minIntervalMs);
    const body = JSON.stringify({
      settings: {
        cursor: { limit: 100 },
        filter: { withPhoto: -1, textSearch: String(nmId) },
      },
    });
    const request = () => fetchImpl(CARDS_URL, {
      method: "POST",
      headers: { Authorization: options.token, "Content-Type": "application/json" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(requestTimeoutMs),
    });

    const response = await requestWithRateLimitRetry(async () => {
      requestsMade++;
      return request();
    }, sleep, Math.max(minIntervalMs, 1_000));
    const payload = await readCardPayload<Row>(response);
    return (Array.isArray(payload.cards) ? payload.cards : []).find((card) => card.nmID === nmId);
  };

  for (const nmId of nmIds) {
    const exact = await fetchExactCard(nmId);
    if (exact) rows.set(nmId, exact);
  }

  const missing = nmIds.filter((nmId) => !rows.has(nmId));
  for (const nmId of missing) {
    const exact = await fetchExactCard(nmId);
    if (exact) rows.set(nmId, exact);
  }

  const stillMissing = missing.filter((nmId) => !rows.has(nmId));
  if (stillMissing.length > 0) {
    throw new Error(`WB Content API не вернул карточки для nmID: ${stillMissing.join(", ")}`);
  }

  return nmIds
    .map((nmId) => rows.get(nmId))
    .filter((row): row is Row => row !== undefined);
}

/** Полный курсорный обход Content API без прежнего ограничения в 3 000 карточек. */
export async function fetchWbCardPages<Row>(options: FetchWbCardPagesOptions<Row>): Promise<WbCardPage<Row>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const pageSize = options.pageSize ?? 100;
  const maxPages = options.maxPages ?? 1_000;
  const maxPagesThisRun = Math.min(options.maxPagesThisRun ?? maxPages, maxPages);
  const requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
  // Боевой Content API разрешает один запрос каждые 600 мс. В unit-тестах с
  // подменённым fetch задержка по умолчанию не нужна.
  const minIntervalMs = options.minIntervalMs ?? (options.fetchImpl ? 0 : 600);
  let cursor = options.startCursor ?? {};
  const rows: Row[] = [];
  const seenCursors = new Set<string>([cursorKey(cursor)]);

  for (let page = 0; page < maxPagesThisRun; page++) {
    if (page > 0 && minIntervalMs > 0) await sleep(minIntervalMs);
    const requestPage = async () => {
      try {
        return await fetchImpl(CARDS_URL, {
          method: "POST",
          headers: { Authorization: options.token, "Content-Type": "application/json" },
          body: JSON.stringify({ settings: { cursor: { limit: pageSize, ...cursor }, filter: { withPhoto: -1 } } }),
          cache: "no-store",
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (/timeout|timed out|aborted|abort/i.test(message)) {
          throw new Error(`WB Content API не ответил за ${Math.round(requestTimeoutMs / 1000)} секунд`);
        }
        throw error;
      }
    };
    const response = await requestWithRateLimitRetry(requestPage, sleep, Math.max(minIntervalMs, 1_000));
    const payload = await readCardPayload<Row>(response);
    const batch = Array.isArray(payload.cards) ? payload.cards : [];
    rows.push(...batch);

    const nextCursor = payload.cursor ?? cursor;
    const caughtUp = batch.length < pageSize;
    const snapshot = { rows: batch, cursor: nextCursor, caughtUp, pages: page + 1 };
    await options.onPage?.(snapshot);
    if (caughtUp) return { rows, cursor: nextCursor, caughtUp: true, pages: page + 1 };

    const key = cursorKey(nextCursor);
    if (seenCursors.has(key)) throw new Error("WB Content API не продвинул курсор каталога");
    seenCursors.add(key);
    cursor = nextCursor;
  }

  return { rows, cursor, caughtUp: false, pages: maxPagesThisRun };
}
