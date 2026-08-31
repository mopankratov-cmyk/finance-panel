import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth, writeSyncLog } from "@/lib/sync/helpers";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isOzonPerformanceReportDeferredMessage,
  perfDailySpend,
  perfProductReport,
  type PerfProductReportResumeState,
} from "@/lib/ozon/performance";
import { OZON_AD_CABINET_TOTAL_SKU, OZON_AD_EMPTY_DAY_SKU } from "@/lib/ozon/adDailyMarkers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildOzonAdSyncWarningNotes, selectOzonAdSyncCabinets } from "@/lib/ozon/adSyncPlan";
import { claimWbSyncJob, readWbSyncState, writeWbSyncState } from "@/lib/wb/syncState";

export const maxDuration = 300;

type OzonCabinet = {
  id: string;
  name: string;
  client_id: string;
  perf_client_id: string | null;
  perf_secret: string | null;
};

type OzonAdSyncResult = {
  cabinet: string;
  ok: boolean;
  rows: number;
  partial: boolean;
  deferred: boolean;
  error: string | null;
};

interface OzonAdvertSyncState extends Record<string, unknown> {
  report?: PerfProductReportResumeState;
  /** Дозаполнение истории: один день за заход, недоигранный отчёт хранится тут. */
  backfill?: { day: string; report: PerfProductReportResumeState | null; misses?: number };
  lastSyncedAt?: string;
  lastRunAt?: string;
}

/** Глубина суточных итогов: столько же, сколько максимальный период экранов. */
const DAILY_TOTALS_DAYS = 92;
const BACKFILL_WINDOW_DAYS = 28;

/**
 * Дозаполнение истории расхода: один день за заход.
 *
 * Отчёт Performance отдаёт артикулы только суммой за запрошенный период —
 * разбивку по датам он присылает без sku (проверено на проде). Значит день
 * добывается единственным способом: заказать обычный отчёт с периодом в один
 * день. Ozon ограничивает частоту заказов, поэтому берём по одному дню, от
 * свежих к старым, — свежие дни закрывают больше реальных периодов на экранах.
 */
