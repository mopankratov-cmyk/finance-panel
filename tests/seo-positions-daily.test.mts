import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { SyncTarget } from "../lib/sync/cabinets.ts";
import { closedMoscowDates } from "../lib/wb/sklejki.ts";
import { claimWbSyncJob, readWbSyncState, readWbSyncStateOrThrow, type WbSyncState } from "../lib/wb/syncState.ts";
import {
  SEO_BATCH_MAX_ATTEMPTS,
  SEO_EMPTY_PROBE_EVERY_MS,
  SEO_GROUP_CUTOFF_AFTER_DEADLINE_MS,
  SEO_HOLE_MAX_NIGHTS,
  SEO_HOLE_REQUESTS_OLDER,
  SEO_HOLE_REQUESTS_YESTERDAY,
  SEO_HOLE_SPLIT_AFTER,
  SEO_NOTE_MEASURED_EMPTY,
  SEO_REQUEST_OVERRUN_MS,
  SEO_REQUEST_SPACING_MS,
  SEO_SYSTEMATIC_400_REQUESTS,
  SEO_UNAVAILABLE_COOLDOWN_MS,
  buildKeywordsPayload,
  classifySearchTextsFailure,
  holeCovers,
  isClosedDaySnapshot,
  isSeoUnavailablePause,
  loadSeoKeywords,
  loadSeoNmIds,
  looksTruncated,
  nextSeoBatch,
  nextSeoSingle,
  resetSeoState,
  runSeoPositionsGroup,
  searchTextsDayBody,
  selectClosedHistory,
  seoDaysToMeasure,
  seoEmptyOlderCount,
  seoFailureMessage,
  seoGroupErrorResults,
  seoHistoryWindow,
  seoLivePlan,
  seoMeasuredByNight,
  seoRequestTimeoutMs,
  seoResetWrite,
  seoRowsFromItems,
  seoUnavailableMessage,
  seoUnresolvedHoleCount,
  settleWithin,
  summarizeSeoRun,
  type SearchTextItem,
  type SeoGroupResult,
  type SeoJobDeps,
  type SeoKeywordsDeps,
  type SeoPositionRow,
  type SeoPositionsState,
  type SeoSnapRow,
} from "../lib/wb/seoPositions.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");

// 04:13 по Москве 05.10.2026: вчерашний закрытый день — 04.10.
const NIGHT = Date.parse("2026-10-05T01:13:00Z");
const YESTERDAY = "2026-10-04";
const HOUR = 3_600_000;

// ------------------------------------------------------------------ крон и исходники роутов

test("Крон заведён в ночное окно, роут отвечает на GET под cron-авторизацией и берёт аренду", () => {
  const vercel = JSON.parse(read("vercel.json")) as { crons: Array<{ path: string; schedule: string }> };
  assert.deepEqual(
    vercel.crons.filter((cron) => cron.path === "/api/sync/seo-positions"),
    [{ path: "/api/sync/seo-positions", schedule: "13,43 1-4 * * *" }],
  );
  const route = read("app/api/sync/seo-positions/route.ts");
  assert.match(route, /export async function GET/, "Vercel зовёт кроны GET");
  assert.match(route, /checkCronAuth\(request\)/);
  assert.ok(
    route.indexOf("checkCronAuth(request)") < route.indexOf("getSupabaseAdmin()"),
    "авторизация — первым делом, до любого доступа к базе",
  );
  assert.match(route, /maxDuration = 300/);
  assert.match(route, /claimWbSyncJob\(/);
  assert.match(route, /SEO_POSITIONS_JOB/);
  assert.doesNotMatch(route, /export async function POST/);
});

test("Роут без Bearer CRON_SECRET отвечает 401: модуль грузится, до базы и WB дело не доходит", async () => {
  process.env.CRON_SECRET = "seo-positions-test-secret";
  const { NextRequest } = await import("next/server");
  const { GET } = await import("../app/api/sync/seo-positions/route.ts");
  const response = await GET(new NextRequest("http://localhost/api/sync/seo-positions"));
  assert.equal(response.status, 401);
  const wrong = await GET(new NextRequest("http://localhost/api/sync/seo-positions", { headers: { authorization: "Bearer other" } }));
  assert.equal(wrong.status, 401);
});

test("Ленивый роут — тонкая обвязка: решения в lib, а у обвязки есть вызовы, которых строки импорта не обеспечат", () => {
  const lazy = read("app/api/seo/keywords/[nm]/route.ts");
  assert.doesNotMatch(lazy, /13 \* 86400000/, "окно в 14 суток");
  assert.doesNotMatch(lazy, /offset: 0/, "у метода нет offset");
  assert.doesNotMatch(lazy, /toISOString\(\)\.slice\(0, 10\)/, "даты по UTC отстают на день после 21:00 МСК");
  // Окно запроса берётся из seoHistoryWindow (его проверяют тесты ниже), а не собирается в роуте.
  assert.match(lazy, /\.gte\("snapshot_date", window\.from\)/);
  assert.match(lazy, /\.lte\("snapshot_date", window\.to\)/);
  assert.match(lazy, /loadAllSupabasePages<SeoSnapRow>\(/, "история постранично: PostgREST режет ответ на тысяче строк");
  assert.match(lazy, /await loadSeoKeywords\(deps, \{ nmId, cabinetId: ownerCabinet\?\.id \?\? null \}\)/);
  assert.match(lazy, /return NextResponse\.json\(payload\)/);
  // Вызовы обвязки, которых не обеспечат ни lib, ни импорты: убери любой — экран молча покажет чужое или потратит квоту WB.
  assert.match(lazy, /\.eq\("nm_id", nmId\)/, "история только этого артикула");
  assert.match(lazy, /readWbSyncState<SeoPositionsState>\(db, ownerCabinet\.id, SEO_POSITIONS_JOB\)/, "состояние ночного замера кабинета-владельца");
  assert.match(lazy, /wbTokenForNm\(nmId, "analytics"\)/, "токен категории «Аналитика» этого артикула");
  assert.match(lazy, /searchTextsDayBody\(\[nmId\], day\)/, "запрос по этому артикулу за этот день");
  assert.match(lazy, /onConflict: "nm_id,keyword,snapshot_date"/, "повторная запись не плодит строки");
  assert.match(lazy, /hasCabinetAccess\(ownerCabinet\?\.id \?\? null\)/, "проверка доступа к кабинету");
  assert.doesNotMatch(lazy, /isClosedDaySnapshot|seoLivePlan|measuredByNight|snaps\.some/, "решения вернулись в роут — их тесты не покроют");
});

// ------------------------------------------------------------------ чистые функции

test("searchTextsDayBody: период — один день, limit 30, поля offset нет", () => {
  const body = JSON.parse(searchTextsDayBody([11, 12], "2026-10-04")) as Record<string, unknown>;
  assert.deepEqual(body.currentPeriod, { start: "2026-10-04", end: "2026-10-04" });
  assert.deepEqual(body.nmIds, [11, 12]);
  assert.equal(body.limit, 30);
  assert.equal("offset" in body, false);
});

test("seoDaysToMeasure: после полуночи по Москве, но до полуночи по UTC вчера — это 04.10, а не 03.10", () => {
  // 22:30 UTC 04.10 = 01:30 МСК 05.10. Окно по toISOString дало бы вчерашним 03.10.
  const days = seoDaysToMeasure([], Date.parse("2026-10-04T22:30:00Z"));
  assert.equal(days[0], "2026-10-04");
  assert.equal(days.length, 30);
  assert.equal(days[29], "2026-09-05");
  assert.deepEqual(days, closedMoscowDates(30, Date.parse("2026-10-04T22:30:00Z")).reverse());
});

test("seoDaysToMeasure: сделанные дни исключаются, порядок — от новых к старым", () => {
  const days = seoDaysToMeasure(["2026-10-04", "2026-10-02"], NIGHT);
  assert.equal(days.length, 28);
  assert.deepEqual(days.slice(0, 3), ["2026-10-03", "2026-10-01", "2026-09-30"]);
});

const item = (nmId: number, text: string, over: Partial<SearchTextItem> = {}): SearchTextItem => ({
  text,
  nmId,
  frequency: { current: 120 },
  medianPosition: { current: 7 },
  avgPosition: { current: 9 },
  ...over,
});
const rowsOpts = (over: Partial<Parameters<typeof seoRowsFromItems>[1]> = {}) => ({
  day: YESTERDAY,
  cabinetId: "cab-1",
  requested: new Set([1, 2]),
  allowNm: () => true,
  syncedAt: "2026-10-05T01:15:00.000Z",
  ...over,
});

test("seoRowsFromItems: медиана важнее среднего, ноль — «нет данных»", () => {
  const rows = seoRowsFromItems([
    item(1, "куртка"),
    item(1, "пуховик", { medianPosition: { current: 0 } }),
    item(1, "парка", { medianPosition: { current: 0 }, avgPosition: { current: 0 } }),
    item(1, "анорак", { medianPosition: undefined, avgPosition: { current: 14 } }),
  ], rowsOpts());
  const byKeyword = new Map(rows.map((row) => [row.keyword, row.median_position]));
  assert.equal(byKeyword.get("куртка"), 7, "медиана, а не среднее 9");
  assert.equal(byKeyword.get("пуховик"), 9, "нулевая медиана — берём среднее");
  assert.equal(byKeyword.get("парка"), null, "ноль в обоих полях — null, а не 0");
  assert.equal(byKeyword.get("анорак"), 14);
  assert.equal(rows[0].snapshot_date, YESTERDAY);
  assert.equal(rows[0].cabinet_id, "cab-1");
  assert.equal(rows[0].frequency, 120);
});

test("seoRowsFromItems: чужие артикулы, пустые запросы и повторы отброшены", () => {
  const rows = seoRowsFromItems([
    item(1, "куртка"),
    item(1, "  куртка  "),
    item(2, "куртка"),
    item(3, "куртка"),
    item(1, "   "),
    item(1, ""),
    { nmId: 1, medianPosition: { current: 3 } },
  ], rowsOpts({ allowNm: (nm) => nm !== 2 }));
  assert.deepEqual(rows.map((row) => [row.nm_id, row.keyword]), [[1, "куртка"]],
    "nm=3 не из пакета, nm=2 не из контура, пустые и повтор убраны (иначе upsert падает целиком)");
});

test("classifySearchTextsFailure: все случаи ответа WB", () => {
  assert.deepEqual(classifySearchTextsFailure(429, '{"title":"too many requests"}'), { kind: "rate_limit" });
  assert.deepEqual(classifySearchTextsFailure(429, ""), { kind: "rate_limit" });
  const reason = (status: number, body: string) => {
    const failure = classifySearchTextsFailure(status, body);
    return failure.kind === "unavailable" ? failure.reason : failure.kind;
  };
  assert.equal(reason(403, '{"detail":"scope is not allowed for this resource"}'), "token_scope");
  assert.equal(reason(403, '{"detail":"base token is not allowed"}'), "base_token");
  assert.equal(reason(403, '{"detail":"Available only in a Jam subscription"}'), "no_jam");
  assert.equal(reason(403, "Нужна подписка Джем"), "no_jam");
  assert.equal(reason(403, '{"detail":"Authorization error"}'), "forbidden", "любой другой 403 — не «нужен Джем»");
  assert.equal(reason(401, "unauthorized"), "unauthorized");
  assert.equal(reason(400, '{"detail":"period"}'), "bad_request");
  assert.equal(reason(500, "oops"), "server");
  assert.equal(reason(503, ""), "server");
  const failure = classifySearchTextsFailure(400, `{"detail":"${"x".repeat(500)}"}`);
  assert.ok(failure.kind === "bad_request" && failure.message.length <= 220, "в сообщение попадает обрезанный текст WB");
});

test("Сообщения экрана: 403 без Джема и 403 без категории токена — разные", () => {
  assert.notEqual(seoUnavailableMessage("no_jam"), seoUnavailableMessage("token_scope"));
  assert.match(seoUnavailableMessage("no_jam"), /Джем/);
  assert.match(seoUnavailableMessage("token_scope"), /Аналитика/);
  assert.match(seoFailureMessage({ kind: "rate_limit" }), /ночного замера/);
  assert.equal(seoFailureMessage({ kind: "server", message: "WB 500: x", status: 500 }), "WB 500");
});

test("isClosedDaySnapshot: старая ленивая строка скрыта, ночная показана, граница — полночь МСК", () => {
  // Старая: открыли карточку 04.10 днём, строка подписана 04.10.
  assert.equal(isClosedDaySnapshot({ snapshot_date: "2026-10-04", synced_at: "2026-10-04T12:00:00Z" }), false);
  // Ночная: день 04.10 замерили в 04:13 МСК 05.10.
  assert.equal(isClosedDaySnapshot({ snapshot_date: "2026-10-04", synced_at: "2026-10-05T01:13:00Z" }), true);
  // 23:59:59 МСК того же дня (20:59:59 UTC) — день ещё не закрыт; 00:00:00 МСК следующего — закрыт.
  assert.equal(isClosedDaySnapshot({ snapshot_date: "2026-10-04", synced_at: "2026-10-04T20:59:59Z" }), false);
  assert.equal(isClosedDaySnapshot({ snapshot_date: "2026-10-04", synced_at: "2026-10-04T21:00:00Z" }), true);
  // snapshot_date из PostgREST может прийти с временем; synced_at пустой или битый — строку не показываем.
  assert.equal(isClosedDaySnapshot({ snapshot_date: "2026-10-04T00:00:00", synced_at: "2026-10-05T01:13:00Z" }), true);
  assert.equal(isClosedDaySnapshot({ snapshot_date: "2026-10-04", synced_at: null }), false);
  assert.equal(isClosedDaySnapshot({ snapshot_date: "2026-10-04", synced_at: "не дата" }), false);
});

test("nextSeoBatch и looksTruncated", () => {
  const nm = [10, 20, 30, 40, 50];
  assert.deepEqual(nextSeoBatch(nm, 0, 2), [10, 20]);
  assert.deepEqual(nextSeoBatch(nm, 20, 2), [30, 40]);
  assert.deepEqual(nextSeoBatch(nm, 25, 10), [30, 40, 50], "курсор — значение, а не индекс: пропавшего nm 25 не жаль");
  assert.deepEqual(nextSeoBatch(nm, 50, 2), []);

  assert.equal(looksTruncated(50, 30, 30), true);
  assert.equal(looksTruncated(50, 31, 30), false);
  assert.equal(looksTruncated(50, 100, 30), false);
  assert.equal(looksTruncated(50, 12, 30), false);
  assert.equal(looksTruncated(1, 30, 30), false, "для одного артикула 30 строк — норма");
});

test("isSeoUnavailablePause: пауза держится 20 часов", () => {
  const saved = (status: string, minutesAgo: number) => ({
    status,
    state: { unavailableAt: new Date(NIGHT - minutesAgo * 60_000).toISOString() } as SeoPositionsState,
  });
  assert.equal(isSeoUnavailablePause(null, NIGHT), false);
  assert.equal(isSeoUnavailablePause(saved("unavailable", 60), NIGHT), true);
  assert.equal(isSeoUnavailablePause(saved("unavailable", 19 * 60), NIGHT), true);
  assert.equal(isSeoUnavailablePause(saved("unavailable", 21 * 60), NIGHT), false);
  assert.equal(isSeoUnavailablePause(saved("pending", 60), NIGHT), false);
  assert.equal(isSeoUnavailablePause({ status: "unavailable", state: {} }, NIGHT), false);
});

test("seoLivePlan: живой запрос ленивого роута — последнее средство, квота WB принадлежит ночному замеру", () => {
  assert.equal(seoLivePlan({ haveYesterday: true, measuredByNight: false, paused: false }), "have");
  assert.equal(seoLivePlan({ haveYesterday: false, measuredByNight: true, paused: false }), "measured", "ночной замер уже спрашивал WB про этот день");
  assert.equal(seoLivePlan({ haveYesterday: false, measuredByNight: false, paused: true }), "paused");
  assert.equal(seoLivePlan({ haveYesterday: false, measuredByNight: false, paused: false }), "live");
  assert.equal(seoLivePlan({ haveYesterday: true, measuredByNight: true, paused: true }), "have");
  // Вчера ночь измерила, а потом кабинет получил 403: на экране «нет запросов», а не ошибка про Джем.
  assert.equal(seoLivePlan({ haveYesterday: false, measuredByNight: true, paused: true }), "measured");
});

// ------------------------------------------------------------------ SKU кабинета

type Table = Record<string, unknown>[];
function fakeDb(tables: Record<string, Table>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => { rows = rows.filter((row) => row[column] === value); return builder; },
        gte: (column: string, value: string) => { rows = rows.filter((row) => String(row[column]) >= value); return builder; },
        or: (expression: string) => {
          const conditions = expression.split(",").map((part) => part.split("."));
          rows = rows.filter((row) => conditions.some(([column, operator, operand]) => operator === "gt" && Number(row[column]) > Number(operand)));
          return builder;
        },
        order: (column: string) => { rows.sort((left, right) => Number(left[column]) - Number(right[column])); return builder; },
        range: (from: number, to: number) => Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
      };
      return builder;
    },
  } as never;
}

const unscoped = { brandFilters: [], allowedNmIds: null };
const makeTarget = (cabinetId: string | null, name = cabinetId ?? "env", scope: SyncTarget["productScope"] = unscoped): SyncTarget => ({
  cabinetId,
  name,
  statsToken: `tok-${cabinetId}`,
  advertToken: "a",
  contentToken: "c",
  productScope: scope,
  statisticsSourceKey: "seller:1",
});

