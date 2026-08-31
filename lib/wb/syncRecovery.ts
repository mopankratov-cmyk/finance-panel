import { inflateRawSync } from "node:zlib";
import type { SupabaseClient } from "@supabase/supabase-js";

import { chunkedUpsert } from "@/lib/sync/helpers";
import { getWbSyncTargets, type SyncTarget } from "@/lib/sync/cabinets";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { readWbSyncState, writeWbSyncState, type WbSyncState } from "@/lib/wb/syncState";

export { readWbSyncState, writeWbSyncState, type WbSyncState } from "@/lib/wb/syncState";

const REPORTS_URL = "https://seller-analytics-api.wildberries.ru/api/v2/nm-report/downloads";
const HISTORY_JOB = "history-365";
const HISTORY_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

export interface WbHistoryState extends Record<string, unknown> {
  reportId: string;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  completedAt?: string;
  unavailableAt?: string;
  firstActiveDate?: string;
  rows?: number;
}

export interface WbHistoryResult {
  ok: boolean;
  cabinets: number;
  rows: number;
  results: Array<Record<string, unknown>>;
  errors: string[];
}

export interface WbHistoryRow {
  nm_id: number;
  date: string;
  open_card: number;
  add_to_cart: number;
  orders: number;
  orders_sum: number;
  buyouts: number;
  buyout_sum: number;
  cabinet_id?: string | null;
}

export function statisticsCursor(rows: Record<string, unknown>[], fallback: string): string {
  let latest = fallback;
  for (const row of rows) {
    const value = String(row.lastChangeDate ?? "");
    if (value && value > latest) latest = value;
  }
  return latest;
}

/**
 * Насколько назад отматывать курсор перед запросом.
 *
 * Курсор статистики WB — это `lastChangeDate` самой свежей строки ответа. Но WB
 * публикует часть строк С ЗАДЕРЖКОЙ, и у них `lastChangeDate` оказывается
 * СТАРШЕ уже сохранённого курсора: такую строку не запросят уже никогда.
 *
 * Именно так у кабинета пропали продажи за десять дней подряд: возвраты
 * (событие происходит «сейчас») приходили и вычитались из выкупов, а сами
 * продажи, опубликованные задним числом, курсор уже проскочил — в РНП это
 * выглядело как отрицательные выкупы при живых заказах.
 *
 * Перехлёст лечит гонку: каждый прогон перечитывает последние двое суток.
 * Запись идемпотентна (upsert по идентификатору строки), поэтому повтор
 * безопасен, а объём ограничен двумя днями.
 */
export const STATISTICS_OVERLAP_HOURS = 48;

/** Курсор с перехлёстом: то, что запрашиваем у WB, а не то, что храним. */
export function statisticsRequestCursor(cursor: string, hours = STATISTICS_OVERLAP_HOURS): string {
  const parsed = Date.parse(cursor.length <= 19 ? `${cursor}Z` : cursor);
  if (!Number.isFinite(parsed)) return cursor;
  return new Date(parsed - hours * 60 * 60 * 1000).toISOString().slice(0, 19);
}

export function initialStatisticsCursor(now = new Date()): string {
  // Полную историю scoped-кабинета забирает фильтрованный DETAIL_HISTORY_REPORT.
  // Синхронный statistics API для большого кабинета не успевает вернуть 90 дней
  // событий за лимит функции, поэтому live-ленту начинаем с безопасного окна.
  return new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString().slice(0, 19);
}

export function historyPeriod(now = new Date()): { start: string; end: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const end = new Date(Date.UTC(value("year"), value("month") - 1, value("day") - 1));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 364);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function historyReportPayload(
  reportId: string,
  cabinetId: string,
  nmIds: number[],
  period: { start: string; end: string },
): Record<string, unknown> {
  return {
    id: reportId,
    reportType: "DETAIL_HISTORY_REPORT",
    userReportName: `finance-panel-${cabinetId.slice(0, 8)}-${period.end}`,
    params: {
      nmIDs: nmIds,
      subjectIds: [],
      brandNames: [],
      tagIds: [],
      startDate: period.start,
      endDate: period.end,
      timezone: "Europe/Moscow",
      aggregationLevel: "day",
      skipDeletedNm: false,
    },
  };
}

function csvCells(line: string): string[] {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(value.trim());
      value = "";
    } else {
      value += char;
    }
  }
  cells.push(value.trim());
  return cells;
}