async function backfillOneDay(
  db: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  cabinet: OzonCabinet,
  saved: { day: string; report: PerfProductReportResumeState | null; misses?: number } | undefined,
): Promise<{ state: { day: string; report: PerfProductReportResumeState | null; misses?: number } | null; rows: number; note: string | null }> {
  if (!cabinet.perf_client_id || !cabinet.perf_secret) return { state: null, rows: 0, note: null };

  // Какой день брать: продолжаем недоигранный, иначе — самый свежий из
  // отсутствующих за окно (вчера и старше: сегодняшний день ещё идёт).
  let day = saved?.day ?? null;
  if (!day) {
    const till = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const since = new Date(Date.now() - BACKFILL_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
    // Собранным день считается по строкам ТОВАРОВ. Итог кабинета (`*`)
    // приходит сразу за весь квартал, и если считать его признаком сбора,
    // дозаполнение решит, что собирать больше нечего, — разнесение по товарам
    // не наполнится уже никогда.
    const { data: haveRows } = await db
      .from("ozon_ad_daily")
      .select("date")
      .eq("client_id", cabinet.client_id)
      .neq("sku", OZON_AD_CABINET_TOTAL_SKU)
      .gte("date", since)
      .lte("date", till);
    const have = new Set((haveRows ?? []).map((row) => String(row.date)));
    for (let offset = 1; offset <= BACKFILL_WINDOW_DAYS; offset++) {
      const candidate = new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
      if (!have.has(candidate)) { day = candidate; break; }
    }
  }
  if (!day) return { state: null, rows: 0, note: null };

  // Зависший заказ пересдаём: день 26.08 провисел в NOT_STARTED два часа,
  // пока заказанные позже отчёты спокойно обгоняли его. Три захода без
  // прогресса — заказываем день заново.
  const misses = saved?.misses ?? 0;
  const resumeReport = misses >= 3 ? null : saved?.report ?? null;
  const report = await perfProductReport(
    { clientId: cabinet.perf_client_id, secret: cabinet.perf_secret },
    `${day}T00:00:00.000Z`,
    `${day}T23:59:59.999Z`,
    10_000,
    { allowPending: true, resumeState: resumeReport, pollAttempts: 8, maxBatchesPerRun: 2, createRetries: 1, createRetryDelayMs: 20_000 },
  );
  if (!report) return { state: { day, report: resumeReport, misses: misses + 1 }, rows: 0, note: `история ${day}: отчёт не получен` };
  if (!report.complete) {
    const reordered = misses >= 3;
    return {
      state: { day, report: report.resumeState, misses: reordered ? 0 : misses + 1 },
      rows: 0,
      note: `история ${day}: ${reordered ? "пересдан заказ" : "ещё готовится"}`,
    };
  }
  const updatedAt = new Date().toISOString();
  const rows = Object.entries(report.bySku).map(([sku, value]) => ({
    client_id: cabinet.client_id,
    sku,
    date: day,
    spent: Math.round(value.spent),
    orders_money: Math.round(value.ordersMoney),
    updated_at: updatedAt,
  }));
  // День без расхода записываем маркером, чтобы не заказывать его снова. Но
  // если суточный итог кабинета за этот день ненулевой, «пусто» будет ложью:
  // расход был, просто разнесение по товарам не пришло. Такой день оставляем
  // несобранным — его переспросят.
  let payload = rows;
  if (!rows.length) {
    const { data: totalRow } = await db
      .from("ozon_ad_daily")
      .select("spent")
      .eq("client_id", cabinet.client_id)
      .eq("sku", OZON_AD_CABINET_TOTAL_SKU)
      .eq("date", day)
      .maybeSingle();
    if (Number(totalRow?.spent ?? 0) > 0) {
      return { state: null, rows: 0, note: `история ${day}: расход есть, разнесение Ozon не отдал` };
    }
    payload = [{
      client_id: cabinet.client_id, sku: OZON_AD_EMPTY_DAY_SKU, date: day, spent: 0, orders_money: 0, updated_at: updatedAt,
    }];
  }
  const { error } = await db.from("ozon_ad_daily").upsert(payload, { onConflict: "client_id,sku,date" });
  if (error) return { state: { day, report: null }, rows: 0, note: `история ${day}: ${error.message}` };
  return { state: null, rows: rows.length, note: `история ${day}: ${rows.length} строк` };
}

// Ozon analytics/stocks читаются из почасовых снимков. Эта задача каждый час
// обновляет Performance-рекламу. Один async-отчёт Ozon может занимать до 45с,
// поэтому почасовой cron берёт самый старый/отсутствующий кеш; ручной ?all=1
// оставлен для окружений с увеличенным лимитом функции.
/**
 * Посуточные итоги кабинета — за весь квартал, одним дешёвым запросом.
 *
 * Разнесение расхода по товарам Ozon отдаёт асинхронными отчётами: один
 * отчёт в минуту, батчами по десять кампаний, днями. А сумму по кабинету за
 * каждый день он отдаёт сразу — обычным GET без очереди. Пока мы ждали
 * разнесения, экраны стояли с нулями при полностью доступных данных.
 *
 * Пишем эти суммы служебной строкой `*`: она не участвует в разрезе по
 * товарам, но закрывает вопрос «сколько потрачено» на любом периоде.
 */
async function syncCabinetDailyTotals(
  db: SupabaseClient,
  cabinet: { client_id: string; perf_client_id: string; perf_secret: string },
  todayIso: string,
): Promise<{ days: number; note: string | null }> {
  const creds = { clientId: cabinet.perf_client_id, secret: cabinet.perf_secret };
  const rows: Array<{ client_id: string; sku: string; date: string; spent: number; orders_money: number; updated_at: string }> = [];
  const updatedAt = new Date().toISOString();
  let failedChunks = 0;
  // Просим кусками по 30 дней: длинные диапазоны Ozon иногда обрезает молча.
  for (let offset = 0; offset < DAILY_TOTALS_DAYS; offset += 30) {
    const to = new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
    const from = new Date(Date.now() - Math.min(DAILY_TOTALS_DAYS, offset + 30) * 86_400_000).toISOString().slice(0, 10);
    const daily = await perfDailySpend(creds, from, to);
    if (!daily) {
      // Уже полученные куски не выбрасываем: половина истории лучше, чем
      // ничего, а недостающее доберёт следующий заход.
      failedChunks += 1;
      continue;
    }
    for (const [day, value] of Object.entries(daily.byDate)) {
      // Сегодняшний день ещё идёт — в историю он не попадает никогда.
      if (day >= todayIso) continue;
      rows.push({
        client_id: cabinet.client_id,
        sku: OZON_AD_CABINET_TOTAL_SKU,
        date: day,
        spent: Math.round(value.spent),
        orders_money: Math.round(value.ordersMoney),
        updated_at: updatedAt,
      });
    }
  }
  if (!rows.length) return { days: 0, note: failedChunks ? "суточные итоги: Performance не ответил" : null };
  const unique = [...new Map(rows.map((row) => [row.date, row])).values()];
  const { error } = await db.from("ozon_ad_daily").upsert(unique, { onConflict: "client_id,sku,date" });
  if (error) return { days: 0, note: `суточные итоги: ${error.message}` };
  return {
    days: unique.length,
    note: failedChunks ? `суточные итоги: ${unique.length} дн., ${failedChunks} кусков не пришло` : null,
  };
}

export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 503 });

  const { data, error } = await db
    .from("wb_cabinets")
    .select("id, name, client_id, perf_client_id, perf_secret")
    .eq("marketplace", "ozon")
    .eq("is_active", true);
  if (error) {
    await writeSyncLog("ozon-adverts", "error", 0, error.message, startedAt);
    return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
  }

  const allCabinets = (data ?? []) as OzonCabinet[];
  const requestedId = request.nextUrl.searchParams.get("cabinet");
  const runAll = request.nextUrl.searchParams.get("all") === "1";
  const eligibleCabinets = requestedId
    ? allCabinets.filter((cabinet) => cabinet.id === requestedId || cabinet.client_id === requestedId)
    : allCabinets;
  if (requestedId && !eligibleCabinets.length) {
    return NextResponse.json({ ok: false, error: "Ozon-кабинет не найден" }, { status: 404 });
  }

  const cacheUpdated = new Map<string, string | null>();
  if (eligibleCabinets.length) {
    const { data: cacheRows } = await db
      .from("ozon_ad_cache")
      .select("client_id, updated_at")
      .in("client_id", eligibleCabinets.map((cabinet) => cabinet.client_id))
      .order("updated_at", { ascending: false });
    for (const row of cacheRows ?? []) {
      const clientId = String(row.client_id ?? "");
      if (clientId && !cacheUpdated.has(clientId)) cacheUpdated.set(clientId, String(row.updated_at ?? "") || null);
    }
  }

  const requestedLimit = Number(request.nextUrl.searchParams.get("limit"));
  const runLimit = requestedId || runAll
    ? eligibleCabinets.length
    : Number.isFinite(requestedLimit) && requestedLimit > 0
      ? requestedLimit
      : 1;
  const cabinets = selectOzonAdSyncCabinets(eligibleCabinets, cacheUpdated, runLimit);
  const plannedIds = new Set(cabinets.map((cabinet) => cabinet.id));
  const skipped = eligibleCabinets.filter((cabinet) => !plannedIds.has(cabinet.id)).map((cabinet) => cabinet.name);

  const to = new Date().toISOString();
  // Сегодняшний день в историю не пишем НИКОГДА: он ещё идёт, и его расход в
  // отчёте окна заведомо частичный. Записанный один раз, он выглядел бы для
  // дозаполнения «уже собранным» — и частичная цифра осталась бы в истории
  // навсегда.
  const todayIso = to.slice(0, 10);
  const historyOnly = <T extends { date: string }>(rows: T[]) => rows.filter((row) => row.date < todayIso);
  const from = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const results: OzonAdSyncResult[] = await Promise.all(cabinets.map(async (cabinet) => {
    const saved = await readWbSyncState<OzonAdvertSyncState>(db, cabinet.id, "ozon-adverts");
    // Снимок состояния читается ОДИН раз, а во время захода состояние меняется:
    // сохранённые UUID заказанных отчётов лежат именно в нём. Записывать поверх
    // прочитанный до старта снимок значило терять свежие заказы — следующий
    // заход создавал их заново и жёг лимит «один отчёт в минуту».
    let liveState: OzonAdvertSyncState = { ...(saved?.state ?? {}) } as OzonAdvertSyncState;
    let totalsNote: string | null = null;
    try {
      if (!cabinet.client_id || !cabinet.perf_client_id || !cabinet.perf_secret) {
        throw new Error("Нет Ozon Performance API");
      }
      // Суточные итоги — ПЕРВЫМ делом и всегда: они дешёвые, приходят сразу за
      // весь квартал и не зависят от очереди отчётов. Даже если разнесение по
      // товарам сегодня не доедет, сумма расхода на экранах будет верной.
      const totals = await syncCabinetDailyTotals(db, {
        client_id: cabinet.client_id,
        perf_client_id: cabinet.perf_client_id,
        perf_secret: cabinet.perf_secret,
      }, todayIso);
      totalsNote = totals.note ?? (totals.days ? `суточных итогов: ${totals.days}` : null);
      // Свежее окно не пересобираем. Период отчёта сдвигается каждым заходом,
      // поэтому «продолжить» его нельзя — только заказать заново все 5-7
      // батчей. Час назад собранное окно этого не стоит, а заход целиком
      // достаётся истории по дням — ради неё пользователь и ждёт.
      const cacheAgeMs = (() => {
        const updated = cacheUpdated.get(cabinet.client_id);
        return updated ? Date.now() - new Date(updated).getTime() : Number.POSITIVE_INFINITY;
      })();
      const mainPending = Boolean(saved?.state.report);
      // Четыре часа: окно — сумма за 14 дней, пара часов дрейфа в ней ~1%.
      // С порогом в 90 минут почасовой крон успевал состарить кэш и каждый
      // второй заход пересобирал окно вместо истории — история почти стояла.
      // Сутки: окно теперь запасной путь (экраны читают дни), а его
      // пересборка стоит 4-7 отчётов Performance и душит дозаполнение.
      if (!mainPending && cacheAgeMs < 24 * 60 * 60_000) {
        if (!(await claimWbSyncJob(db, cabinet.id, "ozon-adverts", 6 * 60))) {
          return { cabinet: cabinet.name, ok: false, rows: 0, partial: false, deferred: true, error: "Синхронизация уже выполняется" };
        }
        let backfillNote: string | null = null;
        let backfillState = saved?.state.backfill ?? undefined;
        let backfillRows = 0;
        // До двух дней за заход — больше не влезает в лимит функции (300 с)
        // с ожиданиями между заказами. Недоигранный день продолжается,
        // готовый освобождает место следующему; состояние сохраняем после
        // каждого дня, чтобы обрыв по времени не потерял заказанный отчёт.
        for (let i = 0; i < 2; i++) {
          const backfill = await backfillOneDay(db, cabinet, backfillState);
          backfillNote = backfill.note ?? backfillNote;
          backfillState = backfill.state ?? undefined;
          backfillRows += backfill.rows;
          await writeWbSyncState(db, cabinet.id, "ozon-adverts", {
            status: "caught_up",
            attempts: 0,
            lastError: null,
            state: (liveState = { ...liveState, lastRunAt: new Date().toISOString(), backfill: backfillState }),
          });
          if (backfill.state || !backfill.note) break; // день не доигран или дни кончились
        }
        await writeWbSyncState(db, cabinet.id, "ozon-adverts", {
          status: "caught_up",
          attempts: 0,
          lastError: null,
          state: (liveState = { ...liveState, lastRunAt: new Date().toISOString(), backfill: backfillState }),
        });
        return {
          cabinet: cabinet.name,
          ok: true,
          rows: backfillRows,
          partial: false,
          deferred: false,
          error: [totalsNote, backfillNote ? backfillNote : "окно свежее; история заполнена"].filter(Boolean).join("; "),
        };
      }
      if (!(await claimWbSyncJob(db, cabinet.id, "ozon-adverts", 6 * 60))) {
        return { cabinet: cabinet.name, ok: false, rows: 0, partial: false, deferred: true, error: "Синхронизация уже выполняется" };
      }
      // Незавершённый отчёт продолжаем с тем же периодом. Иначе ежедневный
      // сдвиг 14-дневного окна делал бы сохранённый UUID несовместимым.
      const reportFrom = saved?.state.report?.periodFrom ?? from;
      const reportTo = saved?.state.report?.periodTo ?? to;
      const report = await perfProductReport(
        { clientId: cabinet.perf_client_id, secret: cabinet.perf_secret },
        reportFrom,
        reportTo,
        10_000,
        {
          throwOnError: true,
          allowPending: true,
          resumeState: saved?.state.report ?? null,
          pollAttempts: 30,
          maxBatchesPerRun: 4,
          createRetries: 3,
          createRetryDelayMs: 30_000,
          onState: async (reportState) => {
            const stateError = await writeWbSyncState(db, cabinet.id, "ozon-adverts", {
              status: "running",
              attempts: 0,
              lastError: null,
              state: (liveState = { ...liveState, report: reportState, lastRunAt: new Date().toISOString() }),
            });
            if (stateError) throw new Error(`состояние ozon-adverts: ${stateError}`);
          },
        },
      );
      if (!report) throw new Error("Performance report failed");

      // Незавершённый отчёт всё равно несёт данные завершённых батчей, и они
      // накапливаются: каждый заход отдаёт сумму по ВСЕМ готовым батчам, а не
      // по одному. Раньше эти данные лежали мёртвым грузом, пока не доедет
      // последний батч, — на кабинете с пятью батчами это часы ожидания при
      // пустой колонке рекламы. Пишем то, что есть; следующий заход перезапишет
      // теми же ключами, но большей суммой.
      const partialDaily = Object.entries(report.byDay ?? {}).flatMap(([date, perSku]) =>
        Object.entries(perSku).map(([sku, value]) => ({
          client_id: cabinet.client_id,
          sku,
          date,
          spent: Math.round(value.spent),
          orders_money: Math.round(value.ordersMoney),
          updated_at: new Date().toISOString(),
        })));
      const partialHistory = historyOnly(partialDaily);
      if (!report.complete && partialHistory.length) {
        await db.from("ozon_ad_daily").upsert(partialHistory, { onConflict: "client_id,sku,date" });
      }
      if (!report.complete) {
        const message = `Performance report: ${report.errors.join("; ") || "нет готовых батчей"}`;
        await writeWbSyncState(db, cabinet.id, "ozon-adverts", {
          // UUID и готовые батчи уже сохранены. pending снимает lease после
          // возврата функции и позволяет следующему cron/ручному запуску сразу
          // продолжить отчёт, не создавая новый.
          status: "pending",
          attempts: 0,
          lastError: message,
          state: (liveState = { ...liveState, report: report.resumeState, lastRunAt: new Date().toISOString() }),
        });
        return { cabinet: cabinet.name, ok: false, rows: partialDaily.length, partial: true, deferred: true, error: message };
      }

      const syncedAt = new Date().toISOString();
      const rows = Object.entries(report.bySku).map(([sku, value]) => ({
        client_id: cabinet.client_id,
        sku,
        days: 14,
        spent: Math.round(value.spent),
        orders_money: Math.round(value.ordersMoney),
        updated_at: syncedAt,
      }));
      // Посуточные строки: скользящее окно отвечает только за свои N дней, а
      // экраны спрашивают произвольные периоды. Пишем и то, и другое, пока
      // дни копятся.
      const dailyRows = Object.entries(report.byDay ?? {}).flatMap(([date, perSku]) =>
        Object.entries(perSku).map(([sku, value]) => ({
          client_id: cabinet.client_id,
          sku,
          date,
          spent: Math.round(value.spent),
          orders_money: Math.round(value.ordersMoney),
          updated_at: syncedAt,
        })));
      const dailyHistory = historyOnly(dailyRows);
      if (dailyHistory.length) {
        const { error: dailyError } = await db
          .from("ozon_ad_daily")
          .upsert(dailyHistory, { onConflict: "client_id,sku,date" });
        if (dailyError) throw new Error(dailyError.message);
      }
      if (rows.length) {
        const { error: upsertError } = await db
          .from("ozon_ad_cache")
          .upsert(rows, { onConflict: "client_id,sku,days" });
        if (upsertError) throw new Error(upsertError.message);
      }
      // Основной отчёт готов — остатком захода добираем один день истории.
      // Ошибка дозаполнения не валит заход: окно и так обновлено.
      let backfillNote: string | null = null;
      let backfillState = saved?.state.backfill ?? undefined;
      try {
        const backfill = await backfillOneDay(db, cabinet, backfillState);
        backfillNote = backfill.note;
        backfillState = backfill.state ?? undefined;
      } catch (backfillError) {
        backfillNote = `история: ${backfillError instanceof Error ? backfillError.message : String(backfillError)}`;
      }
      const stateError = await writeWbSyncState(db, cabinet.id, "ozon-adverts", {
        status: "caught_up",
        attempts: 0,
        lastError: null,
        state: { lastSyncedAt: syncedAt, lastRunAt: syncedAt, backfill: backfillState },
      });
      if (stateError) throw new Error(`состояние ozon-adverts: ${stateError}`);
      const noteParts = [
        totalsNote,
        report.errors.length ? report.errors.join("; ") : null,
        backfillNote,
      ].filter(Boolean);
      return {
        cabinet: cabinet.name,
        ok: true,
        rows: rows.length,
        partial: report.partial,
        deferred: false,
        error: noteParts.length ? noteParts.join("; ") : null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await writeWbSyncState(db, cabinet.id, "ozon-adverts", {
        status: isOzonPerformanceReportDeferredMessage(message) ? "pending" : "error",
        attempts: isOzonPerformanceReportDeferredMessage(message) ? 0 : (saved?.attempts ?? 0) + 1,
        lastError: message,
        state: (liveState = { ...liveState, lastRunAt: new Date().toISOString() }),
      });
      return {
        cabinet: cabinet.name,
        ok: false,
        rows: 0,
        partial: false,
        deferred: isOzonPerformanceReportDeferredMessage(message),
        error: message,
      };
    }
  }));

  const deferred = results.filter((result) => !result.ok && result.deferred);
  const failures = results.filter((result) => !result.ok && !result.deferred);
  const total = results.reduce((sum, result) => sum + result.rows, 0);
  const partial = results.filter((result) => result.partial).map((result) => result.cabinet);
  const notes = buildOzonAdSyncWarningNotes(results);
  const ok = failures.length === 0;
  await writeSyncLog("ozon-adverts", ok ? "ok" : "error", total, notes.join("; ") || null, startedAt);
  return NextResponse.json(
    {
      ok,
      rows: total,
      cabinets: cabinets.length,
      availableCabinets: allCabinets.length,
      skipped,
      results,
      warnings: [...partial, ...deferred.map((result) => result.cabinet)],
    },
    { status: ok ? 200 : 502 },
  );
}