test("loadSeoNmIds: карточки + контур + SKU с трафиком, фильтр контура, по возрастанию; activeOnly — только трафик", async () => {
  const db = fakeDb({
    wb_cards: [{ cabinet_id: "c1", nm_id: 3 }, { cabinet_id: "c1", nm_id: 1 }, { cabinet_id: "c1", nm_id: 2 }, { cabinet_id: "c2", nm_id: 99 }],
    wb_cabinet_product_scope: [{ cabinet_id: "c1", nm_id: 2 }, { cabinet_id: "c1", nm_id: 9 }],
    wb_funnel_daily: [
      { cabinet_id: "c1", nm_id: 7, date: "2026-10-03", open_card: 5, add_to_cart: 0 },
      { cabinet_id: "c1", nm_id: 8, date: "2026-10-03", open_card: 0, add_to_cart: 0 },
      { cabinet_id: "c1", nm_id: 6, date: "2026-10-03", open_card: 0, add_to_cart: 2 },
      { cabinet_id: "c1", nm_id: 5, date: "2026-09-01", open_card: 40, add_to_cart: 9 },
    ],
  });
  assert.deepEqual(await loadSeoNmIds(db, makeTarget("c1"), false, NIGHT), [1, 2, 3, 6, 7, 9]);
  assert.deepEqual(await loadSeoNmIds(db, makeTarget("c1"), true, NIGHT), [6, 7]);
  const scoped = makeTarget("c1", "Оптима", { brandFilters: ["norvia"], allowedNmIds: [1, 7, 9] });
  assert.deepEqual(await loadSeoNmIds(db, scoped, false, NIGHT), [1, 7, 9], "чужие артикулы агентского кабинета не мерим");
  assert.deepEqual(await loadSeoNmIds(db, makeTarget(null), false, NIGHT), []);
});

// ------------------------------------------------------------------ runSeoPositionsGroup

const LATENCY_MS = 300;
type Req = { at: number; cabinet: string; nmIds: number[]; day: string; start: string; end: string; hasOffset: boolean };
type Responder = (req: Req, n: number) => Response;

const okResponse: Responder = (req) => Response.json({
  data: {
    items: req.nmIds.flatMap((nm) => [
      item(nm, "куртка женская", { medianPosition: { current: 5 + (nm % 7) } }),
      item(nm, "пуховик", { medianPosition: { current: 12 } }),
    ]),
    currency: "RUB",
  },
});

function createEnv(config: {
  nmIds: Record<string, number[]>;
  active?: Record<string, number[]>;
  respond?: Responder;
  claim?: (cabinetId: string) => boolean;
  upsertError?: () => string | null;
  fetchThrows?: boolean;
  /** Запрос зависает, пока не сработает сигнал таймаута. */
  hang?: boolean;
  /** Кабинеты, у которых чтение состояния падает (база не ответила). */
  readThrows?: string[];
  start?: number;
}) {
  let t = config.start ?? NIGHT;
  const requests: Req[] = [];
  const sleeps: number[] = [];
  const store = new Map<string, WbSyncState<SeoPositionsState>>();
  const written: SeoPositionRow[][] = [];
  const readIds: string[] = [];
  const claimIds: string[] = [];
  const nmIdCalls: Array<{ cabinet: string; activeOnly: boolean }> = [];
  const stateWrites: Array<{ cabinet: string; status: string; state: SeoPositionsState; attempts: number }> = [];
  const timeouts: number[] = [];

  let respond: Responder = config.respond ?? okResponse;
  const deps: SeoJobDeps = {
    readState: async (cabinetId) => {
      readIds.push(cabinetId);
      if (config.readThrows?.includes(cabinetId)) throw new Error("wb_sync_state: база не ответила");
      const row = store.get(cabinetId);
      return row ? structuredClone(row) : null;
    },
    writeState: async (cabinetId, values) => {
      const row: WbSyncState<SeoPositionsState> = {
        cursor: values.cursor ?? null,
        status: values.status ?? "pending",
        attempts: values.attempts ?? 0,
        lastError: values.lastError ?? null,
        state: structuredClone(values.state ?? {}),
        updatedAt: new Date(t).toISOString(),
      };
      store.set(cabinetId, row);
      stateWrites.push({ cabinet: cabinetId, status: row.status, state: structuredClone(row.state), attempts: row.attempts });
      return null;
    },
    claim: async (cabinetId) => {
      claimIds.push(cabinetId);
      if (config.claim && !config.claim(cabinetId)) return false;
      const current = store.get(cabinetId);
      // Как RPC claim_wb_sync_job: статус становится running, курсор и состояние остаются.
      store.set(cabinetId, { cursor: null, attempts: 0, lastError: null, state: {}, updatedAt: null, ...current, status: "running" });
      return true;
    },
    upsertRows: async (rows) => {
      const error = config.upsertError?.() ?? null;
      if (!error) written.push(rows);
      return error;
    },
    loadNmIds: async (target, activeOnly) => {
      nmIdCalls.push({ cabinet: target.cabinetId!, activeOnly });
      return activeOnly ? (config.active ?? config.nmIds)[target.cabinetId!] ?? [] : config.nmIds[target.cabinetId!] ?? [];
    },
    timeoutSignal: (ms) => {
      timeouts.push(ms);
      const controller = new AbortController();
      if (config.hang) queueMicrotask(() => controller.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError")));
      return controller.signal;
    },
    fetchImpl: async (_url, init) => {
      if (config.fetchThrows) throw new Error("fetch failed");
      if (config.hang) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        });
      }
      const headers = init?.headers as Record<string, string>;
      const body = JSON.parse(String(init?.body)) as {
        nmIds: number[];
        currentPeriod: { start: string; end: string };
        offset?: number;
      };
      const req: Req = {
        at: t,
        cabinet: headers.Authorization.replace("tok-", ""),
        nmIds: body.nmIds,
        day: body.currentPeriod.start,
        start: body.currentPeriod.start,
        end: body.currentPeriod.end,
        hasOffset: "offset" in body,
      };
      requests.push(req);
      t += LATENCY_MS;
      return respond(req, requests.length);
    },
    sleep: async (ms) => { sleeps.push(ms); t += ms; },
    now: () => t,
  };

  return {
    deps,
    requests,
    sleeps,
    store,
    written,
    readIds,
    claimIds,
    nmIdCalls,
    stateWrites,
    timeouts,
    clock: () => t,
    setRespond: (next: Responder) => { respond = next; },
    advance: (ms: number) => { t += ms; },
    run: (group: SyncTarget[], over: Partial<{ deadline: number; reserveMs: number; force: boolean }> = {}) =>
      runSeoPositionsGroup(group, deps, { deadline: t + 250_000, reserveMs: 8_000, force: false, ...over }),
    state: (cabinetId: string) => store.get(cabinetId)!,
  };
}

const range = (from: number, count: number) => Array.from({ length: count }, (_, index) => from + index);
const olderDays = (nowMs: number) => closedMoscowDates(30, nowMs).slice(0, 29);
const assertNoRunning = (env: ReturnType<typeof createEnv>) => {
  for (const [cabinet, row] of env.store) assert.notEqual(row.status, "running", `кабинет ${cabinet} остался в running`);
};

test("(a) Два пакета: вчера закрыт и попал в doneDays, статус caught_up, между запросами пауза не меньше 20,5 с", async () => {
  const env = createEnv({ nmIds: { c1: range(1001, 80) } });
  env.store.set("c1", { cursor: null, status: "caught_up", attempts: 0, lastError: null, updatedAt: null, state: { doneDays: olderDays(NIGHT) } });

  const [result] = await env.run([makeTarget("c1")]);

  assert.equal(result.status, "caught_up");
  assert.equal(result.requests, 2);
  assert.equal(result.yesterdayDone, true);
  assert.deepEqual(env.requests.map((req) => req.nmIds.length), [50, 30]);
  assert.deepEqual(env.requests[0].nmIds, range(1001, 50));
  assert.deepEqual(env.requests[1].nmIds, range(1051, 30));
  for (const req of env.requests) {
    assert.equal(req.start, YESTERDAY);
    assert.equal(req.end, YESTERDAY);
    assert.equal(req.hasOffset, false);
  }
  assert.ok(env.requests[1].at - env.requests[0].at >= SEO_REQUEST_SPACING_MS, "пауза между запросами продавца");
  assert.ok(env.sleeps.some((ms) => ms >= SEO_REQUEST_SPACING_MS - LATENCY_MS), "пауза выдержана сном, а не совпала случайно");

  const saved = env.state("c1");
  assert.equal(saved.status, "caught_up");
  assert.ok(saved.state.doneDays?.includes(YESTERDAY));
  assert.equal(saved.state.doneDays?.length, 30);
  assert.equal(saved.state.mode, "batch-confirmed", "больше 30 строк на пакет — limit считается на артикул");
  assert.equal(saved.attempts, 0);
  assert.equal(env.written.flat().length, 160);
  assert.ok(env.written.flat().every((row) => row.snapshot_date === YESTERDAY && row.cabinet_id === "c1"));
  assert.ok(env.written.flat().every((row) => isClosedDaySnapshot({ snapshot_date: row.snapshot_date, synced_at: row.synced_at })));
  assertNoRunning(env);
});

test("Без истории: вчера первым, затем назад по дню; недоделанная догрузка — pending, но не partial", async () => {
  const env = createEnv({ nmIds: { c1: range(1001, 80) } });
  const [result] = await env.run([makeTarget("c1")]);

  // 12 запросов за 250 с: по два на день, шесть дней.
  assert.equal(result.requests, 12);
  assert.deepEqual(env.requests.map((req) => req.day), [
    "2026-10-04", "2026-10-04", "2026-10-03", "2026-10-03", "2026-10-02", "2026-10-02",
    "2026-10-01", "2026-10-01", "2026-09-30", "2026-09-30", "2026-09-29", "2026-09-29",
  ]);
  assert.equal(result.status, "pending");
  assert.equal(result.yesterdayDone, true);
  assert.equal(env.state("c1").status, "pending");
  assert.equal(env.state("c1").state.doneDays?.length, 6);
  assert.equal(summarizeSeoRun([result]).status, "ok", "вчера закрыт — недоделанная история журнал не краснит");

  // Следующий прогон продолжает с курсора, а не с нуля.
  env.advance(30 * 60_000);
  const [next] = await env.run([makeTarget("c1")]);
  assert.equal(env.requests[12].day, "2026-09-28");
  assert.equal(next.status, "pending");
  assert.equal(env.state("c1").state.doneDays?.length, 12);
  assertNoRunning(env);
});

test("Продолжение с курсора: прерванный день не начинается с нуля", async () => {
  const env = createEnv({ nmIds: { c1: range(1001, 80) } });
  env.store.set("c1", {
    cursor: `${YESTERDAY}:1050`, status: "pending", attempts: 0, lastError: null, updatedAt: null,
    state: { day: YESTERDAY, afterNm: 1050, doneDays: olderDays(NIGHT), mode: "batch-confirmed" },
  });
  const [result] = await env.run([makeTarget("c1")]);
  assert.equal(env.requests.length, 1);
  assert.deepEqual(env.requests[0].nmIds, range(1051, 30));
  assert.equal(result.status, "caught_up");
});

test("(b) 429 без запаса времени: pending, курсор не сдвинут, второй кабинет продавца не тронут", async () => {
  const env = createEnv({
    nmIds: { c1: range(1001, 80), c2: range(2001, 10) },
    respond: () => new Response('{"title":"too many requests"}', { status: 429, headers: { "x-ratelimit-retry": "30" } }),
  });
  const results = await env.run([makeTarget("c2"), makeTarget("c1")], { deadline: NIGHT + 20_000 });

  assert.equal(env.requests.length, 1, "повтор после 429 не уложился в бюджет — запрос один");
  assert.deepEqual(env.sleeps, [], "в бюджет не вмещается — не спим");
  assert.deepEqual(results.map((result) => result.cabinetId), ["c1", "c2"], "кабинеты идут в порядке cabinetId");
  assert.equal(results[0].status, "pending");
  assert.equal(results[0].rateLimited, true);
  assert.equal(env.state("c1").status, "pending");
  assert.equal(env.state("c1").state.afterNm, 0, "курсор не сдвинут");
  assert.ok(env.state("c1").state.rateLimitedAt);
  assert.equal(env.state("c1").attempts, 0, "лимит — не ошибка");
  assert.equal(results[1].status, "pending");
  assert.equal(results[1].rateLimited, true);
  assert.ok(!env.claimIds.includes("c2"), "аренду на второй кабинет не брали");
  assert.equal(env.store.has("c2"), false);
  assert.equal(summarizeSeoRun(results).status, "partial", "вчера не закрыт — журнал partial, не ok");
  assertNoRunning(env);
});

test("429 с запасом времени: один повтор после паузы WB, и замер идёт дальше", async () => {
  let attempt = 0;
  const env = createEnv({
    nmIds: { c1: range(1001, 10) },
    respond: (req, n) => {
      attempt = n;
      return n === 1 ? new Response("", { status: 429, headers: { "x-ratelimit-retry": "21" } }) : okResponse(req, n);
    },
  });
  env.store.set("c1", { cursor: null, status: "caught_up", attempts: 0, lastError: null, updatedAt: null, state: { doneDays: olderDays(NIGHT) } });
  const [result] = await env.run([makeTarget("c1")]);
  assert.equal(attempt, 2);
  assert.deepEqual(env.sleeps, [21_000]);
  assert.equal(result.status, "caught_up");
});

test("(c) 403 «Джем»: unavailable, повторный прогон в пределах 20 часов не делает запросов, с force — один", async () => {
  const jam = () => new Response('{"detail":"Available only in a Jam subscription"}', { status: 403 });
  const env = createEnv({ nmIds: { c1: range(1001, 80) }, respond: jam });

  const [first] = await env.run([makeTarget("c1")]);
  assert.equal(env.requests.length, 1);
  assert.equal(first.status, "unavailable");
  assert.equal(first.reason, "no_jam");
  const saved = env.state("c1");
  assert.equal(saved.status, "unavailable");
  assert.equal(saved.state.reason, "no_jam");
  assert.ok(saved.state.unavailableAt);
  assert.match(saved.lastError ?? "", /Jam/);
  assert.equal(summarizeSeoRun([first]).status, "ok", "кабинет без Джема ошибкой прогона не считается");
  assert.equal(env.written.length, 0);

  env.advance(3 * HOUR);
  const claimsBefore = env.claimIds.length;
  const [paused] = await env.run([makeTarget("c1")]);
  assert.equal(env.requests.length, 1, "пауза: WB не трогаем");
  assert.equal(paused.status, "unavailable");
  assert.equal(paused.paused, true);
  assert.equal(env.claimIds.length, claimsBefore, "аренду на паузе не берём");
  assert.equal(env.state("c1").status, "unavailable", "состояние на паузе не меняется");

  const [forced] = await env.run([makeTarget("c1")], { force: true });
  assert.equal(env.requests.length, 2, "force обходит паузу");
  assert.equal(forced.status, "unavailable");

  // Через 21 час после последней пробы пауза кончилась; Джем подключили — замер пошёл, пауза снята.
  env.advance(SEO_UNAVAILABLE_COOLDOWN_MS + HOUR);
  env.setRespond(okResponse);
  const [recovered] = await env.run([makeTarget("c1")]);
  assert.equal(env.requests.length > 2, true, "после паузы кабинет снова пробуют");
  assert.notEqual(recovered.status, "unavailable");
  assert.equal(env.state("c1").state.unavailableAt, undefined);
  assert.equal(env.state("c1").state.reason, undefined);
  assertNoRunning(env);
});

test("403 «нет категории»: причина различается, остальные кабинеты группы продолжают", async () => {
  const env = createEnv({
    nmIds: { c1: range(1001, 5), c2: range(2001, 5) },
    respond: (req, n) => req.cabinet === "c1"
      ? new Response('{"detail":"scope is not allowed for this resource"}', { status: 403 })
      : okResponse(req, n),
  });
  const results = await env.run([makeTarget("c1"), makeTarget("c2")]);
  assert.equal(results[0].reason, "token_scope");
  assert.equal(results[0].status, "unavailable");
  assert.notEqual(results[1].status, "unavailable");
  assert.ok(env.requests.some((req) => req.cabinet === "c2"), "403 одного кабинета не останавливает соседа");
});

test("(d) Ровно 30 строк на пакет из 50: limit общий — режим single, курсор не сдвинут, пакет перемеряется по одному", async () => {
  const respond: Responder = (req, n) => req.nmIds.length > 1
    ? Response.json({ data: { items: range(0, 30).map((index) => item(req.nmIds[0], `запрос ${index}`)) } })
    : okResponse(req, n);
  const env = createEnv({ nmIds: { c1: range(1001, 80) }, active: { c1: [1001, 1002, 1003] }, respond });
  const [result] = await env.run([makeTarget("c1")]);

  assert.deepEqual(env.requests[0].nmIds, range(1001, 50), "сначала проба пакетом");
  assert.deepEqual(env.nmIdCalls, [{ cabinet: "c1", activeOnly: false }, { cabinet: "c1", activeOnly: true }]);
  // Состояние сразу после переключения: single и курсор на нуле.
  const afterSwitch = env.stateWrites.find((write) => write.state.mode === "single")!;
  assert.equal(afterSwitch.state.afterNm, 0);
  assert.equal(afterSwitch.state.day, YESTERDAY);
  // Дальше — по одному артикулу, с начала, только активные.
  assert.deepEqual(env.requests.slice(1).map((req) => req.nmIds), [[1001], [1002], [1003]]);
  assert.ok(env.requests.slice(1).every((req) => req.day === YESTERDAY), "в режиме single догрузки нет");
  // Обрезанный ответ пакета не записан: в таблице только полные ответы по одному артикулу.
  assert.ok(env.written.flat().every((row) => row.keyword === "куртка женская" || row.keyword === "пуховик"));
  assert.equal(env.written.flat().length, 6);
  assert.equal(result.status, "caught_up");
  assert.equal(env.state("c1").state.mode, "single");
  assert.ok(env.state("c1").state.doneDays?.includes(YESTERDAY));

  // На следующую ночь лимит проверяется заново: единственное совпадение не закрепляет дорогой режим.
  env.advance(24 * HOUR);
  const before = env.requests.length;
  await env.run([makeTarget("c1")]);
  assert.ok(env.requests[before].nmIds.length > 1, "новый день начинается пакетом");
  assertNoRunning(env);
});