function numberCell(value: string | undefined): number {
  const parsed = Number(String(value ?? "0").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseHistoryCsv(csv: string): WbHistoryRow[] {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = csvCells(lines[0]);
  const index = new Map(headers.map((header, position) => [header, position]));
  const required = ["nmID", "dt", "openCardCount", "addToCartCount", "ordersCount", "ordersSumRub", "buyoutsCount", "buyoutsSumRub"];
  const missing = required.filter((header) => !index.has(header));
  if (missing.length) throw new Error(`WB history CSV: нет колонок ${missing.join(", ")}`);
  const cell = (values: string[], name: string) => values[index.get(name)!];

  return lines.slice(1).map(csvCells).map((values) => ({
    nm_id: numberCell(cell(values, "nmID")),
    date: String(cell(values, "dt") ?? "").slice(0, 10),
    open_card: numberCell(cell(values, "openCardCount")),
    add_to_cart: numberCell(cell(values, "addToCartCount")),
    orders: numberCell(cell(values, "ordersCount")),
    orders_sum: numberCell(cell(values, "ordersSumRub")),
    buyouts: numberCell(cell(values, "buyoutsCount")),
    buyout_sum: numberCell(cell(values, "buyoutsSumRub")),
  })).filter((row) => row.nm_id > 0 && /^\d{4}-\d{2}-\d{2}$/.test(row.date));
}

export function historyFirstActiveDate(rows: WbHistoryRow[]): string | null {
  return rows
    .filter((row) => row.orders > 0 || row.buyouts > 0)
    .reduce<string | null>((earliest, row) => !earliest || row.date < earliest ? row.date : earliest, null);
}

export function resolveHistoryNmIds(
  configuredNmIds: number[] | null,
  stockRows: Array<{ nm_id: number }>,
): number[] {
  const source = configuredNmIds === null ? stockRows.map((row) => Number(row.nm_id)) : configuredNmIds;
  return [...new Set(source.filter((nmId) => Number.isInteger(nmId) && nmId > 0))].sort((left, right) => left - right);
}

function findEndOfCentralDirectory(view: DataView): number {
  const minimum = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= minimum; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error("WB history ZIP: центральный каталог не найден");
}

export function unzipCsvFiles(input: ArrayBuffer): string[] {
  const bytes = new Uint8Array(input);
  const view = new DataView(input);
  const eocd = findEndOfCentralDirectory(view);
  const entries = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder("utf-8");
  const result: string[] = [];

  for (let entry = 0; entry < entries; entry++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("WB history ZIP: повреждён каталог");
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const fileName = decoder.decode(bytes.slice(offset + 46, offset + 46 + fileNameLength));

    if (fileName.toLowerCase().endsWith(".csv")) {
      if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("WB history ZIP: повреждён файл");
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(dataOffset, dataOffset + compressedSize);
      const content = method === 0
        ? compressed
        : method === 8
          ? new Uint8Array(inflateRawSync(compressed))
          : null;
      if (!content) throw new Error(`WB history ZIP: метод сжатия ${method} не поддерживается`);
      result.push(decoder.decode(content));
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  if (!result.length) throw new Error("WB history ZIP: CSV-файлы не найдены");
  return result;
}

async function wbRequest(url: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { Authorization: token, "Content-Type": "application/json", ...init.headers },
    cache: "no-store",
  });
}

function stateIsFresh(state: WbSyncState<WbHistoryState>, now: Date): boolean {
  if (state.status !== "complete" || !state.state.completedAt) return false;
  return now.getTime() - new Date(state.state.completedAt).getTime() < HISTORY_REFRESH_MS;
}

function stateIsUnavailableFresh(state: WbSyncState<WbHistoryState>, now: Date): boolean {
  if (state.status !== "unavailable" || !state.state.unavailableAt) return false;
  return now.getTime() - new Date(state.state.unavailableAt).getTime() < HISTORY_REFRESH_MS;
}

export function isUnavailableHistoryReportError(status: number, body: string): boolean {
  if (status !== 403) return false;
  return /Report not available/i.test(body) || /analytics-open-api/i.test(body);
}

async function storedFirstActiveDate(
  db: SupabaseClient,
  cabinetId: string,
  nmIds: number[],
): Promise<string | null> {
  const { data, error } = await db
    .from("wb_funnel_daily")
    .select("date")
    .eq("cabinet_id", cabinetId)
    .in("nm_id", nmIds)
    .or("orders.gt.0,buyouts.gt.0")
    .order("date", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`поиск первой активности: ${error.message}`);
  return data?.date ? String(data.date) : null;
}

async function bootstrapDetailCursors(
  db: SupabaseClient,
  cabinetId: string,
  firstActiveDate: string | null,
  now: Date,
): Promise<void> {
  if (!firstActiveDate) return;
  const cursor = `${firstActiveDate}T00:00:00`;
  for (const job of ["orders", "sales"]) {
    const current = await readWbSyncState(db, cabinetId, job);
    if (current?.status === "caught_up" || (current?.cursor && current.cursor >= cursor)) continue;
    const error = await writeWbSyncState(db, cabinetId, job, {
      cursor,
      status: "backfill",
      attempts: 0,
      lastError: null,
      state: {
        ...(current?.state ?? {}),
        bootstrapFromHistory: firstActiveDate,
        bootstrappedAt: now.toISOString(),
      },
    });
    if (error) throw new Error(`ускорение ${job}: ${error}`);
  }
}

async function historyNmIdsForTarget(db: SupabaseClient, target: SyncTarget): Promise<number[]> {
  const configuredNmIds = target.productScope.allowedNmIds;
  if (configuredNmIds !== null) return resolveHistoryNmIds(configuredNmIds, []);
  if (!target.cabinetId) return [];

  const stockRows = await loadAllSupabasePages<{ nm_id: number }>((from, to) => db
    .from("wb_stocks")
    .select("nm_id")
    .eq("cabinet_id", target.cabinetId!)
    .order("nm_id", { ascending: true })
    .range(from, to), { maxPages: 1_000, label: `SKU глубокой истории ${target.name}` });
  return resolveHistoryNmIds(null, stockRows);
}

export async function runWbHistoryRecovery(now = new Date()): Promise<WbHistoryResult> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, cabinets: 0, rows: 0, results: [], errors: ["Supabase не настроен"] };
  const targets = (await getWbSyncTargets()).filter((target) => target.cabinetId);
  const period = historyPeriod(now);
  const results: Array<Record<string, unknown>> = [];
  const errors: string[] = [];
  let totalRows = 0;

  for (const target of targets) {
    const cabinetId = target.cabinetId!;
    let state = await readWbSyncState<WbHistoryState>(db, cabinetId, HISTORY_JOB);

    try {
      const nmIds = await historyNmIdsForTarget(db, target);
      if (!nmIds.length) {
        results.push({ cabinet: target.name, status: "empty", rows: 0 });
        continue;
      }
      if (state && stateIsUnavailableFresh(state, now)) {
        results.push({ cabinet: target.name, status: "unavailable", reason: state.lastError ?? "WB history report unavailable" });
        continue;
      }

      if (state && stateIsFresh(state, now)) {
        const firstActiveDate = state.state.firstActiveDate
          ?? await storedFirstActiveDate(db, cabinetId, nmIds);
        await bootstrapDetailCursors(db, cabinetId, firstActiveDate, now);
        if (firstActiveDate && !state.state.firstActiveDate) {
          const stateError = await writeWbSyncState(db, cabinetId, HISTORY_JOB, {
            ...state,
            state: { ...state.state, firstActiveDate },
          });
          if (stateError) throw new Error(`фиксация первой активности: ${stateError}`);
        }
        results.push({ cabinet: target.name, status: "complete", rows: state.state.rows ?? 0, periodEnd: state.state.periodEnd, firstActiveDate });
        continue;
      }

      if (!state || state.status === "complete" || state.status === "unavailable" || state.attempts >= 3) {
        const reportId = crypto.randomUUID();
        const response = await wbRequest(REPORTS_URL, target.statsToken, {
          method: "POST",
          body: JSON.stringify(historyReportPayload(reportId, cabinetId, nmIds, period)),
        });
        if (!response.ok) {
          const body = (await response.text()).slice(0, 180);
          if (isUnavailableHistoryReportError(response.status, body)) {
            const reason = `создание отчёта: WB ${response.status}: ${body}`;
            const unavailableState: WbHistoryState = {
              reportId,
              periodStart: period.start,
              periodEnd: period.end,
              createdAt: now.toISOString(),
              unavailableAt: now.toISOString(),
            };
            const stateError = await writeWbSyncState(db, cabinetId, HISTORY_JOB, {
              status: "unavailable",
              attempts: 0,
              lastError: reason,
              state: unavailableState,
            });
            if (stateError) throw new Error(`состояние истории: ${stateError}`);
            results.push({ cabinet: target.name, status: "unavailable", reason });
            continue;
          }
          throw new Error(`создание отчёта: WB ${response.status}: ${body}`);
        }
        const historyState: WbHistoryState = { reportId, periodStart: period.start, periodEnd: period.end, createdAt: now.toISOString() };
        const stateError = await writeWbSyncState(db, cabinetId, HISTORY_JOB, { status: "pending", attempts: 0, state: historyState });
        if (stateError) throw new Error(`состояние истории: ${stateError}`);
        results.push({ cabinet: target.name, status: "created", reportId, period });
        continue;
      }

      const reportId = state.state.reportId;
      if (state.status === "failed") {
        const retry = await wbRequest(`${REPORTS_URL}/retry`, target.statsToken, {
          method: "POST",
          body: JSON.stringify({ downloadId: reportId }),
        });
        if (!retry.ok) throw new Error(`повтор отчёта: WB ${retry.status}: ${(await retry.text()).slice(0, 180)}`);
        await writeWbSyncState(db, cabinetId, HISTORY_JOB, { ...state, status: "pending", attempts: state.attempts + 1, lastError: null });
        results.push({ cabinet: target.name, status: "retry", reportId });
        continue;
      }

      const listUrl = new URL(REPORTS_URL);
      listUrl.searchParams.append("filter[downloadIds]", reportId);
      const statusResponse = await wbRequest(listUrl.toString(), target.statsToken);
      if (!statusResponse.ok) throw new Error(`статус отчёта: WB ${statusResponse.status}: ${(await statusResponse.text()).slice(0, 180)}`);
      const statusJson = await statusResponse.json() as { data?: Array<{ id?: string; status?: string }> };
      const report = statusJson.data?.find((item) => item.id === reportId);
      if (!report || !report.status || ["PENDING", "PROCESSING", "NEW"].includes(report.status)) {
        results.push({ cabinet: target.name, status: "pending", reportId });
        continue;
      }
      if (report.status === "FAILED") {
        await writeWbSyncState(db, cabinetId, HISTORY_JOB, { ...state, status: "failed", attempts: state.attempts + 1, lastError: "WB report FAILED" });
        results.push({ cabinet: target.name, status: "failed", reportId });
        continue;
      }
      if (report.status !== "SUCCESS") throw new Error(`неизвестный статус отчёта: ${report.status}`);

      const download = await wbRequest(`${REPORTS_URL}/file/${reportId}`, target.statsToken);
      if (!download.ok) throw new Error(`скачивание отчёта: WB ${download.status}: ${(await download.text()).slice(0, 180)}`);
      const allowed = new Set(nmIds);
      const rows = unzipCsvFiles(await download.arrayBuffer())
        .flatMap(parseHistoryCsv)
        .filter((row) => allowed.has(row.nm_id))
        .map((row) => ({ ...row, cabinet_id: cabinetId }));
      const upsertError = await chunkedUpsert("wb_funnel_daily", rows, "cabinet_id,nm_id,date", 100_000);
      if (upsertError) throw new Error(`запись истории: ${upsertError}`);

      totalRows += rows.length;
      const firstActiveDate = historyFirstActiveDate(rows);
      await bootstrapDetailCursors(db, cabinetId, firstActiveDate, now);
      const completedState: WbHistoryState = {
        ...state.state,
        completedAt: now.toISOString(),
        firstActiveDate: firstActiveDate ?? undefined,
        rows: rows.length,
      };
      const completeStateError = await writeWbSyncState(db, cabinetId, HISTORY_JOB, {
        status: "complete",
        attempts: 0,
        lastError: null,
        state: completedState,
      });
      if (completeStateError) throw new Error(`фиксация состояния истории: ${completeStateError}`);
      results.push({ cabinet: target.name, status: "complete", reportId, rows: rows.length, firstActiveDate, period: { start: state.state.periodStart, end: state.state.periodEnd } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      errors.push(`${target.name}: ${message}`);
      if (state) await writeWbSyncState(db, cabinetId, HISTORY_JOB, { ...state, status: "failed", attempts: state.attempts + 1, lastError: message });
      results.push({ cabinet: target.name, status: "error", error: message });
    }
  }

  return { ok: errors.length === 0, cabinets: targets.length, rows: totalRows, results, errors };
}
