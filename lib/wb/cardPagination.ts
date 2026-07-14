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
  fetchImpl?: FetchLike;
  onPage?: (page: WbCardPage<Row>) => Promise<void> | void;
}

function cursorKey(cursor: WbCardCursor): string {
  return `${cursor.updatedAt ?? ""}|${cursor.nmID ?? ""}`;
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Полный курсорный обход Content API без прежнего ограничения в 3 000 карточек. */
export async function fetchWbCardPages<Row>(options: FetchWbCardPagesOptions<Row>): Promise<WbCardPage<Row>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pageSize = options.pageSize ?? 100;
  const maxPages = options.maxPages ?? 1_000;
  const maxPagesThisRun = Math.min(options.maxPagesThisRun ?? maxPages, maxPages);
  const requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
  let cursor = options.startCursor ?? {};
  const rows: Row[] = [];
  const seenCursors = new Set<string>([cursorKey(cursor)]);

  for (let page = 0; page < maxPagesThisRun; page++) {
    let response: Response;
    try {
      response = await fetchImpl(CARDS_URL, {
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
    if (!response.ok) throw new Error(`WB Content API ${response.status}: ${(await response.text()).slice(0, 180)}`);
    const text = await response.text();
    let payload: { cards?: Row[]; cursor?: WbCardCursor };
    try {
      payload = JSON.parse(text) as { cards?: Row[]; cursor?: WbCardCursor };
    } catch {
      const snippet = compactText(text).slice(0, 180);
      throw new Error(snippet ? `WB Content API вернул не JSON: ${snippet}` : "WB Content API вернул пустой ответ");
    }
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