test("Пакет меньше лимита не считается обрезанным; больше лимита — подтверждает «лимит на артикул»", async () => {
  const few: Responder = (req) => Response.json({ data: { items: req.nmIds.slice(0, 3).map((nm) => item(nm, "куртка")) } });
  const env = createEnv({ nmIds: { c1: range(1001, 50) }, respond: few });
  env.store.set("c1", { cursor: null, status: "caught_up", attempts: 0, lastError: null, updatedAt: null, state: { doneDays: olderDays(NIGHT) } });
  await env.run([makeTarget("c1")]);
  assert.equal(env.state("c1").state.mode, "batch", "3 строки на 50 артикулов — просто мало трафика");
  assert.equal(env.nmIdCalls.filter((call) => call.activeOnly).length, 0);
});

test("(e) Три ошибки 5xx подряд на одном месте: пакет становится дырой, прогон идёт дальше, день НЕ закрыт, дыра перепроверяется и закрывается", async () => {
  let failing = true;
  const env = createEnv({
    nmIds: { c1: range(1001, 80) },
    respond: (req, n) => failing && req.nmIds.includes(1001) ? new Response("bad gateway", { status: 502 }) : okResponse(req, n),
  });
  env.store.set("c1", { cursor: null, status: "caught_up", attempts: 0, lastError: null, updatedAt: null, state: { doneDays: olderDays(NIGHT) } });

  for (let run = 1; run < SEO_BATCH_MAX_ATTEMPTS; run += 1) {
    const [result] = await env.run([makeTarget("c1")]);
    assert.equal(result.status, "error");
    assert.equal(summarizeSeoRun([result]).status, "error");
    env.advance(30 * 60_000);
    assert.equal(env.state("c1").attempts, run);
    assert.equal(env.state("c1").state.afterNm, 0, "пока попытки не кончились, курсор стоит");
    assert.equal(env.state("c1").state.holes, undefined);
  }
  assert.equal(env.requests.length, 2);

  // Третья неудача: пакет — дыра дня, но прогон не встаёт: следующий пакет идёт сразу, а за ним и перепроверка дыры.
  const [stuck] = await env.run([makeTarget("c1")]);
  assert.deepEqual(env.requests.slice(2).map((req) => req.nmIds), [range(1001, 50), range(1051, 30), range(1001, 50)]);
  const hole = env.state("c1").state.holes?.[YESTERDAY]?.[0];
  assert.deepEqual([hole?.from, hole?.to, hole?.count, hole?.tries], [1001, 1050, 50, 1], "дыру уже перепроверили раз — и она не прошла");
  assert.ok(hole?.triedAt);
  assert.equal(env.state("c1").state.day, undefined, "проход закончен, курсора нет");
  assert.match(env.state("c1").lastError ?? "", /WB 502/, "диагноз остаётся в журнале, хотя прогон не error");
  assert.equal(stuck.yesterdayDone, false);
  assert.equal(stuck.skippedSku, 50);
  assert.equal(stuck.yesterdayHoles, 50);
  assert.equal(env.state("c1").state.doneDays?.includes(YESTERDAY), false, "день с дырой не в doneDays");
  const summary = summarizeSeoRun([stuck]);
  assert.equal(summary.status, "partial");
  assert.match(summary.note, /пропущено 50 арт/);
  assert.match(summary.logNote ?? "", /пропущено 50 арт/);
  assert.deepEqual(sortedUnique(env.written.flat()), range(1051, 30), "записан только измеренный пакет");

  // Дыру измерили — день закрылся честно: строки по всем 80 артикулам, журнал ok.
  failing = false;
  env.advance(30 * 60_000);
  const [healed] = await env.run([makeTarget("c1")]);
  assert.equal(healed.status, "caught_up");
  assert.equal(healed.yesterdayDone, true);
  assert.equal(healed.skippedSku, 0);
  assert.equal(env.state("c1").state.doneDays?.includes(YESTERDAY), true);
  assert.equal(env.state("c1").state.holes, undefined);
  assert.deepEqual(sortedUnique(env.written.flat()), range(1001, 80));
  assert.equal(summarizeSeoRun([healed]).status, "ok");
  assertNoRunning(env);
});

test("(f) Прогон не выходит за дедлайн: ни один запрос не стартует позже дедлайна минус запас", async () => {
  const env = createEnv({ nmIds: { c1: range(1001, 600), c2: range(5001, 92) } });
  const deadline = NIGHT + 250_000;
  const results = await env.run([makeTarget("c1"), makeTarget("c2")], { deadline, reserveMs: 8_000 });

  assert.ok(env.requests.length >= 10 && env.requests.length <= 12, `за 250 с на продавца 10–12 запросов, было ${env.requests.length}`);
  for (const req of env.requests) assert.ok(req.at < deadline - 8_000, "запрос стартует с запасом до дедлайна");
  assert.ok(env.clock() <= deadline, "прогон закончился до дедлайна");
  for (let index = 1; index < env.requests.length; index += 1) {
    assert.ok(env.requests[index].at - env.requests[index - 1].at >= SEO_REQUEST_SPACING_MS, "лимит продавца соблюдается и между кабинетами");
  }
  // 600 артикулов = 12 пакетов за вчера: c1 забрал все двенадцать запросов, на c2 времени не хватает.
  assert.equal(results[0].cabinetId, "c1");
  assert.equal(results[1].status, "budget");
  assert.equal(env.store.has("c2"), false, "до c2 не дошли: ни аренды, ни записи состояния");
  assertNoRunning(env);
});

test("Реальные размеры из расчёта (467 и 92 карточки одного продавца): вчера у обоих за один прогон, 10 + 2 запроса", async () => {
  const env = createEnv({ nmIds: { c1: range(1001, 467), c2: range(5001, 92) } });
  const results = await env.run([makeTarget("c1"), makeTarget("c2")]);
  assert.equal(env.requests.length, 12);
  assert.deepEqual(env.requests.map((req) => req.cabinet), [...Array(10).fill("c1"), "c2", "c2"]);
  assert.ok(env.requests.every((req) => req.day === YESTERDAY));
  assert.ok(results.every((result) => result.yesterdayDone));
  assert.equal(summarizeSeoRun(results).status, "ok");
});

test("Догрузка истории большого кабинета не отнимает квоту у вчерашнего дня следующих кабинетов того же продавца", async () => {
  const env = createEnv({ nmIds: { c1: range(1001, 100), c2: range(2001, 30) } });
  const [first, second] = await env.run([makeTarget("c1"), makeTarget("c2")]);

  // c1 идёт первым, но c2 ещё без вчерашнего дня: c1 меряет только вчера и уступает очередь.
  assert.ok(env.requests.filter((req) => req.cabinet === "c1").every((req) => req.day === YESTERDAY));
  assert.equal(env.requests.filter((req) => req.cabinet === "c1").length, 2);
  assert.equal(first.yesterdayDone, true);
  assert.equal(first.status, "pending", "история c1 ещё впереди");
  assert.deepEqual(env.state("c1").state.doneDays, [YESTERDAY]);
  // c2 — последний в очереди: вчера и затем догрузка на остаток времени.
  const c2Days = env.requests.filter((req) => req.cabinet === "c2").map((req) => req.day);
  assert.deepEqual(c2Days.slice(0, 2), ["2026-10-04", "2026-10-03"]);
  assert.equal(second.yesterdayDone, true);
  assert.equal(summarizeSeoRun([first, second]).status, "ok");

  // Следующий прогон: вчерашний день есть у обоих — c1 начинает догрузку.
  env.advance(30 * 60_000);
  const before = env.requests.length;
  await env.run([makeTarget("c1"), makeTarget("c2")]);
  assert.equal(env.requests[before].cabinet, "c1");
  assert.equal(env.requests[before].day, "2026-10-03", "после вчерашнего — день назад");
  assertNoRunning(env);
});

test("Кабинет без SKU и кабинет на паузе не держат очередь: соседи по продавцу догружают историю", async () => {
  const env = createEnv({ nmIds: { c1: range(1001, 10), c2: [] } });
  await env.run([makeTarget("c1"), makeTarget("c2")]);
  // Первый прогон: у c2 ещё нет состояния, c1 меряет только вчера.
  assert.ok(env.requests.every((req) => req.day === YESTERDAY));
  assert.equal(env.state("c2").state.totalSku, 0);

  env.advance(30 * 60_000);
  const before = env.requests.length;
  await env.run([makeTarget("c1"), makeTarget("c2")]);
  assert.ok(env.requests.length > before + 1, "c1 пошёл в историю, не дожидаясь кабинета без SKU");
  assert.equal(env.requests[before].day, "2026-10-03");

  const paused = createEnv({ nmIds: { c1: range(1001, 10), c2: range(2001, 10) } });
  paused.store.set("c2", {
    cursor: null, status: "unavailable", attempts: 0, lastError: "WB 403", updatedAt: null,
    state: { unavailableAt: new Date(NIGHT - HOUR).toISOString(), reason: "no_jam" },
  });
  paused.store.set("c1", { cursor: null, status: "caught_up", attempts: 0, lastError: null, updatedAt: null, state: { doneDays: [YESTERDAY] } });
  await paused.run([makeTarget("c1"), makeTarget("c2")]);
  assert.ok(paused.requests.length > 1 && paused.requests.every((req) => req.cabinet === "c1" && req.day !== YESTERDAY),
    "c2 на паузе после 403 — c1 не ждёт его вчерашнего дня");
});

test("Занятый кабинет (аренду держит другой прогон): запросов и записи нет", async () => {
  const env = createEnv({ nmIds: { c1: range(1001, 10) }, claim: () => false });
  const [result] = await env.run([makeTarget("c1")]);
  assert.equal(result.status, "busy");
  assert.equal(env.requests.length, 0);
  assert.equal(env.stateWrites.length, 0);
});

test("Кабинет без SKU: мерить нечего, дни в doneDays не кладутся (история потом догрузится)", async () => {
  const env = createEnv({ nmIds: { c1: [] } });
  const [result] = await env.run([makeTarget("c1")]);
  assert.equal(result.status, "caught_up");
  assert.equal(result.yesterdayDone, true);
  assert.equal(env.requests.length, 0);
  assert.deepEqual(env.state("c1").state.doneDays, []);
  assert.equal(env.state("c1").state.totalSku, 0);
  assertNoRunning(env);
});

test("Кабинеты одного продавца: артикул, уже взятый предыдущим кабинетом, не мерится второй раз", async () => {
  const env = createEnv({ nmIds: { c1: [1, 2, 3], c2: [3, 4] } });
  for (const id of ["c1", "c2"]) {
    env.store.set(id, { cursor: null, status: "caught_up", attempts: 0, lastError: null, updatedAt: null, state: { doneDays: olderDays(NIGHT) } });
  }
  await env.run([makeTarget("c2"), makeTarget("c1")]);
  const asked = env.requests.filter((req) => req.day === YESTERDAY).flatMap((req) => req.nmIds);
  assert.deepEqual(asked.sort((a, b) => a - b), [1, 2, 3, 4], "nm=3 запрошен один раз");
  assert.deepEqual(env.requests.find((req) => req.cabinet === "c2" && req.day === YESTERDAY)?.nmIds, [4]);
});

test("Кабинет env (без cabinet_id) пропускается: негде хранить курсор", async () => {
  const env = createEnv({ nmIds: {} });
  const results = await env.run([makeTarget(null)]);
  assert.deepEqual(results, []);
  assert.equal(env.requests.length, 0);
});

test("Сбои: исключение запроса, ошибка записи строк, непонятный ответ — error, курсор стоит, running не остаётся", async () => {
  const thrown = createEnv({ nmIds: { c1: range(1, 5) }, fetchThrows: true });
  const [fetchFailed] = await thrown.run([makeTarget("c1")]);
  assert.equal(fetchFailed.status, "error");
  assert.equal(thrown.state("c1").attempts, 1);
  assert.match(thrown.state("c1").lastError ?? "", /fetch failed/);
  assertNoRunning(thrown);

  const writeFails = createEnv({ nmIds: { c1: range(1, 5) }, upsertError: () => "boom" });
  const [writeFailed] = await writeFails.run([makeTarget("c1")]);
  assert.equal(writeFailed.status, "error");
  assert.equal(writeFails.state("c1").state.afterNm, 0, "курсор двигается только после записи");
  assert.match(writeFails.state("c1").lastError ?? "", /boom/);
  assert.equal(writeFails.state("c1").state.doneDays?.includes(YESTERDAY) ?? false, false);
  assertNoRunning(writeFails);

  // WB ответил 200, но разобрать нечего: нельзя молча считать день «пустым».
  const garbage = createEnv({
    nmIds: { c1: range(1, 5) },
    respond: () => Response.json({ data: { items: [{ unexpected: true }, { shape: 1 }] } }),
  });
  const [garbageResult] = await garbage.run([makeTarget("c1")]);
  assert.equal(garbageResult.status, "error");
  assert.match(garbage.state("c1").lastError ?? "", /не разобрано/);
  assert.equal(garbage.state("c1").state.doneDays?.includes(YESTERDAY) ?? false, false);

  const noItems = createEnv({ nmIds: { c1: range(1, 5) }, respond: () => Response.json({ data: {} }) });
  const [noItemsResult] = await noItems.run([makeTarget("c1")]);
  assert.equal(noItemsResult.status, "error");
  assert.match(noItems.state("c1").lastError ?? "", /data\.items/);

  // Пустой, но корректный ответ (нет ни одного запроса с позицией за день) — это честный пустой день.
  // Допустим, только если живых артикулов (с трафиком) нет: иначе пустой день — симптом (см. тест про 0 строк).
  const quiet = createEnv({ nmIds: { c1: range(1, 5) }, active: { c1: [] }, respond: () => Response.json({ data: { items: [] } }) });
  quiet.store.set("c1", { cursor: null, status: "caught_up", attempts: 0, lastError: null, updatedAt: null, state: { doneDays: olderDays(NIGHT) } });
  const [quietResult] = await quiet.run([makeTarget("c1")]);
  assert.equal(quietResult.status, "caught_up");
  assert.equal(quiet.written.length, 0);
});

test("summarizeSeoRun: ok / partial / error", () => {
  const base: SeoGroupResult = {
    cabinetId: "c", cabinet: "Кабинет", status: "caught_up", yesterday: YESTERDAY, yesterdayDone: true,
    day: YESTERDAY, mode: "batch", requests: 2, rows: 100, skippedSku: 0,
  };
  assert.equal(summarizeSeoRun([base]).status, "ok");
  assert.equal(summarizeSeoRun([base, { ...base, status: "pending", yesterdayDone: false }]).status, "partial");
  assert.equal(summarizeSeoRun([base, { ...base, status: "unavailable", yesterdayDone: false }]).status, "ok");
  assert.equal(summarizeSeoRun([{ ...base, status: "error", yesterdayDone: false, message: "WB 500" }, base]).status, "error");
  const summary = summarizeSeoRun([base, { ...base, cabinet: "Второй", rows: 5, skippedSku: 50 }]);
  assert.equal(summary.rows, 105);
  assert.match(summary.note, /Второй/);
  assert.match(summary.note, /пропущено 50/);
});

// ====================================================================== v2: правки по двум независимым ревью

const stateOf = (doneDays: string[], extra: Partial<SeoPositionsState> = {}): WbSyncState<SeoPositionsState> => ({
  cursor: null, status: "caught_up", attempts: 0, lastError: null, updatedAt: null, state: { doneDays, ...extra },
});
const goToNight = (env: ReturnType<typeof createEnv>, night: number) => env.advance(NIGHT + night * 24 * HOUR - env.clock());
const sortedUnique = (rows: SeoPositionRow[]) => [...new Set(rows.map((row) => row.nm_id))].sort((a, b) => a - b);

// ------------------------------------------------------------------ 1.1 / 2.4: дыры

test("(e2) Дыра, которая не проходит несколько ночей: день не закрывается молча, после SEO_HOLE_MAX_NIGHTS ночей — отказ с записью в журнал", async () => {
  const OLD_DAY = YESTERDAY; // ночью 0 это вчера, дальше — старый день с дырой
  const POISON = 1001; // на этом артикуле WB отвечает 502 всегда
  const env = createEnv({
    nmIds: { c1: range(1001, 80) },
    respond: (req, n) => req.day === OLD_DAY && req.nmIds.includes(POISON) ? new Response("bad gateway", { status: 502 }) : okResponse(req, n),
  });
  env.store.set("c1", stateOf(olderDays(NIGHT)));

  for (let run = 0; run < 4; run += 1) {
    await env.run([makeTarget("c1")]);
    env.advance(30 * 60_000);
  }
  assert.ok(env.state("c1").state.partial?.[OLD_DAY], "после трёх неудач и прохода остатка день ждёт перепроверки дыры");

  // Ночи 1 и 2: свежий день измеряется нормально, дыра старого дня перепроверяется раньше любой догрузки и снова не проходит.
  for (const night of [1, 2]) {
    goToNight(env, night);
    const [result] = await env.run([makeTarget("c1")]);
    assert.equal(result.yesterdayDone, true, "новый вчерашний день закрыт");
    assert.ok(result.skippedSku >= 1 && result.skippedSku <= 50, `пропущенные артикулы старого дня остаются видны: ${result.skippedSku}`);
    const summary = summarizeSeoRun([result]);
    assert.equal(summary.status, "ok", "дыра СТАРОГО дня журнал не краснит…");
    assert.match(summary.logNote ?? "", /пропущено \d+ арт/, "…но в журнале о ней сказано");
    assert.equal(env.state("c1").state.doneDays?.includes(OLD_DAY), false, "день с дырой не закрыт");
  }
  assert.equal(env.state("c1").state.partial?.[OLD_DAY]?.length, 3, "три ночи перепроверки засчитаны");
  assert.equal(SEO_HOLE_MAX_NIGHTS, 3);
  const remaining = env.state("c1").state.holes?.[OLD_DAY] ?? [];
  assert.equal(remaining.length, 1);
  assert.ok(remaining[0].from === POISON && remaining[0].count < 50, `5xx на одном артикуле сужает дыру (делим пополам со второй неудачи): ${remaining[0].count} арт.`);

  // Ночь 3: ночей набралось достаточно, но дыра ещё не одиночная — её делят пополам, по одному делению в ночь.
  // Отказа нет: он отрезал бы здоровых соседей плохого артикула, которых перепроверка ещё получит.
  goToNight(env, 3);
  const [narrowing] = await env.run([makeTarget("c1")]);
  assert.equal(narrowing.abandonedSku, undefined, "пока дыра шире одного артикула, отказа нет");
  assert.equal(env.state("c1").state.doneDays?.includes(OLD_DAY), false);
  assert.ok((env.state("c1").state.holes?.[OLD_DAY]?.[0]?.count ?? 99) < remaining[0].count, "перепроверка продолжается и сужает дыру");

  // Дальше ночь за ночью дыра сходится к одному артикулу; отказ — только от него, когда его уже спросили.
  let gaveUp: SeoGroupResult | undefined;
  for (let night = 4; night < 14 && !gaveUp; night += 1) {
    goToNight(env, night);
    const [result] = await env.run([makeTarget("c1")]);
    if (result.abandonedSku) gaveUp = result;
    else assert.equal(env.state("c1").state.doneDays?.includes(OLD_DAY), false, `ночь ${night}: без отказа день остаётся открытым`);
  }
  assert.ok(gaveUp, "дыра сошлась к одному артикулу, и отказ состоялся");
  assert.equal(gaveUp.abandonedSku, 1, "отказ — от самого плохого артикула, а не от пакета");
  assert.equal(env.state("c1").state.doneDays?.includes(OLD_DAY), true, "после отказа день закрыт");
  const finalHole = env.state("c1").state.holes?.[OLD_DAY] ?? [];
  assert.deepEqual(finalHole.map((hole) => [hole.from, hole.to, hole.count]), [[POISON, POISON, 1]]);
  assert.ok(finalHole[0].triedAt, "отказ — после того, как артикул спросили");
  const summary = summarizeSeoRun([gaveUp]);
  assert.equal(summary.status, "partial", "в этот прогон журнал говорит об отказе");
  assert.match(summary.note, /отказ от 1 арт/);
  assert.match(gaveUp.message ?? "", /отказались от 1 арт/);
  assert.deepEqual(
    sortedUnique(env.written.flat().filter((row) => row.snapshot_date === OLD_DAY)),
    range(1002, 79),
    "здоровые соседи плохого артикула все измерены: отказ стоил одного артикула, а не пакета",
  );

  // Ленивый роут: артикул отказа можно спросить у WB самим, остальные ночь измерила.
  const finalState = env.state("c1").state;
  assert.equal(seoMeasuredByNight(finalState, OLD_DAY, POISON), false);
  assert.equal(seoMeasuredByNight(finalState, OLD_DAY, 1002), true, "соседи плохого артикула измерены");
  assert.equal(seoMeasuredByNight(finalState, OLD_DAY, 1050), true, "половины пакета без плохого артикула измерены");
  assert.equal(seoMeasuredByNight(finalState, OLD_DAY, 1060), true);

  env.advance(30 * 60_000);
  const [after] = await env.run([makeTarget("c1")]);
  assert.equal(summarizeSeoRun([after]).status, "ok", "отказ записан один раз, дальше журнал спокоен");
  assertNoRunning(env);
});

test("(e3) 400 на пакет: дыра сразу, деление пополам в ТОМ ЖЕ прогоне — пропадает один артикул, а не пятьдесят", async () => {
  const BAD_NM = 1020;
  const env = createEnv({
    nmIds: { c1: range(1001, 80) },
    respond: (req, n) => req.nmIds.includes(BAD_NM) ? new Response('{"detail":"bad nmId"}', { status: 400 }) : okResponse(req, n),
  });
  env.store.set("c1", stateOf(olderDays(NIGHT)));

  // Один прогон: детерминированный 400 не повторяют по прогонам (три прогона — полтора часа ночи впустую).
  const [first] = await env.run([makeTarget("c1")]);
  const wholeBatch = () => env.requests.filter((req) => req.nmIds.length === 50 && req.nmIds[0] === 1001).length;
  assert.equal(wholeBatch(), 1, "пакет с 400 спрошен один раз");
  assert.equal(env.requests.length, 2 + SEO_HOLE_REQUESTS_YESTERDAY, "пакет, остаток прохода и деление пополам — всё в первом прогоне, до потолка на дыры");
  assert.equal(summarizeSeoRun([first]).status, "partial", "день с дырой — partial");
  assert.ok(env.written.flat().length > 0);

  // Поиск плохого артикула сходится за считанные прогоны, а не за три прогона на каждый уровень.
  let runs = 1;
  while ((env.state("c1").state.holes?.[YESTERDAY] ?? []).some((hole) => hole.count > 1) && runs < 6) {
    env.advance(30 * 60_000);
    await env.run([makeTarget("c1")]);
    runs += 1;
  }
  assert.ok(runs <= 3, `деление до одного артикула: ${runs} прогонов`);
  const holes = env.state("c1").state.holes?.[YESTERDAY] ?? [];
  assert.deepEqual(holes.map((hole) => [hole.from, hole.to, hole.count]), [[BAD_NM, BAD_NM, 1]], "остался один плохой артикул");
  assert.ok(holes[0].tries >= 1, "плохой артикул уже спрашивали и получили отказ");
  assert.deepEqual(sortedUnique(env.written.flat()), range(1001, 80).filter((nm) => nm !== BAD_NM), "измерены все, кроме одного плохого артикула");
  assert.equal(wholeBatch(), 1, "целиком пакет больше не спрашивался");
  assert.equal(env.state("c1").state.doneDays?.includes(YESTERDAY), false);
  const [last] = await env.run([makeTarget("c1")]);
  const summary = summarizeSeoRun([last]);
  assert.equal(summary.status, "partial");
  assert.match(summary.note, /пропущено 1 арт/);
  assertNoRunning(env);
});

test("seoUnresolvedHoleCount и holeCovers: дыры закрытого дня не считаются пропуском, но артикул в них спрашивается заново", () => {
  const state: SeoPositionsState = {
    doneDays: ["2026-10-03"],
    holes: {
      "2026-10-03": [{ from: 5, to: 9, count: 3, tries: 0 }],
      "2026-10-04": [{ from: 1, to: 2, count: 2, tries: 2 }, { from: 7, to: 7, count: 1, tries: 2 }],
    },
  };
  assert.equal(seoUnresolvedHoleCount(state), 3);
  assert.equal(seoUnresolvedHoleCount(state, "2026-10-04"), 3);
  assert.equal(seoUnresolvedHoleCount(state, "2026-10-03"), 0);
  assert.equal(holeCovers(state.holes?.["2026-10-04"], 7), true);
  assert.equal(holeCovers(state.holes?.["2026-10-04"], 3), false);
  assert.equal(holeCovers(undefined, 3), false);
});

test("summarizeSeoRun: дыры вчерашнего дня — partial, число пропущенных артикулов всегда в сводке", () => {
  const base: SeoGroupResult = {
    cabinetId: "c", cabinet: "Кабинет", status: "caught_up", yesterday: YESTERDAY, yesterdayDone: true,
    day: YESTERDAY, mode: "batch", requests: 2, rows: 100, skippedSku: 0,
  };
  assert.equal(summarizeSeoRun([{ ...base, yesterdayHoles: 3, skippedSku: 3 }]).status, "partial");
  assert.equal(summarizeSeoRun([{ ...base, abandonedSku: 4 }]).status, "partial");
  const withSkipped = summarizeSeoRun([{ ...base, skippedSku: 7 }]);
  assert.equal(withSkipped.status, "ok", "дыры старого дня журнал не краснят");
  assert.match(withSkipped.note, /пропущено 7 арт/);
  assert.match(withSkipped.logNote ?? "", /пропущено 7 арт/, "в sync_log при ok тоже");
  assert.equal(summarizeSeoRun([base]).logNote, null, "чистый ok остаётся чистым");
});

test("Дыра, в диапазон которой добавились карточки: пакеты к WB по-прежнему не больше 50 артикулов", async () => {
  const env = createEnv({ nmIds: { c1: range(1001, 100) } });
  env.store.set("c1", stateOf(olderDays(NIGHT), {
    totalSku: 100,
    partial: { [YESTERDAY]: [] },
    holes: { [YESTERDAY]: [{ from: 1001, to: 1100, count: 50, tries: 0 }] },
  }));
  const [result] = await env.run([makeTarget("c1")]);
  assert.ok(env.requests.length >= 2);
  assert.ok(env.requests.every((req) => req.nmIds.length <= 50), "WB принимает до 50 артикулов");
  assert.deepEqual(sortedUnique(env.written.flat()), range(1001, 100));
  assert.equal(result.status, "caught_up");
  assert.equal(env.state("c1").state.doneDays?.includes(YESTERDAY), true);
});

test("Кабинет, у которого раньше не было SKU, получил карточки: «вчера закрыт» не тянется со старого состояния", async () => {
  const env = createEnv({
    nmIds: { c1: range(1001, 80) },
    respond: () => new Response("", { status: 429, headers: { "x-ratelimit-retry": "30" } }),
  });
  env.store.set("c1", stateOf([], { totalSku: 0 }));
  const [result] = await env.run([makeTarget("c1")], { deadline: NIGHT + 20_000 });
  assert.equal(result.rateLimited, true);
  assert.equal(result.yesterdayDone, false);
  assert.equal(env.state("c1").state.totalSku, 80);
  assert.equal(summarizeSeoRun([result]).status, "partial");
});

// ------------------------------------------------------------------ 1.2: пустой день

test("(g) WB вернул пустые items на весь день при живых артикулах: день НЕ закрыт, partial с причиной, ?remeasure чинит", async () => {
  const env = createEnv({ nmIds: { c1: range(1001, 120) }, respond: () => Response.json({ data: { items: [] } }) });
  env.store.set("c1", stateOf(olderDays(NIGHT)));

  const summaries: ReturnType<typeof summarizeSeoRun>[] = [];
  for (let run = 0; run < 8; run += 1) {
    const [result] = await env.run([makeTarget("c1")]);
    summaries.push(summarizeSeoRun([result]));
    env.advance(30 * 60_000);
  }
  // Пакеты 50/50/20 спрошены один раз, дальше отложенный день проверяет ОДИН запрос (первые 50 живых артикулов)
  // и не чаще раза в SEO_EMPTY_PROBE_EVERY_MS: прогоны идут раз в 30 минут, проба — через прогон.
  const probes = env.requests.slice(3);
  assert.ok(probes.length >= 1 && probes.length <= 4, `проб за ночь: ${probes.length}`);
  for (const probe of probes) assert.deepEqual(probe.nmIds, range(1001, 50));
  for (let index = 1; index < probes.length; index += 1) assert.ok(probes[index].at - probes[index - 1].at >= SEO_EMPTY_PROBE_EVERY_MS, "проба не чаще заданного интервала");
  const saved = env.state("c1").state;
  assert.equal(saved.doneDays?.includes(YESTERDAY), false, "день с нулём строк не закрыт");
  assert.match(saved.emptyDays?.[YESTERDAY] ?? "", /^2026-10-05T/, "время последней проверки отложенного дня");
  assert.equal(env.written.length, 0);
  for (const summary of summaries) {
    assert.equal(summary.status, "partial", "журнал не зелёный ни в одном прогоне ночи");
    assert.match(summary.note, /WB не вернул запросов за весь день/);
  }

  // Диагноз поставлен, WB отвечает как надо: сброс одного дня — и день измеряется заново.
  env.store.set("c1", { ...env.state("c1"), state: resetSeoState(saved, YESTERDAY) });
  assert.equal(env.state("c1").state.emptyDays, undefined);
  env.setRespond(okResponse);
  const before = env.requests.length;
  const [fixed] = await env.run([makeTarget("c1")]);
  assert.equal(env.requests.length - before, 3, "день измерен заново пакетами 50/50/20, без пробы");
  assert.ok(env.requests.slice(before).every((req) => req.day === YESTERDAY));
  assert.equal(fixed.yesterdayDone, true);
  assert.equal(env.state("c1").state.doneDays?.includes(YESTERDAY), true);
  assert.ok(env.written.flat().length > 0);
  assert.equal(summarizeSeoRun([fixed]).status, "ok");
});

test("Пустой день без живых артикулов (карточки есть, трафика нет) — честный пустой день, закрывается", async () => {
  const env = createEnv({ nmIds: { c1: range(1001, 20) }, active: { c1: [] }, respond: () => Response.json({ data: { items: [] } }) });
  env.store.set("c1", stateOf(olderDays(NIGHT)));
  const [result] = await env.run([makeTarget("c1")]);
  assert.equal(result.status, "caught_up");
  assert.equal(env.state("c1").state.doneDays?.includes(YESTERDAY), true);
});

test("resetSeoState: один день или всё окно; пауза после 403 не сбрасывается", () => {
  const state: SeoPositionsState = {
    doneDays: ["2026-10-02", "2026-10-03", "2026-10-04"],
    day: "2026-10-04", afterNm: 50, dayRowsByDay: { "2026-10-03": 4, "2026-10-04": 0 }, mode: "single", rotation: 77,
    holes: { "2026-10-03": [{ from: 1, to: 1, count: 1, tries: 0 }] },
    partial: { "2026-10-03": ["2026-10-05"] },
    emptyDays: { "2026-10-04": "2026-10-05" },
    unavailableAt: "2026-10-05T01:00:00.000Z", reason: "no_jam",
  };
  const one = resetSeoState(state, "2026-10-04");
  assert.deepEqual(one.doneDays, ["2026-10-02", "2026-10-03"]);
  assert.equal(one.emptyDays, undefined);
  assert.equal(one.day, undefined, "курсор сброшенного дня уходит");
  assert.deepEqual(one.dayRowsByDay, { "2026-10-03": 4 }, "счётчик строк сброшенного дня уходит, чужой остаётся");
  assert.ok(one.holes?.["2026-10-03"], "чужие дни не тронуты");
  const all = resetSeoState(state, null);
  assert.deepEqual(all.doneDays, []);
  assert.equal(all.holes, undefined);
  assert.equal(all.partial, undefined);
  assert.equal(all.rotation, undefined);
  assert.equal(all.dayRowsByDay, undefined);
  assert.equal(all.unavailableAt, "2026-10-05T01:00:00.000Z");
  assert.equal(state.doneDays?.length, 3, "исходное состояние не изменено");
});

// ------------------------------------------------------------------ 1.3: Джем на 400 и 402–404

test("classifySearchTextsFailure: текст про Джем узнаётся и на 400, 402, 404 — не только на 403", () => {
  const jam = '{"detail":"Available only in a Jam subscription"}';
  for (const status of [400, 402, 403, 404]) {
    const failure = classifySearchTextsFailure(status, jam);
    assert.equal(failure.kind, "unavailable", `статус ${status}`);
    assert.equal(failure.kind === "unavailable" && failure.reason, "no_jam", `статус ${status}`);
  }
  assert.equal(classifySearchTextsFailure(400, "Нужна подписка Джем").kind, "unavailable");
  assert.equal(classifySearchTextsFailure(400, '{"detail":"period is wrong"}').kind, "bad_request", "400 без Джема — по-прежнему плохой запрос");
  assert.equal(classifySearchTextsFailure(404, "not found").kind, "bad_request");
  assert.equal(classifySearchTextsFailure(500, jam).kind, "server", "5xx не бывает «нет Джема»");
});

test("(c2) Кабинет без Джема, который отвечает 400: пауза и одна проба, а не ошибка и пропуск пакетов", async () => {
  const env = createEnv({
    nmIds: { c1: range(1001, 80) },
    respond: () => new Response('{"detail":"Jam subscription required"}', { status: 400 }),
  });
  const [first] = await env.run([makeTarget("c1")]);
  assert.equal(first.status, "unavailable");
  assert.equal(first.reason, "no_jam");
  assert.equal(env.requests.length, 1);
  env.advance(30 * 60_000);
  await env.run([makeTarget("c1")]);
  assert.equal(env.requests.length, 1, "пауза работает, WB не трогаем");
  assert.equal(env.state("c1").state.holes, undefined, "пакеты не пропускались");
});

// ------------------------------------------------------------------ 1.4 / 2.2: лимит не портит статус соседей

test("429: остальные кабинеты группы сохраняют настоящий статус — вчера закрыт, пауза после 403 остаётся", async () => {
  const env = createEnv({
    nmIds: { c1: range(1001, 80), c2: range(2001, 10), c3: range(3001, 10) },
    respond: () => new Response("", { status: 429, headers: { "x-ratelimit-retry": "30" } }),
  });
  env.store.set("c1", stateOf([YESTERDAY])); // вчера есть, начинает историю — и упирается в лимит
  env.store.set("c2", stateOf([YESTERDAY, ...olderDays(NIGHT)]));
  env.store.set("c3", {
    cursor: null, status: "unavailable", attempts: 0, lastError: "WB 403: Jam", updatedAt: null,
    state: { unavailableAt: new Date(NIGHT - HOUR).toISOString(), reason: "no_jam" },
  });
  const results = await env.run([makeTarget("c1"), makeTarget("c2"), makeTarget("c3")], { deadline: NIGHT + 20_000 });

  assert.equal(results[0].rateLimited, true);
  assert.equal(results[1].status, "pending");
  assert.equal(results[1].rateLimited, true);
  assert.equal(results[1].yesterdayDone, true, "у c2 вчера закрыт — лимит этого не отменяет");
  assert.equal(results[2].status, "unavailable", "c3 на паузе после 403 остаётся на паузе");
  assert.equal(results[2].paused, true);
  assert.equal(results[2].reason, "no_jam");
  assert.equal(summarizeSeoRun(results).status, "ok", "журнал не винит кабинеты, у которых всё в порядке");
});

// ------------------------------------------------------------------ 1.6: переход в single не закрывает день пустым

test("(d2) Ровно 30 строк на пакет, а артикулов с трафиком нет: в single переходить некуда — ответ принят, день не закрыт с нулём строк", async () => {
  const respond: Responder = (req) => Response.json({ data: { items: range(0, 30).map((index) => item(req.nmIds[0], `запрос ${index}`)) } });
  const env = createEnv({ nmIds: { c1: range(1001, 18) }, active: { c1: [] }, respond });
  env.store.set("c1", stateOf(olderDays(NIGHT)));
  const [result] = await env.run([makeTarget("c1")]);

  assert.equal(result.rows, 30, "строки пакета записаны, а не выброшены вместе с днём");
  assert.equal(env.written.flat().length, 30);
  assert.equal(result.mode, "batch", "в single не уходим: список активных пуст");
  assert.match(result.message ?? "", /ровно 30 строк/);
  assert.equal(env.requests.length, 1);
  assert.deepEqual(env.nmIdCalls, [{ cabinet: "c1", activeOnly: false }, { cabinet: "c1", activeOnly: true }]);
});

// ------------------------------------------------------------------ 1.7: ошибка чтения состояния

test("Ошибка чтения wb_sync_state: кабинет — error и пропущен, состояние не затирается, соседи работают", async () => {
  const env = createEnv({ nmIds: { c1: range(1001, 10), c2: range(2001, 10) }, readThrows: ["c1"] });
  const results = await env.run([makeTarget("c1"), makeTarget("c2")]);
  assert.equal(results[0].cabinetId, "c1");
  assert.equal(results[0].status, "error");
  assert.match(results[0].message ?? "", /состояние: .*база не ответила/);
  assert.ok(!env.claimIds.includes("c1"), "аренда не берётся");
  assert.equal(env.store.has("c1"), false, "состояние кабинета не записано поверх");
  assert.ok(env.requests.every((req) => req.cabinet === "c2"));
  assert.notEqual(results[1].status, "error");
  assert.equal(summarizeSeoRun(results).status, "error");
});

test("readWbSyncStateOrThrow: ошибка базы бросается, «строки нет» — null; старый readWbSyncState по-прежнему глотает ошибку", async () => {
  const fake = (answer: { data: unknown; error: { message: string } | null }) => ({
    from: () => {
      const builder = { select: () => builder, eq: () => builder, maybeSingle: async () => answer };
      return builder;
    },
  }) as never;
  await assert.rejects(readWbSyncStateOrThrow(fake({ data: null, error: { message: "timeout" } }), "c1", "seo-positions"), /timeout/);
  assert.equal(await readWbSyncStateOrThrow(fake({ data: null, error: null }), "c1", "seo-positions"), null);
  assert.equal(await readWbSyncState(fake({ data: null, error: { message: "timeout" } }), "c1", "seo-positions"), null);
  const row = await readWbSyncStateOrThrow<SeoPositionsState>(fake({
    data: { cursor: "x", status: "pending", attempts: 2, last_error: null, state: { doneDays: ["d"] }, updated_at: "t" },
    error: null,
  }), "c1", "seo-positions");
  assert.deepEqual(row?.state.doneDays, ["d"]);
  assert.equal(row?.attempts, 2);
});

// ------------------------------------------------------------------ 1.9: таймаут запроса и зависшая группа

test("seoRequestTimeoutMs: не больше минуты, а запас за концом бюджета меньше отсечки группы — обрыв раньше, чем группу бросят", () => {
  assert.equal(seoRequestTimeoutMs(1_000_000 + 250_000, 1_000_000), 60_000);
  assert.equal(seoRequestTimeoutMs(1_000_000 + 12_000, 1_000_000), 12_000 + SEO_REQUEST_OVERRUN_MS);
  assert.equal(seoRequestTimeoutMs(1_000_000, 1_000_000 + 30_000), 1_000, "не меньше секунды");
  assert.ok(SEO_REQUEST_OVERRUN_MS < SEO_GROUP_CUTOFF_AFTER_DEADLINE_MS, "запас запроса короче отсечки группы");
  // Запрос стартует не позже deadline - запас (8 с): до последней секунды бюджета обрыв наступает раньше отсечки группы,
  // иначе неудача такого запроса не успевала бы записаться, а запись «зависшей группы» ложилась бы поверх чужого прогона.
  for (let left = 8_000; left <= 250_000; left += 1_000) {
    const abortAt = 5_000 + seoRequestTimeoutMs(5_000 + left, 5_000);
    assert.ok(abortAt - (5_000 + left) < SEO_GROUP_CUTOFF_AFTER_DEADLINE_MS, `осталось ${left} мс бюджета`);
  }
});

test("Зависший запрос к WB обрывается по таймауту: кабинет error, курсор стоит, running не остаётся", async () => {
  const env = createEnv({ nmIds: { c1: range(1001, 10) }, hang: true });
  env.store.set("c1", stateOf(olderDays(NIGHT)));
  const [result] = await env.run([makeTarget("c1")]);
  assert.equal(result.status, "error");
  assert.match(result.message ?? "", /таймаут/);
  assert.deepEqual(env.timeouts, [seoRequestTimeoutMs(NIGHT + 250_000, NIGHT)], "сигнал таймаута выдан с расчётным сроком");
  assert.equal(env.state("c1").attempts, 1);
  assert.equal(env.state("c1").state.afterNm ?? 0, 0);
  assertNoRunning(env);
});

test("settleWithin: зависшая работа отдаёт запасной результат, готовая — свой; журналу есть что писать", async () => {
  const never = new Promise<string>(() => undefined);
  assert.equal(await settleWithin(never, 15, () => "стоп"), "стоп");
  assert.equal(await settleWithin(Promise.resolve("готово"), 1_000, () => "стоп"), "готово");
  const group = [makeTarget("c1", "Кабинет 1"), makeTarget("c2", "Кабинет 2")];
  const stalled = seoGroupErrorResults(group, "группа зависла");
  assert.deepEqual(stalled.map((result) => [result.cabinetId, result.status]), [["c1", "error"], ["c2", "error"]]);
  assert.equal(summarizeSeoRun(stalled).status, "error");
});

// ------------------------------------------------------------------ 2.3: недоступность по другой причине — не «ok»

test("summarizeSeoRun: токен без категории / отозван — partial, у всех кабинетов — error; без Джема — ok, но с записью в журнал", () => {
  const base: SeoGroupResult = {
    cabinetId: "c", cabinet: "Кабинет", status: "caught_up", yesterday: YESTERDAY, yesterdayDone: true,
    day: YESTERDAY, mode: "batch", requests: 2, rows: 100, skippedSku: 0,
  };
  const scope: SeoGroupResult = { ...base, cabinet: "Оптима", status: "unavailable", yesterdayDone: false, rows: 0, reason: "token_scope", message: "WB 403: scope is not allowed" };
  const noJam: SeoGroupResult = { ...scope, cabinet: "Без Джема", reason: "no_jam", message: "WB 403: Jam" };

  const mixed = summarizeSeoRun([base, scope]);
  assert.equal(mixed.status, "partial");
  assert.match(mixed.note, /Оптима: unavailable \(token_scope\)/);
  assert.equal(summarizeSeoRun([scope, { ...scope, cabinet: "Второй", reason: "unauthorized" }]).status, "error");

  const quiet = summarizeSeoRun([base, noJam]);
  assert.equal(quiet.status, "ok", "кабинет без подписки — штатное состояние");
  assert.match(quiet.logNote ?? "", /Без Джема: unavailable \(no_jam\)/, "но журнал о нём знает");
  assert.doesNotMatch(quiet.logNote ?? "", /Кабинет: caught_up/, "здоровые кабинеты журнал не засоряют");
  assert.equal(summarizeSeoRun([noJam]).status, "ok");
});

test("Два кабинета с отозванными токенами (401): журнал error с причиной, а не ok с нулём строк", async () => {
  const env = createEnv({ nmIds: { c1: range(1, 5), c2: range(11, 5) }, respond: () => new Response("unauthorized", { status: 401 }) });
  const results = await env.run([makeTarget("c1"), makeTarget("c2")]);
  assert.deepEqual(results.map((result) => result.reason), ["unauthorized", "unauthorized"]);
  const summary = summarizeSeoRun(results);
  assert.equal(summary.status, "error");
  assert.match(summary.logNote ?? "", /unauthorized/);
});

// ------------------------------------------------------------------ 2.5: артикул занимается после успешного запроса

test("Кабинет с негодным токеном не «занимает» общие артикулы: сосед по продавцу с рабочим токеном измеряет их сам", async () => {
  const env = createEnv({
    nmIds: { c1: [3, 4], c2: [3, 4, 5] },
    respond: (req, n) => req.cabinet === "c1" ? new Response('{"detail":"scope is not allowed"}', { status: 403 }) : okResponse(req, n),
  });
  for (const id of ["c1", "c2"]) env.store.set(id, stateOf(olderDays(NIGHT)));
  const results = await env.run([makeTarget("c1"), makeTarget("c2")]);
  assert.equal(results[0].status, "unavailable");
  assert.deepEqual(env.requests.find((req) => req.cabinet === "c2" && req.day === YESTERDAY)?.nmIds, [3, 4, 5]);
  assert.deepEqual(sortedUnique(env.written.flat()), [3, 4, 5]);
});

// ------------------------------------------------------------------ 1.5: single — ротация между ночами

test("nextSeoSingle: ночь начинается с курсора прошлой ночи, идёт по кругу и заканчивается ровно на полном круге", () => {
  const nm = [10, 20, 30, 40];
  const walk = (start: number) => {
    const order: number[] = [];
    let cursor = start, wrapped = false;
    for (let guard = 0; guard < 10; guard += 1) {
      const next = nextSeoSingle(nm, cursor, start, wrapped);
      if (!next.batch.length) break;
      order.push(next.batch[0]);
      cursor = next.batch[0];
      wrapped = next.wrapped;
    }
    return order;
  };
  assert.deepEqual(walk(0), [10, 20, 30, 40]);
  assert.deepEqual(walk(20), [30, 40, 10, 20], "после конца списка — по кругу, каждый артикул ровно один раз");
  assert.deepEqual(walk(40), [10, 20, 30, 40]);
  assert.deepEqual(walk(99), [10, 20, 30, 40], "курсор за концом списка — круг сначала");
  assert.deepEqual(nextSeoSingle([], 0, 0, false).batch, []);
});

test("(d3) single: каждая ночь продолжает с места прошлой, за три ночи охвачено в разы больше, чем за одну; охват виден в журнале", async () => {
  const truncated: Responder = (req, n) => req.nmIds.length > 1
    ? Response.json({ data: { items: range(0, 30).map((index) => item(req.nmIds[0], `запрос ${index}`)) } })
    : okResponse(req, n);
  const env = createEnv({ nmIds: { c1: range(1001, 300) }, respond: truncated });
  env.store.set("c1", stateOf(olderDays(NIGHT)));

  const coverage: number[] = [];
  let lastNote = "";
  for (let night = 0; night < 3; night += 1) {
    goToNight(env, night);
    for (let run = 0; run < 8; run += 1) {
      const results = await env.run([makeTarget("c1")]);
      lastNote = summarizeSeoRun(results).note;
      env.advance(30 * 60_000);
    }
    coverage.push(sortedUnique(env.written.flat()).length);
  }
  assert.ok(coverage[0] > 0 && coverage[0] < 150, `первая ночь охватывает ломоть, не весь список: ${coverage[0]}`);
  assert.ok(coverage[2] > coverage[0] * 2, `за три ночи охват растёт, а не стоит на месте: ${coverage.join(" → ")}`);
  assert.ok(Math.max(...env.written.flat().map((row) => row.nm_id)) > 1200, "дальше первых ~100 артикулов дело дошло");
  assert.match(lastNote, /охват \d+\/300 арт/, "охват виден в журнале");
  assert.equal(env.state("c1").state.mode, "single");
  assertNoRunning(env);
});

// ------------------------------------------------------------------ 2.1 / 2.7 / 2.9 / 2.10: решения ленивого роута

const SNAP_NIGHT_SYNCED = "2026-10-05T01:15:00.000Z";
const snap = (day: string, keyword: string, pos: number | null, over: Partial<SeoSnapRow> = {}): SeoSnapRow => ({
  keyword, frequency: 100, median_position: pos, snapshot_date: day, synced_at: `${shiftDay(day, 1)}T01:15:00.000Z`, ...over,
});
function shiftDay(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
}

function createKeywordsEnv(config: {
  history?: SeoSnapRow[];
  state?: SeoPositionsState | null;
  status?: string;
  token?: string | null;
  live?: { ok: boolean; status: number; text: string };
  historyThrows?: boolean;
  stateThrows?: boolean;
  tokenThrows?: boolean;
  writeThrows?: boolean;
  now?: number;
}) {
  const calls = { history: [] as Array<{ from: string; to: string }>, live: [] as Array<{ token: string; day: string }>, written: [] as SeoPositionRow[][] };
  const deps: SeoKeywordsDeps = {
    now: () => config.now ?? NIGHT + 9 * HOUR,
    readHistory: async (window) => {
      calls.history.push(window);
      if (config.historyThrows) throw new Error("PostgREST timeout");
      return config.history ?? [];
    },
    readState: async () => {
      if (config.stateThrows) throw new Error("wb_sync_state: timeout");
      return config.state ? { status: config.status ?? "caught_up", state: config.state } : null;
    },
    getToken: async () => {
      if (config.tokenThrows) throw new Error("wb_cabinets: timeout");
      return config.token === undefined ? "tok" : config.token;
    },
    requestLive: async (token, day) => {
      calls.live.push({ token, day });
      return config.live ?? { ok: true, status: 200, text: JSON.stringify({ data: { items: [] } }) };
    },
    writeRows: async (rows) => {
      calls.written.push(rows);
      if (config.writeThrows) throw new Error("upsert failed");
    },
  };
  return { deps, calls };
}

test("seoHistoryWindow и selectClosedHistory: окно 30 закрытых дней по МСК; старые ленивые строки и будущее отсекаются", () => {
  assert.deepEqual(seoHistoryWindow("2026-10-04"), { from: "2026-09-05", to: "2026-10-04" });
  const rows = [
    snap("2026-10-04", "вчера, ночью", 5),
    snap("2026-10-03", "старая ленивая", 9, { synced_at: "2026-10-03T12:00:00Z" }),
    snap("2026-09-04", "до окна", 3),
    snap("2026-10-05", "позже вчера", 3),
    snap("2026-09-05", "край окна", 4),
    snap("2026-10-02", "без synced_at", 4, { synced_at: null }),
  ];
  assert.deepEqual(selectClosedHistory(rows, "2026-10-04").map((row) => row.keyword), ["вчера, ночью", "край окна"]);
});

test("loadSeoKeywords: вчерашний день по МСК, а не по UTC; окно запроса к базе — 30 закрытых дней", async () => {
  // 22:30 UTC 04.10 = 01:30 МСК 05.10: вчера — 04.10.
  const { deps, calls } = createKeywordsEnv({ now: Date.parse("2026-10-04T22:30:00Z"), history: [snap("2026-10-04", "куртка", 5)] });
  const { payload, debug } = await loadSeoKeywords(deps, { nmId: 7, cabinetId: "c1" });
  assert.deepEqual(calls.history, [{ from: "2026-09-05", to: "2026-10-04" }]);
  assert.equal(debug.yesterday, "2026-10-04");
  assert.equal(debug.haveYesterday, true);
  assert.deepEqual(payload.days, ["2026-10-04"]);
  assert.equal(calls.live.length, 0, "вчерашнее значение есть — квота WB не тратится");
});

test("loadSeoKeywords: на экран попадают только закрытые дни; медианы за 14 дней под днём открытия не показываются", async () => {
  const { deps } = createKeywordsEnv({
    history: [
      snap("2026-10-03", "куртка", 4, { synced_at: "2026-10-03T12:00:00Z" }),
      snap("2026-10-04", "куртка", 5),
      snap("2026-10-04", "парка", null, { frequency: 400 }),
    ],
  });
  const { payload } = await loadSeoKeywords(deps, { nmId: 7, cabinetId: "c1" });
  assert.deepEqual(payload.days, ["2026-10-04"], "старая ленивая строка 03.10 скрыта");
  assert.deepEqual(payload.words.map((word) => [word.keyword, word.shows, word.daily[0].pos]), [["парка", 400, null], ["куртка", 100, 5]]);
});

test("loadSeoKeywords: ночь измерила вчера, у товара нет запросов — живого запроса нет, на экране объяснение", async () => {
  const { deps, calls } = createKeywordsEnv({ state: { doneDays: [YESTERDAY] } });
  const { payload, debug } = await loadSeoKeywords(deps, { nmId: 7, cabinetId: "c1" });
  assert.equal(debug.plan, "measured");
  assert.equal(calls.live.length, 0);
  assert.deepEqual(payload, { words: [], days: [], note: SEO_NOTE_MEASURED_EMPTY });
  assert.doesNotMatch(payload.note ?? "", /Джем/);
});

test("loadSeoKeywords: день с дырой — спрашиваем WB только про артикулы из дыр, остальные ночь измерила", async () => {
  const state: SeoPositionsState = {
    doneDays: [], partial: { [YESTERDAY]: ["2026-10-05"] },
    holes: { [YESTERDAY]: [{ from: 1001, to: 1050, count: 50, tries: 0 }] },
  };
  const hole = createKeywordsEnv({ state });
  assert.equal((await loadSeoKeywords(hole.deps, { nmId: 1020, cabinetId: "c1" })).debug.plan, "live");
  assert.equal(hole.calls.live.length, 1);
  const outside = createKeywordsEnv({ state });
  assert.equal((await loadSeoKeywords(outside.deps, { nmId: 1060, cabinetId: "c1" })).debug.plan, "measured");
  assert.equal(outside.calls.live.length, 0);
  // Проход дня не закончен или день пустой — ночь этот артикул могла и не спросить.
  const inProgress = createKeywordsEnv({ state: { doneDays: [], day: YESTERDAY, afterNm: 1050 } });
  assert.equal((await loadSeoKeywords(inProgress.deps, { nmId: 1060, cabinetId: "c1" })).debug.plan, "live");
  const emptyDay = createKeywordsEnv({ state: { doneDays: [], emptyDays: { [YESTERDAY]: "2026-10-05" } } });
  assert.equal((await loadSeoKeywords(emptyDay.deps, { nmId: 1060, cabinetId: "c1" })).debug.plan, "live");
});

test("loadSeoKeywords: живой запрос пишет строки в вчерашний день по МСК, закрытым снимком; ответ из них же", async () => {
  const live = { ok: true, status: 200, text: JSON.stringify({ data: { items: [
    { text: "куртка", nmId: 7, frequency: { current: 90 }, medianPosition: { current: 6 } },
    { text: "парка", frequency: { current: 40 }, avgPosition: { current: 11 } },
  ] } }) };
  const { deps, calls } = createKeywordsEnv({ live, now: Date.parse("2026-10-04T22:30:00Z") });
  const { payload } = await loadSeoKeywords(deps, { nmId: 7, cabinetId: "c1" });
  assert.deepEqual(calls.live, [{ token: "tok", day: "2026-10-04" }]);
  assert.equal(calls.written.length, 1);
  assert.deepEqual(calls.written[0].map((row) => [row.nm_id, row.keyword, row.snapshot_date, row.cabinet_id]), [
    [7, "куртка", "2026-10-04", "c1"],
    [7, "парка", "2026-10-04", "c1"],
  ], "запись без nmId в ответе отнесена к запрошенному артикулу");
  assert.ok(calls.written[0].every((row) => isClosedDaySnapshot({ snapshot_date: row.snapshot_date, synced_at: row.synced_at })));
  assert.deepEqual(payload.days, ["2026-10-04"]);
  assert.deepEqual(payload.words.map((word) => word.keyword), ["куртка", "парка"]);
});

test("loadSeoKeywords: записи без разбираемого содержимого — явная ошибка, а не пустой экран", async () => {
  const { deps, calls } = createKeywordsEnv({ live: { ok: true, status: 200, text: JSON.stringify({ data: { items: [{ unexpected: true }] } }) } });
  const { payload } = await loadSeoKeywords(deps, { nmId: 7, cabinetId: "c1" });
  assert.match(payload.error ?? "", /ни одной не разобрано/);
  assert.equal(calls.written.length, 0);
});

test("loadSeoKeywords: тело ответа WB на 400/5xx пользователю не показывается — только статус", async () => {
  const secret = '{"title":"bad","detail":"внутренний текст WB eyJhbGciOiJIUzI1NiJ9.payload.sig","requestId":"r-777"}';
  for (const status of [400, 500, 502]) {
    const { deps } = createKeywordsEnv({ live: { ok: false, status, text: secret } });
    const { payload } = await loadSeoKeywords(deps, { nmId: 7, cabinetId: "c1" });
    assert.equal(payload.error, `WB ${status}`);
  }
  assert.equal(seoFailureMessage(classifySearchTextsFailure(400, secret)), "WB 400");
  // В журнале крона текст остаётся, но токен из него вычищен и длина ограничена.
  const failure = classifySearchTextsFailure(400, secret);
  assert.ok(failure.kind === "bad_request" && /внутренний текст WB/.test(failure.message) && !/eyJhbGci/.test(failure.message));
  assert.ok(failure.kind === "bad_request" && failure.message.length <= 220);
});

test("Сбой запроса на крон-пути: подробный текст WB остаётся в lastError, но не секретный", async () => {
  const env = createEnv({
    nmIds: { c1: range(1, 3) },
    respond: () => new Response('{"detail":"внутренний текст WB eyJhbGciOiJIUzI1NiJ9.payload.sig"}', { status: 400 }),
  });
  await env.run([makeTarget("c1")]);
  assert.match(env.state("c1").lastError ?? "", /внутренний текст WB/);
  assert.doesNotMatch(env.state("c1").lastError ?? "", /eyJhbGci/);
});

test("loadSeoKeywords: пустой экран всегда объяснён — ожидание первой ночи, пауза без Джема, ошибка чтения", async () => {
  // До первой ночи ночного замера нет — спрашиваем WB сами; пустой ответ WB — это ответ, а не «данные накапливаются».
  const firstNight = createKeywordsEnv({});
  const answeredEmpty = await loadSeoKeywords(firstNight.deps, { nmId: 7, cabinetId: "c1" });
  assert.equal(firstNight.calls.live.length, 1);
  assert.deepEqual(answeredEmpty.payload, { words: [], days: [], note: SEO_NOTE_MEASURED_EMPTY });
  assert.doesNotMatch(answeredEmpty.payload.note ?? "", /накапливаются|Джем/);

  const paused = createKeywordsEnv({ state: { unavailableAt: new Date(NIGHT + 9 * HOUR - HOUR).toISOString(), reason: "no_jam" }, status: "unavailable" });
  const pausedResult = await loadSeoKeywords(paused.deps, { nmId: 7, cabinetId: "c1" });
  assert.equal(pausedResult.debug.plan, "paused");
  assert.match(pausedResult.payload.error ?? "", /Джем/);
  assert.equal(paused.calls.live.length, 0);

  const broken = createKeywordsEnv({ historyThrows: true });
  const brokenResult = await loadSeoKeywords(broken.deps, { nmId: 7, cabinetId: "c1" });
  assert.match(brokenResult.payload.error ?? "", /История позиций не прочиталась/);
  assert.equal(broken.calls.live.length, 0, "при ошибке чтения квоту WB не тратим");

  const noToken = createKeywordsEnv({ token: null });
  assert.equal((await loadSeoKeywords(noToken.deps, { nmId: 7, cabinetId: "c1" })).payload.error, "WB-токен не настроен");
});

test("buildKeywordsPayload: снимки + сбой живого запроса дают данные и заметку; без снимков — ошибку или объяснение пустоты", () => {
  const withNote = buildKeywordsPayload([snap("2026-10-04", "куртка", 5)], { liveError: "WB 502" });
  assert.equal(withNote.note, "WB 502");
  assert.equal(withNote.error, undefined);
  assert.deepEqual(buildKeywordsPayload([], { liveError: "WB 502" }), { words: [], days: [], error: "WB 502" });
  assert.deepEqual(buildKeywordsPayload([], { liveError: null }), { words: [], days: [], note: SEO_NOTE_MEASURED_EMPTY });
});

// ------------------------------------------------------------------ экран: подпись колонки и пустое состояние

test("Экран: колонка частоты честно называет единицу (за день, максимум за период), пустое состояние не сводится к Джему", () => {
  const page = read("components/wb/WbSeoPage.tsx");
  assert.match(page, />Частота за день<span[^>]*>макс\. за период<\/span><\/th>/);
  assert.match(page, /title="Сколько раз запрос искали за один день/);
  assert.doesNotMatch(page, /Для живых запросов нужна подписка/, "пустой экран без ошибки — не обязательно Джем");
  // Причина пустоты — внутри пустого состояния, а не второй подписью под ним (иначе фраза повторяется или спорит с ним).
  assert.match(page, /<WbEmptyState>\{keywords\.note \?\? "По этому товару пока нет запросов с позицией\."\}<\/WbEmptyState>/);
  assert.match(page, /\{keywords\?\.note && keywords\.words\.length > 0 \? <p /);
});

// ------------------------------------------------------------------ крон-роут: обвязка

test("Крон-роут: сброс, строгое чтение состояния, отсечка зависшей группы и журнал с notes — вызовы, а не импорты", () => {
  const route = read("app/api/sync/seo-positions/route.ts");
  assert.match(route, /readState: \(cabinetId\) => readWbSyncStateOrThrow<SeoPositionsState>\(db, cabinetId, SEO_POSITIONS_JOB\)/);
  assert.match(route, /seoResetWrite\(saved, reset \? null : remeasure\)/);
  assert.match(route, /SEO_GROUP_CUTOFF_AFTER_DEADLINE_MS/);
  assert.match(route, /request\.nextUrl\.searchParams\.get\("remeasure"\)/);
  assert.match(route, /\(remeasure !== null \|\| reset\) && !onlyCabinet/, "сброс без ?cabinet= не принимается");
  assert.match(route, /settleWithin\(\s*runSeoPositionsGroup\(group, deps/);
  assert.match(route, /writeSyncLog\(SEO_POSITIONS_JOB, summary\.status, summary\.rows, summary\.logNote, startedAt\)/);
  assert.ok(route.indexOf("checkCronAuth(request)") < route.indexOf('searchParams.get("remeasure")'), "авторизация раньше любого сброса");
});

// ====================================================================== v3: правки по повторному ревью (дыры, пустые дни, ленивый роут)

const emptyItems: Responder = () => Response.json({ data: { items: [] } });
const bad = (status = 502) => new Response("bad gateway", { status });

// ------------------------------------------------------------------ 2.1: перепроверка дыр укладывается в бюджет прогона

test("2.1 Перепроверка дыр: потолок запросов за прогон, давно не пробованные первыми, ночь засчитывается с первого запроса, догрузка истории не стоит", async () => {
  const STUCK = "2026-10-03";
  const BACKFILL = "2026-10-02";
  const holes = range(1001, 30).map((nm) => ({ from: nm, to: nm, count: 1, tries: 0 }));
  const env = createEnv({
    nmIds: { c1: range(1001, 80) },
    // День STUCK WB не отдаёт никогда, остальные здоровы.
    respond: (req, n) => (req.day === STUCK ? bad() : okResponse(req, n)),
  });
  const done = [...olderDays(NIGHT), YESTERDAY].filter((day) => day !== STUCK && day !== BACKFILL);
  // Остальные 50 артикулов дня проход уже измерил: строки по дню есть, поэтому отказ его закроет, а не отложит как пустой.
  env.store.set("c1", stateOf(done, { totalSku: 80, partial: { [STUCK]: [] }, holes: { [STUCK]: holes }, dayRowsByDay: { [STUCK]: 100 } }));

  const stuckNms = (from: number) => env.requests.slice(from).filter((req) => req.day === STUCK).flatMap((req) => req.nmIds);

  await env.run([makeTarget("c1")]);
  const first = stuckNms(0);
  assert.equal(first.length, SEO_HOLE_REQUESTS_OLDER, "на дыры старого дня за прогон не больше потолка, а не весь бюджет");
  assert.ok(env.requests.some((req) => req.day === BACKFILL), "догрузка истории идёт в том же прогоне, дыры её не держат");
  assert.deepEqual(env.state("c1").state.partial?.[STUCK], ["2026-10-05"], "ночь засчитана с первого запроса, хотя перепроверка не дошла до конца списка");

  env.advance(30 * 60_000);
  const mark = env.requests.length;
  await env.run([makeTarget("c1")]);
  const second = stuckNms(mark);
  assert.equal(second.length, SEO_HOLE_REQUESTS_OLDER);
  assert.equal(second.filter((nm) => first.includes(nm)).length, 0, "давно не пробованные идут первыми: хвост списка получает очередь");

  // Ночи 1 и 2 засчитываются: вместе с ночью 0 набирается SEO_HOLE_MAX_NIGHTS.
  for (const night of [1, 2]) {
    goToNight(env, night);
    await env.run([makeTarget("c1")]);
  }
  assert.equal(env.state("c1").state.partial?.[STUCK]?.length, SEO_HOLE_MAX_NIGHTS);
  // Ночей достаточно, а спрошена лишь часть дыр (по SEO_HOLE_REQUESTS_OLDER за прогон): отказ отрезал бы
  // артикулы, которых перепроверка ещё не касалась, — их сначала спрашивают.
  const untried = () => (env.state("c1").state.holes?.[STUCK] ?? []).filter((hole) => !hole.triedAt).length;
  assert.ok(untried() > 0, "часть дыр ещё ни разу не спрашивали");
  goToNight(env, 3);
  const [notYet] = await env.run([makeTarget("c1")]);
  assert.equal(notYet.abandonedSku, undefined, "отказа нет, пока есть неспрошенные дыры");
  assert.equal(env.state("c1").state.doneDays?.includes(STUCK), false);

  // Каждую ночь неспрошенных всё меньше; когда спрошены все, а плохие артикулы одиночные, — отказ от всех тридцати.
  let gaveUp: SeoGroupResult | undefined;
  for (let night = 4; night < 12 && !gaveUp; night += 1) {
    const before = untried();
    goToNight(env, night);
    const [result] = await env.run([makeTarget("c1")]);
    if (result.abandonedSku) {
      assert.equal(before, 0, "отказ состоялся, только когда неспрошенных дыр не осталось");
      gaveUp = result;
    }
  }
  assert.ok(gaveUp);
  assert.equal(gaveUp.abandonedSku, 30);
  assert.equal(env.state("c1").state.doneDays?.includes(STUCK), true, "после отказа день закрыт");
  assertNoRunning(env);
});

test("2.1 Дыры старых дней делят один потолок по очереди: день, который давно не перепроверяли, идёт раньше", async () => {
  const DAY_A = "2026-10-03";
  const DAY_B = "2026-10-02";
  const env = createEnv({ nmIds: { c1: range(1001, 80) }, respond: () => bad() });
  const done = [...olderDays(NIGHT), YESTERDAY].filter((day) => day !== DAY_A && day !== DAY_B);
  const holes = (from: number) => range(from, 10).map((nm) => ({ from: nm, to: nm, count: 1, tries: 0 }));
  env.store.set("c1", stateOf(done, {
    totalSku: 80,
    partial: { [DAY_A]: [], [DAY_B]: [] },
    holes: { [DAY_A]: holes(1001), [DAY_B]: holes(1001) },
  }));
  const served: string[] = [];
  for (let run = 0; run < 4; run += 1) {
    const mark = env.requests.length;
    await env.run([makeTarget("c1")]);
    const days = [...new Set(env.requests.slice(mark).map((req) => req.day))];
    assert.equal(days.length, 1, "потолок общий: за прогон перепроверяют один день, а не оба");
    served.push(days[0]);
    env.advance(30 * 60_000);
  }
  assert.ok(served.includes(DAY_A) && served.includes(DAY_B), `оба дня получают очередь: ${served.join(" ")}`);
  assert.notEqual(served[0], served[1], "день, только что получивший запросы, уступает тому, что ждёт");
});

test("Системный 400 (WB отвечает 400 на всё): после трёх запросов прогон останавливается с error, заметка короткая, журнал красный", async () => {
  const long = `{"detail":"${"x".repeat(300)}"}`;
  const env = createEnv({ nmIds: { c1: range(1001, 300) }, respond: () => new Response(long, { status: 400 }) });
  env.store.set("c1", stateOf(olderDays(NIGHT).slice(0, 25)));
  const [result] = await env.run([makeTarget("c1")]);
  assert.equal(env.requests.length, SEO_SYSTEMATIC_400_REQUESTS, "квота продавца не сгорает: три запроса, и стоп");
  assert.equal(result.status, "error");
  assert.match(result.message ?? "", /однодневный период/, "в журнале названа вероятная причина");
  assert.ok((result.message ?? "").length < 450, `заметка прогона сведена в строку, а не по строке на каждый пакет и день: ${(result.message ?? "").length} знаков`);
  assert.equal(summarizeSeoRun([result]).status, "error", "журнал громкий, а не partial");
  assert.equal(env.state("c1").status, "error", "running не остаётся");
  assert.equal(env.state("c1").state.doneDays?.includes(YESTERDAY), false, "день с 400 не закрыт");
  assert.ok((env.state("c1").state.holes?.[YESTERDAY] ?? []).length > 0, "пакеты с 400 — дыры дня, а не потерянные");
});

// ------------------------------------------------------------------ 2.2: охранник пустого дня при закрытии через дыры

test("2.2 День, закрываемый перепроверкой дыры, проходит тот же охранник пустого дня: пусто при живых артикулах — отложен, а не закрыт", async () => {
  let failures = 0;
  const env = createEnv({
    nmIds: { c1: range(1001, 120) },
    active: { c1: range(1001, 40) },
    respond: (req) => (req.day === YESTERDAY && req.nmIds[0] === 1051 && failures++ < SEO_BATCH_MAX_ATTEMPTS ? bad() : emptyItems(req, 0)),
  });
  env.store.set("c1", stateOf(olderDays(NIGHT)));
  for (let run = 0; run < SEO_BATCH_MAX_ATTEMPTS; run += 1) {
    await env.run([makeTarget("c1")]);
    env.advance(30 * 60_000);
  }
  const saved = env.state("c1").state;
  assert.equal(saved.doneDays?.includes(YESTERDAY), false, "день с нулём строк не закрыт и через дыру");
  assert.ok(saved.emptyDays?.[YESTERDAY], "день отложен как пустой");
  assert.equal(saved.holes?.[YESTERDAY], undefined, "дыра проверена: пусто и там");
  assert.equal(saved.partial?.[YESTERDAY], undefined);
  const [result] = await env.run([makeTarget("c1")]);
  const summary = summarizeSeoRun([result]);
  assert.equal(summary.status, "partial", "журнал не зелёный");
  assert.match(summary.note, /WB не вернул запросов за весь день/);
  assert.equal(seoMeasuredByNight(env.state("c1").state, YESTERDAY, 1001), false, "ленивый роут может спросить WB сам");
});

test("2.2 Дыра закрыта, а строки по дню уже есть: день закрывается как обычно", async () => {
  let failures = 0;
  const env = createEnv({
    nmIds: { c1: range(1001, 120) },
    active: { c1: range(1001, 40) },
    respond: (req, n) => (req.day === YESTERDAY && req.nmIds[0] === 1051 && failures++ < SEO_BATCH_MAX_ATTEMPTS ? bad() : okResponse(req, n)),
  });
  env.store.set("c1", stateOf(olderDays(NIGHT)));
  for (let run = 0; run < SEO_BATCH_MAX_ATTEMPTS; run += 1) {
    await env.run([makeTarget("c1")]);
    env.advance(30 * 60_000);
  }
  assert.equal(env.state("c1").state.doneDays?.includes(YESTERDAY), true);
  assert.equal(env.state("c1").state.emptyDays, undefined);
});

// ------------------------------------------------------------------ 2.3: отложенный пустой день не залипает

test("2.3 Отложенный пустой день не залипает: одна проба по первым 50 живым артикулам, а когда WB снова отдаёт строки, дни возвращаются в работу", async () => {
  const env = createEnv({ nmIds: { c1: range(1001, 120) }, active: { c1: range(1001, 60) }, respond: emptyItems });
  env.store.set("c1", stateOf(olderDays(NIGHT).slice(0, 27)));
  const [empty] = await env.run([makeTarget("c1")]);
  assert.equal(Object.keys(env.state("c1").state.emptyDays ?? {}).length, 3, "вчера и два дня до него отложены");
  assert.equal(empty.yesterdayDone, false);

  // WB ожил. Через час проба — один запрос по первым 50 живым — находит строки, и все отложенные дни измеряются заново.
  env.setRespond(okResponse);
  env.advance(SEO_EMPTY_PROBE_EVERY_MS + 5 * 60_000);
  const mark = env.requests.length;
  const [recovered] = await env.run([makeTarget("c1")]);
  const probe = env.requests[mark];
  assert.deepEqual(probe.nmIds, range(1001, 50), "проба — первые пятьдесят живых артикулов");
  assert.equal(probe.day, YESTERDAY, "первым проверяется самый свежий отложенный день");
  assert.equal(env.state("c1").state.emptyDays, undefined, "флаги сняты");
  assert.equal(env.state("c1").state.doneDays?.includes(YESTERDAY), true);
  assert.equal(recovered.yesterdayDone, true);
  assert.equal(env.requests.length - mark, 1 + 3 * 3, "проба + три дня заново пакетами 50/50/20");
  assert.match(recovered.message ?? "", /возвращены в работу/);
  assert.equal(summarizeSeoRun([recovered]).status, "ok");
});

test("2.3 Проба отложенных дней: не чаще раза за прогон и раза в SEO_EMPTY_PROBE_EVERY_MS на день, пока WB пуст — дни остаются отложенными", async () => {
  const env = createEnv({ nmIds: { c1: range(1001, 120) }, active: { c1: range(1001, 60) }, respond: emptyItems });
  env.store.set("c1", stateOf(olderDays(NIGHT).slice(0, 27)));
  await env.run([makeTarget("c1")]);
  const afterPass = env.requests.length;

  const perRun: number[] = [];
  for (let run = 0; run < 8; run += 1) {
    env.advance(30 * 60_000);
    const mark = env.requests.length;
    await env.run([makeTarget("c1")]);
    perRun.push(env.requests.length - mark);
  }
  assert.ok(perRun.every((count) => count <= 1), `не больше одной пробы за прогон: ${perRun.join(",")}`);
  assert.equal(perRun[0], 0, "через полчаса после отложения проверять рано");
  assert.ok(perRun.some((count) => count === 1), "через час пробы идут");
  const byDay = new Map<string, number[]>();
  for (const req of env.requests.slice(afterPass)) byDay.set(req.day, [...(byDay.get(req.day) ?? []), req.at]);
  for (const times of byDay.values()) {
    for (let index = 1; index < times.length; index += 1) assert.ok(times[index] - times[index - 1] >= SEO_EMPTY_PROBE_EVERY_MS, "один и тот же день — не чаще интервала");
  }
  assert.equal(Object.keys(env.state("c1").state.emptyDays ?? {}).length, 3, "WB пуст — дни остались отложенными");
  assert.equal(env.state("c1").state.doneDays?.includes(YESTERDAY), false);
});

test("2.3 Журнал помнит об отложенных днях старше вчерашнего: ok с заметкой, а не чистый ok", async () => {
  const base: SeoGroupResult = {
    cabinetId: "c", cabinet: "Кабинет", status: "caught_up", yesterday: YESTERDAY, yesterdayDone: true,
    day: YESTERDAY, mode: "batch", requests: 2, rows: 100, skippedSku: 0,
  };
  const parked = summarizeSeoRun([{ ...base, emptyOlder: 3 }]);
  assert.equal(parked.status, "ok", "вчера измерен — статус по правилу «журнал отвечает за вчера»");
  assert.match(parked.logNote ?? "", /дней без данных WB: 3/, "но заметка есть, пока дни не измерены");
  assert.equal(summarizeSeoRun([base]).logNote, null);

  assert.equal(seoEmptyOlderCount({ emptyDays: { "2026-10-04": "t", "2026-10-02": "t", "2026-10-01": "t" } }, "2026-10-04"), 2, "вчерашний день считается отдельно");
  assert.equal(seoEmptyOlderCount({}, "2026-10-04"), 0);

  // Те же данные в настоящем прогоне: вчера измерен, старый день отложен — результат несёт счётчик.
  const env = createEnv({ nmIds: { c1: range(1001, 10) } });
  env.store.set("c1", stateOf([...olderDays(NIGHT).slice(0, 27), YESTERDAY], { emptyDays: { "2026-10-02": new Date(NIGHT - 5 * 60_000).toISOString() } }));
  const [result] = await env.run([makeTarget("c1")]);
  assert.equal(result.emptyOlder, 1);
  assert.match(summarizeSeoRun([result]).logNote ?? "", /дней без данных WB: 1/);
});

// ------------------------------------------------------------------ 2.4: очередь соседей, дыры недоделанного дня

test("2.4 Закончен проход вчерашнего дня, остались одни дыры: сосед по продавцу не уступает очередь, история идёт", async () => {
  const env = createEnv({ nmIds: { c1: range(1001, 10), c2: range(2001, 10) } });
  env.store.set("c1", stateOf([YESTERDAY]));
  env.store.set("c2", stateOf(olderDays(NIGHT), {
    totalSku: 10,
    partial: { [YESTERDAY]: ["2026-10-04"] },
    holes: { [YESTERDAY]: [{ from: 2001, to: 2010, count: 10, tries: 0 }] },
  }));
  await env.run([makeTarget("c1"), makeTarget("c2")]);
  const c1 = env.requests.filter((req) => req.cabinet === "c1");
  assert.ok(c1.length > 0 && c1.every((req) => req.day !== YESTERDAY), "c1 догружает историю, а не ждёт дыр вчерашнего дня c2");
});

test("2.4 Смена дня не стирает дыры недоделанного дня; свой проход дня начинается с чистого листа", async () => {
  const env = createEnv({ nmIds: { c1: range(1001, 80) } });
  const OLD = "2026-10-04";
  env.store.set("c1", stateOf(olderDays(NIGHT).filter((day) => day !== OLD), {
    day: OLD, afterNm: 1050, totalSku: 80,
    holes: { [OLD]: [{ from: 1001, to: 1050, count: 50, tries: 0 }] },
  }));
  goToNight(env, 1); // вчера теперь 05.10, а недоделанный 04.10 — старый день
  await env.run([makeTarget("c1")], { deadline: env.clock() + 12_000 }); // времени хватает на один запрос
  assert.equal(env.requests.length, 1);
  assert.equal(env.requests[0].day, "2026-10-05");
  assert.deepEqual(env.state("c1").state.holes?.[OLD]?.map((hole) => hole.from), [1001], "дыры 04.10 не стёрты");

  // Когда дойдёт очередь до самого 04.10, он начинается заново и находит свои дыры сам.
  const restarted = createEnv({ nmIds: { c1: range(1001, 80) } });
  restarted.store.set("c1", stateOf(olderDays(NIGHT).filter((day) => day !== OLD), {
    holes: { [OLD]: [{ from: 1001, to: 1050, count: 50, tries: 0 }] },
  }));
  await restarted.run([makeTarget("c1")]);
  assert.equal(restarted.state("c1").state.holes, undefined, "свежий проход не тащит чужих дыр");
  assert.equal(restarted.state("c1").state.doneDays?.includes(OLD), true);
});

// ------------------------------------------------------------------ 2.5 / 2.6: обрезанный ответ и деление дыр

test("2.5 Обрезанный ответ при перепроверке дыры не закрывает день: дыра рассыпается на одиночные артикулы", async () => {
  let failures = 0;
  const globalLimit: Responder = (req) => {
    // limit WB — 30 строк на ВЕСЬ пакет; у каждого артикула по 5 запросов.
    const items: SearchTextItem[] = [];
    for (const nm of req.nmIds) for (let k = 0; k < 5 && items.length < 30; k += 1) items.push(item(nm, `q${k}`));
    return Response.json({ data: { items } });
  };
  const env = createEnv({
    nmIds: { c1: range(1001, 40) },
    respond: (req, n) => (req.day === YESTERDAY && failures++ < SEO_BATCH_MAX_ATTEMPTS ? bad() : globalLimit(req, n)),
  });
  env.store.set("c1", stateOf(olderDays(NIGHT)));
  for (let run = 0; run < SEO_BATCH_MAX_ATTEMPTS; run += 1) {
    await env.run([makeTarget("c1")]);
    env.advance(30 * 60_000);
  }
  // Перепроверка получила ровно 30 строк на пакет из 40 артикулов: это обрезанный ответ, а не результат.
  assert.equal(env.state("c1").state.doneDays?.includes(YESTERDAY), false, "день не закрыт обрезанным ответом");
  const afterTruncation = env.state("c1").state.holes?.[YESTERDAY] ?? [];
  assert.ok(afterTruncation.length > 0 && afterTruncation.every((hole) => hole.count === 1), "дыра рассыпана на одиночные артикулы");
  assert.ok(sortedUnique(env.written.flat()).length <= SEO_HOLE_REQUESTS_YESTERDAY, "записаны только одиночные ответы, а не обрезанный ответ на 40 артикулов");

  for (let run = 0; run < 10; run += 1) {
    await env.run([makeTarget("c1")]);
    env.advance(30 * 60_000);
  }
  assert.equal(env.state("c1").state.doneDays?.includes(YESTERDAY), true, "по одному артикулу день измерен целиком");
  assert.deepEqual(sortedUnique(env.written.flat()), range(1001, 40));
});

test("2.6 Дыра делится пополам после второй неудачной перепроверки — любого рода, не только 400", async () => {
  const env = createEnv({
    nmIds: { c1: range(1001, 8) },
    respond: (req, n) => (req.day === YESTERDAY && req.nmIds.includes(1005) ? bad(500) : okResponse(req, n)),
  });
  env.store.set("c1", stateOf(olderDays(NIGHT), {
    totalSku: 8,
    partial: { [YESTERDAY]: [] },
    holes: { [YESTERDAY]: [{ from: 1001, to: 1008, count: 8, tries: 0 }] },
  }));
  await env.run([makeTarget("c1")]);
  assert.deepEqual(env.state("c1").state.holes?.[YESTERDAY]?.map((hole) => [hole.from, hole.to, hole.tries]), [[1001, 1008, 1]], "первая неудача — просто повтор");
  assert.equal(env.requests.length, 1);

  env.advance(30 * 60_000);
  await env.run([makeTarget("c1")]);
  assert.equal(SEO_HOLE_SPLIT_AFTER, 2);
  assert.deepEqual(env.state("c1").state.holes?.[YESTERDAY]?.map((hole) => [hole.from, hole.to]), [[1005, 1008]], "вторая неудача делит пакет: годная половина измерена");
  assert.deepEqual(sortedUnique(env.written.flat()), range(1001, 4));
});

// ------------------------------------------------------------------ 2.7: сброс не снимает паузу после 403

test("2.7 ?remeasure и ?reset не снимают паузу после 403: статус unavailable и причина остаются, WB не трогаем", async () => {
  const state: SeoPositionsState = {
    doneDays: ["2026-10-03"], unavailableAt: new Date(NIGHT - HOUR).toISOString(), reason: "no_jam",
    emptyDays: { "2026-10-04": new Date(NIGHT - HOUR).toISOString() },
  };
  const saved = { status: "unavailable", lastError: "WB 403: Jam", state };
  for (const day of [YESTERDAY, null]) {
    const write = seoResetWrite(saved, day);
    assert.equal(write.status, "unavailable");
    assert.equal(write.lastError, "WB 403: Jam", "причина паузы остаётся");
    assert.equal(write.cursor, null);
    assert.equal(isSeoUnavailablePause({ status: write.status, state: write.state }, NIGHT), true, "пауза в силе");
  }
  const pending = seoResetWrite({ status: "caught_up", lastError: "старая ошибка", state: { doneDays: ["2026-10-03"] } }, YESTERDAY);
  assert.deepEqual([pending.status, pending.lastError, pending.attempts], ["pending", null, 0]);

  const env = createEnv({ nmIds: { c1: range(1001, 10) } });
  env.store.set("c1", { ...seoResetWrite(saved, YESTERDAY), updatedAt: null });
  const [result] = await env.run([makeTarget("c1")]);
  assert.equal(result.status, "unavailable");
  assert.equal(result.paused, true);
  assert.equal(env.requests.length, 0, "после сброса пауза держит WB закрытым");
});

// ------------------------------------------------------------------ 2.9: пустая воронка и недавние строки

test("2.9 Воронка не назвала живых артикулов, но кабинет недавно писал строки: пустой день подозрителен; давние строки — нет", async () => {
  const recent = createEnv({ nmIds: { c1: range(1001, 20) }, active: { c1: [] }, respond: emptyItems });
  recent.store.set("c1", stateOf(olderDays(NIGHT), { lastRowsAt: "2026-10-03" }));
  const [suspicious] = await recent.run([makeTarget("c1")]);
  assert.equal(recent.state("c1").state.doneDays?.includes(YESTERDAY), false, "воронка могла отстать — день не закрыт");
  assert.ok(recent.state("c1").state.emptyDays?.[YESTERDAY]);
  assert.equal(suspicious.yesterdayDone, false);

  const stale = createEnv({ nmIds: { c1: range(1001, 20) }, active: { c1: [] }, respond: emptyItems });
  stale.store.set("c1", stateOf(olderDays(NIGHT), { lastRowsAt: "2026-09-20" }));
  await stale.run([makeTarget("c1")]);
  assert.equal(stale.state("c1").state.doneDays?.includes(YESTERDAY), true, "строк не было больше недели — пустой день честный");
});

test("2.9 Принятые строки отмечают дату последней записи кабинета", async () => {
  const env = createEnv({ nmIds: { c1: range(1001, 10) } });
  env.store.set("c1", stateOf(olderDays(NIGHT)));
  await env.run([makeTarget("c1")]);
  assert.equal(env.state("c1").state.lastRowsAt, "2026-10-05");
});

// ------------------------------------------------------------------ 2.10: аренда без чтения состояния не затирает его

test("2.10 claimWbSyncJob: RPC и чтение состояния не ответили — аренду не берём и состояние не пишем; чтение прошло — как раньше", async () => {
  const upserts: Array<Record<string, unknown>> = [];
  const fakeDb = (read: { data: unknown; error: { message: string } | null }) => ({
    rpc: async () => ({ data: null, error: { message: "statement timeout" } }),
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => read }) }) }),
      upsert: async (row: Record<string, unknown>) => { upserts.push(row); return { error: null }; },
    }),
  }) as never;

  assert.equal(await claimWbSyncJob(fakeDb({ data: null, error: { message: "timeout" } }), "c1", "seo-positions", 600), false);
  assert.equal(upserts.length, 0, "пустое состояние поверх нечитаемого не пишется");

  assert.equal(await claimWbSyncJob(fakeDb({ data: null, error: null }), "c1", "seo-positions", 600), true, "строки нет — аренда берётся");
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].status, "running");

  const row = { cursor: "c", status: "pending", attempts: 2, last_error: null, state: { doneDays: ["d"] }, updated_at: "2020-01-01T00:00:00Z" };
  assert.equal(await claimWbSyncJob(fakeDb({ data: row, error: null }), "c1", "seo-positions", 600), true);
  assert.deepEqual(upserts[1].state, { doneDays: ["d"] }, "прочитанное состояние сохраняется");
  assert.equal(upserts[1].attempts, 2);

  const fresh = { ...row, status: "running", updated_at: new Date().toISOString() };
  assert.equal(await claimWbSyncJob(fakeDb({ data: fresh, error: null }), "c1", "seo-positions", 600), false, "свежая аренда другого прогона уважается");
});

// ------------------------------------------------------------------ 1.2 / 1.4 / 1.5: ленивый роут

test("loadSeoKeywords: ответ 200 без data.items (в том числе тело null) — явная ошибка; пустой список — ответ WB: заметка, без записи", async () => {
  for (const text of ['{"data":{}}', "{}", "null", '{"data":{"items":"x"}}', '{"data":null}']) {
    const { deps, calls } = createKeywordsEnv({ live: { ok: true, status: 200, text } });
    const { payload } = await loadSeoKeywords(deps, { nmId: 7, cabinetId: "c1" });
    assert.equal(payload.error, "WB 200: нет data.items — формат ответа изменился", text);
    assert.equal(calls.written.length, 0);
  }
  const answered = createKeywordsEnv({ live: { ok: true, status: 200, text: JSON.stringify({ data: { items: [] } }) } });
  const { payload } = await loadSeoKeywords(answered.deps, { nmId: 7, cabinetId: "c1" });
  assert.deepEqual(payload, { words: [], days: [], note: SEO_NOTE_MEASURED_EMPTY });
  assert.equal(answered.calls.written.length, 0, "пустой ответ ничего не пишет");

  const html = createKeywordsEnv({ live: { ok: true, status: 200, text: "<html>" } });
  assert.equal((await loadSeoKeywords(html.deps, { nmId: 7, cabinetId: "c1" })).payload.error, "WB вернул не JSON");
});

test("loadSeoKeywords: сбой базы (токен, состояние, запись) не роняет ответ", async () => {
  const noToken = createKeywordsEnv({ tokenThrows: true });
  const tokenResult = await loadSeoKeywords(noToken.deps, { nmId: 7, cabinetId: "c1" });
  assert.equal(tokenResult.payload.error, "WB не ответил", "бросок getToken — читаемая ошибка, а не 500");

  const live = { ok: true, status: 200, text: JSON.stringify({ data: { items: [{ text: "куртка", nmId: 7, frequency: { current: 90 }, medianPosition: { current: 6 } }] } }) };
  const stateDown = createKeywordsEnv({ stateThrows: true, live });
  const stateResult = await loadSeoKeywords(stateDown.deps, { nmId: 7, cabinetId: "c1" });
  assert.equal(stateDown.calls.live.length, 1, "состояние не прочиталось — идём живым запросом");
  assert.deepEqual(stateResult.payload.words.map((word) => word.keyword), ["куртка"]);

  const writeDown = createKeywordsEnv({ writeThrows: true, live });
  const writeResult = await loadSeoKeywords(writeDown.deps, { nmId: 7, cabinetId: "c1" });
  assert.deepEqual(writeResult.payload.words.map((word) => word.keyword), ["куртка"], "запись не прошла — экран всё равно получил строки");
  assert.equal(writeResult.payload.error, undefined);
});

test("buildKeywordsPayload: на экран не больше 30 запросов; частота — максимум по дням, а не последняя", () => {
  const many = range(1, 31).map((index) => snap("2026-10-04", `запрос ${index}`, index, { frequency: 1_000 - index }));
  const { words } = buildKeywordsPayload(many, { liveError: null });
  assert.equal(words.length, 30);
  assert.equal(words[0].keyword, "запрос 1", "сильнейшие впереди, тридцать первый отрезан");
  assert.ok(!words.some((word) => word.keyword === "запрос 31"));

  const twoDays = buildKeywordsPayload([
    snap("2026-10-03", "куртка", 5, { frequency: 400 }),
    snap("2026-10-04", "куртка", 6, { frequency: 250 }),
  ], { liveError: null });
  assert.equal(twoDays.words[0].shows, 400, "подпись колонки — «макс. за период»");
  assert.deepEqual(twoDays.words[0].daily.map((day) => day.pos), [5, 6]);
});

// ====================================================================== v3: правки по итоговой независимой проверке

test("v3.1 Отказ не закрывает день без единой строки: тот же охранник пустого дня, день ждёт пробы, а не уходит в doneDays", async () => {
  const OLD_DAY = YESTERDAY;
  const POISON = 1007; // 400 на любом пакете с ним; здоровые половины WB отдаёт пустыми
  const env = createEnv({
    nmIds: { c1: range(1001, 80) },
    respond: (req, n) => (req.day !== OLD_DAY ? okResponse(req, n) : req.nmIds.includes(POISON) ? new Response('{"detail":"bad nmId"}', { status: 400 }) : emptyItems(req, n)),
  });
  env.store.set("c1", stateOf(olderDays(NIGHT)));

  const messages: string[] = [];
  let parkedAtNight: number | null = null;
  for (let night = 0; night < 14 && parkedAtNight === null; night += 1) {
    goToNight(env, night);
    const [result] = await env.run([makeTarget("c1")]);
    messages.push(result.message ?? "");
    assert.equal(env.state("c1").state.doneDays?.includes(OLD_DAY), false, `ночь ${night}: день без строк не закрыт`);
    if (env.state("c1").state.emptyDays?.[OLD_DAY] !== undefined) parkedAtNight = night;
  }
  assert.notEqual(parkedAtNight, null, "дыра сошлась к одному артикулу, отказ дошёл до охранника — и день отложен как пустой");

  const saved = env.state("c1").state;
  assert.equal(saved.partial?.[OLD_DAY], undefined, "перепроверка дыр окончена, день ждёт пробы");
  assert.equal(env.written.flat().filter((row) => row.snapshot_date === OLD_DAY).length, 0, "по дню строк нет — это и есть причина охранника");
  assert.equal(seoMeasuredByNight(saved, OLD_DAY, 1001), false, "ленивый роут может спросить WB сам");
  assert.ok(!messages.some((message) => /отказались/.test(message)), "об отказе не сказано: его не было");
  const [after] = await env.run([makeTarget("c1")]);
  assert.equal(after.abandonedSku, undefined);
  assert.equal(env.state("c1").state.doneDays?.includes(OLD_DAY), false);
});

test("v3.2 Отказ — только когда спрашивать больше нечего: каждая дыра одиночная и уже спрошена; пока не так, перепроверка идёт дальше", async () => {
  const STUCK = "2026-10-01";
  const nights = ["2026-09-30", "2026-10-01", "2026-10-02"]; // три ночи перепроверки уже были
  const env = createEnv({ nmIds: { c1: range(1001, 40) }, respond: (req, n) => (req.day === STUCK ? bad() : okResponse(req, n)) });
  const done = [...olderDays(NIGHT), YESTERDAY].filter((day) => day !== STUCK);
  env.store.set("c1", stateOf(done, {
    totalSku: 40,
    dayRowsByDay: { [STUCK]: 60 },
    partial: { [STUCK]: nights },
    holes: {
      [STUCK]: [
        { from: 1001, to: 1002, count: 2, tries: 1, triedAt: "2026-10-02T01:00:00.000Z" }, // пара: ещё не доделена до одного артикула
        { from: 1010, to: 1010, count: 1, tries: 0 }, // одиночная, но её ни разу не спрашивали
        { from: 1011, to: 1011, count: 1, tries: 1, triedAt: "2026-10-02T01:00:00.000Z" },
      ],
    },
  }));

  // Ночей достаточно, но спросить есть что: отказа нет, дыры спрашивают и делят.
  const [first] = await env.run([makeTarget("c1")]);
  assert.equal(first.abandonedSku, undefined, "отказ раньше времени отрезал бы 1001, 1002 и 1010, которых не спросили до конца");
  assert.equal(env.state("c1").state.doneDays?.includes(STUCK), false);
  assert.ok(env.requests.some((req) => req.day === STUCK), "дыры старого дня перепроверены");
  const afterFirst = env.state("c1").state.holes?.[STUCK] ?? [];
  assert.ok(afterFirst.length > 0 && afterFirst.every((hole) => hole.count === 1 && hole.triedAt), "теперь все дыры одиночные и спрошены");
  assert.deepEqual(afterFirst.map((hole) => hole.from).sort(), [1001, 1002, 1010, 1011]);

  // Следующая ночь: спрашивать больше нечего — отказ, и он называет все четыре артикула.
  goToNight(env, 1);
  const [second] = await env.run([makeTarget("c1")]);
  assert.equal(second.abandonedSku, 4);
  assert.equal(env.state("c1").state.doneDays?.includes(STUCK), true);
  assert.match(second.message ?? "", /отказались от 4 арт/);
});

test("v3.3 Перепроверка: обрезанный ответ, а живых артикулов среди пакета нет — дыра не исчезает вместе со строками, ответ записан и заметка дошла до журнала", async () => {
  const globalLimit: Responder = (req) => Response.json({ data: { items: range(0, 30).map((index) => item(req.nmIds[0], `запрос ${index}`)) } });
  // Воронка называет живым только артикул ВНЕ дыры: рассыпать дыру на живые нечем.
  const env = createEnv({ nmIds: { c1: range(1001, 40) }, active: { c1: [2001] }, respond: globalLimit });
  env.store.set("c1", stateOf(olderDays(NIGHT), {
    totalSku: 40,
    partial: { [YESTERDAY]: [] },
    holes: { [YESTERDAY]: [{ from: 1001, to: 1040, count: 40, tries: 1 }] },
  }));

  const [result] = await env.run([makeTarget("c1")]);
  assert.equal(env.written.flat().length, 30, "30 принятых строк записаны, а не выброшены вместе с дырой");
  assert.equal(env.state("c1").state.holes?.[YESTERDAY], undefined, "дыра закрыта принятым ответом");
  assert.equal(env.state("c1").state.doneDays?.includes(YESTERDAY), true);
  assert.equal(result.truncatedAccepted, true);
  assert.match(result.message ?? "", /ровно 30 строк/);
  const summary = summarizeSeoRun([result]);
  assert.equal(summary.status, "partial", "день закрыт обрезанным ответом: журнал не зелёный");
  assert.match(summary.logNote ?? "", /ровно 30 строк/, "заметка доходит до sync_log");
});

test("v3.3 Обрезанный ответ, принятый при пустом списке живых артикулов, красит журнал: вчера закрыт, но строки неполны", async () => {
  const respond: Responder = (req) => Response.json({ data: { items: range(0, 30).map((index) => item(req.nmIds[0], `запрос ${index}`)) } });
  const env = createEnv({ nmIds: { c1: range(1001, 18) }, active: { c1: [] }, respond });
  env.store.set("c1", stateOf(olderDays(NIGHT)));
  const [result] = await env.run([makeTarget("c1")]);
  assert.equal(result.yesterdayDone, true);
  assert.equal(result.truncatedAccepted, true);
  const summary = summarizeSeoRun([result]);
  assert.equal(summary.status, "partial");
  assert.match(summary.logNote ?? "", /ровно 30 строк/);
  // Без обрезки — тот же день зелёный.
  const clean = createEnv({ nmIds: { c1: range(1001, 18) }, active: { c1: [] } });
  clean.store.set("c1", stateOf(olderDays(NIGHT)));
  const [ok] = await clean.run([makeTarget("c1")]);
  assert.equal(ok.truncatedAccepted, undefined);
  assert.equal(summarizeSeoRun([ok]).status, "ok");
});

test("v3.4 Системный 400 считается внутри прогона: хоть один принятый ответ или другой сбой — это уже не он", async () => {
  // 400, 400, затем WB отвечает: три запроса не все отклонены — прогон идёт дальше, пакеты с 400 стали дырами.
  const env = createEnv({ nmIds: { c1: range(1001, 300) }, respond: (req, n) => (n <= 2 ? new Response("bad", { status: 400 }) : okResponse(req, n)) });
  env.store.set("c1", stateOf(olderDays(NIGHT)));
  const [result] = await env.run([makeTarget("c1")]);
  assert.ok(env.requests.length > SEO_SYSTEMATIC_400_REQUESTS, `прогон не остановлен: ${env.requests.length} запросов`);
  assert.notEqual(result.status, "error");
  assert.doesNotMatch(result.message ?? "", /отклонил все/);

  // 502, 400, 502: «все отказы — 400» не выполнено, правило не срабатывает (502 ведёт свою повторную логику).
  const mixed = createEnv({ nmIds: { c1: range(1001, 300) }, respond: (_req, n) => (n % 2 === 0 ? new Response("bad", { status: 400 }) : bad()) });
  mixed.store.set("c1", stateOf(olderDays(NIGHT)));
  const [mixedResult] = await mixed.run([makeTarget("c1")]);
  assert.doesNotMatch(mixedResult.message ?? "", /отклонил все/);

  // Состояния для правила не нужно: каждый прогон считает сам, и следующий прогон при том же 400 снова останавливается на трёх.
  const dead = createEnv({ nmIds: { c1: range(1001, 300) }, respond: () => new Response("bad", { status: 400 }) });
  dead.store.set("c1", stateOf(olderDays(NIGHT)));
  await dead.run([makeTarget("c1")]);
  dead.advance(30 * 60_000);
  const [second] = await dead.run([makeTarget("c1")]);
  assert.equal(second.status, "error");
  assert.equal(dead.requests.length, 2 * SEO_SYSTEMATIC_400_REQUESTS, "и во втором прогоне — три запроса, а не весь бюджет");
});

test("v3.8 Один ядовитый артикул — не системный 400: кабинет не останавливается, здоровые измерены", async () => {
  // Первая версия правила считала запросы и останавливала кабинет из-за ОДНОГО плохого артикула: пакет, его
  // половины и одиночка — все 400 подряд. Из 40 артикулов не измерялся ни один (при 39 здоровых).
  const POISON = 1003;
  const respond: Responder = (req, n) => (req.nmIds.includes(POISON) ? new Response("bad nmId", { status: 400 }) : okResponse(req, n));
  const env = createEnv({ nmIds: { c1: range(1001, 40) }, respond });
  env.store.set("c1", stateOf(olderDays(NIGHT)));
  // Одна ночь — восемь прогонов с шагом в полчаса: дыры вчерашнего дня делятся по несколько запросов за прогон.
  for (let run = 0; run < 8; run += 1) {
    const [result] = await env.run([makeTarget("c1")]);
    assert.notEqual(result.status, "error", `прогон ${run}: одного плохого артикула мало для остановки кабинета`);
    assert.doesNotMatch(result.message ?? "", /отклонил все/);
    env.advance(30 * 60_000);
  }
  const measured = new Set(env.written.flat().filter((row) => row.snapshot_date === YESTERDAY).map((row) => row.nm_id));
  assert.equal(measured.size, 39, "здоровые 39 артикулов вчерашнего дня измерены");
  assert.equal(measured.has(POISON), false);

  // Тот же ядовитый артикул в других днях и деление дыр вложены друг в друга — всё равно один независимый отказ.
  const many = createEnv({ nmIds: { c1: range(1001, 100) }, respond: (req, n) => (req.nmIds.includes(1007) ? new Response("bad", { status: 400 }) : okResponse(req, n)) });
  many.store.set("c1", stateOf(olderDays(NIGHT).slice(0, 20)));
  for (let night = 0; night < 3; night += 1) {
    const [run] = await many.run([makeTarget("c1")]);
    assert.notEqual(run.status, "error", `прогон ${night}: ядовитый артикул не даёт error`);
    many.advance(30 * 60_000);
  }
});

test("v3.7 Запись итогового состояния упала: заметки прогона (пустой день, дыры) остаются в message вместе с причиной", async () => {
  const env = createEnv({ nmIds: { c1: range(1001, 120) }, respond: emptyItems });
  env.store.set("c1", stateOf(olderDays(NIGHT)));
  const originalWrite = env.deps.writeState;
  // Промежуточные записи («running») проходят, итоговая — нет.
  env.deps.writeState = async (cabinetId, values) => (values.status === "running" ? originalWrite(cabinetId, values) : "db down");

  const [result] = await env.run([makeTarget("c1")]);
  assert.equal(result.status, "error");
  assert.match(result.message ?? "", /состояние: db down/);
  assert.match(result.message ?? "", /WB не вернул запросов за весь день/, "заметка о пустом дне не потеряна");
});
