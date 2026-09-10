import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { getWbSyncTargets, type SyncTarget } from "@/lib/sync/cabinets";
import { OPIU_CABINET_IDS } from "@/lib/opiu/constants";
import { claimWbSyncJob, readWbSyncState, writeWbSyncState } from "@/lib/wb/syncState";
import { isWbGlobalRateLimit } from "@/lib/wb/rateLimit";
import {
  checkPaidStorageTaskStatus,
  createPaidStorageTask,
  downloadPaidStorageTask,
  type PaidStorageApiRow,
} from "@/lib/wb/paidStorageRequest";

export const maxDuration = 60;

const JOB = "paid_storage";
// WB отдаёт «Платное хранение» с задержкой в 1-2 суток — вчерашний день ещё
// может быть не досчитан, поэтому не запрашиваем его сразу.
const REPORT_LAG_DAYS = 2;
// Небольшое окно за запрос — быстрее закрывает разрывы и меньше данных
// теряется при ошибке одной задачи. Было 7, потом 3 — для Retail Family
// (общий кабинет сразу на несколько брендов: Norvia, Heaton и другие) даже
// 3 дня оказались тяжелы: ~3200 строк/день, то есть под 10 000 строк за
// окно — download + upsert такого объёма всё ещё обрывался 504 уже ПОСЛЕ
// того, как данные фактически записались (видно по приросту строк в базе).
// 1 день — компромисс: для этого кабинета это тоже несколько тысяч строк,
// но заметно безопаснее; для лёгких кабинетов (Панкратов/Кучеренко) просто
// на один шаг больше кругов, там это не проблема — они и так уже дошли до
// июля.
const WINDOW_DAYS = 1;
const HISTORY_DEPTH_DAYS = 180;

interface PaidStorageJobState extends Record<string, unknown> {
  taskId?: string;
  periodStart?: string;
  periodEnd?: string;
  createdAt?: string;
  /**
   * Бэкфилл идёт от СЕГОДНЯ НАЗАД, а не от истории вперёд: пользователю
   * важна прежде всего текущая/прошлая неделя в ОПиУ, а не глубина
   * истории. frontier — самая ранняя уже загруженная дата; следующее окно
   * берётся сразу перед ней. Без этого первая неделя после мёржа PR ждала
   * бы своей очереди несколько суток, пока догоняется 180-дневная история.
   */
  frontier?: string;
  historyStart?: string;
  lastRunAt?: string;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

function rowId(cabinetId: string, row: PaidStorageApiRow): string {
  const date = String(row.date ?? "").slice(0, 10);
  // officeId (склад) обязателен в ключе: WB хранит один и тот же товар/
  // поставку одновременно на нескольких складах — без officeId такие строки
  // (тот же date/barcode/giId/chrtId/calcType, разный склад) схлопывались в
  // один id, и upsert падал с "ON CONFLICT DO UPDATE command cannot affect
  // row a second time" (два разных склада внутри одного чанка).
  return [cabinetId, date, row.barcode ?? "", row.giId ?? "", row.chrtId ?? "", row.calcType ?? "", row.officeId ?? ""].join("|");
}

interface CabinetResult {
  cabinet: string;
  status: string;
  rows?: number;
  taskId?: string;
  period?: { periodStart: string; periodEnd: string };
}

/**
 * Обрабатывает один кабинет: если задачи нет — создаёт и опрашивает статус
 * ВНУТРИ этого же вызова (не ждёт следующего часового тика). Раньше между
 * "создали задачу" и "проверили статус" проходил целый час (следующий крон) —
 * а WB, как выяснилось, "protухает" готовый отчёт (purged) быстрее часа, если
 * никто его не забрал. Из-за этого бэкфилл застревал НАВСЕГДА на первом же
 * окне: задача успевала протухнуть раньше, чем мы успевали её скачать, и
 * следующий тик просто пересоздавал её заново — по кругу, без прогресса.
 */
async function processCabinet(
  db: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  target: SyncTarget,
  cabinetId: string,
  today: string,
  maxAllowedDate: string,
): Promise<CabinetResult> {
  const saved = await readWbSyncState<PaidStorageJobState>(db, cabinetId, JOB);
  let state: PaidStorageJobState = saved?.state ?? {};
  let attempts = saved?.attempts ?? 0;

  if (!state.taskId) {
    const historyStart = state.historyStart ?? addDays(today, -HISTORY_DEPTH_DAYS);
    const periodEnd = state.frontier ? addDays(state.frontier, -1) : maxAllowedDate;
    if (periodEnd < historyStart) {
      await writeWbSyncState(db, cabinetId, JOB, {
        cursor: state.frontier ?? null,
        status: "caught_up",
        attempts: 0,
        lastError: null,
        state: { ...state, historyStart, lastRunAt: new Date().toISOString() },
      });
      return { cabinet: target.name, status: "caught_up" };
    }
    const windowStart = addDays(periodEnd, -(WINDOW_DAYS - 1));
    const periodStart = windowStart < historyStart ? historyStart : windowStart;

    const created = await createPaidStorageTask(target.statsToken, periodStart, periodEnd);
    if (!created.ok) {
      const rateLimited = isWbGlobalRateLimit(created.status, created.body);
      if (rateLimited) return { cabinet: target.name, status: "deferred" };
      await writeWbSyncState(db, cabinetId, JOB, {
        cursor: state.frontier ?? null,
        status: "error",
        attempts: attempts + 1,
        lastError: created.body,
        state: { ...state, historyStart },
      });
      throw new Error(`создание задачи WB ${created.status}: ${created.body}`);
    }

    state = { ...state, taskId: created.taskId, periodStart, periodEnd, historyStart, createdAt: new Date().toISOString() };
    attempts = 0;
    await writeWbSyncState(db, cabinetId, JOB, {
      cursor: state.frontier ?? null,
      status: "backfill",
      attempts: 0,
      lastError: null,
      state,
    });
  }

  const taskId = state.taskId!;

  // РОВНО ОДНА проверка статуса за вызов — без sleep/поллинга внутри
  // функции. Версия с циклом (создать → ждать до N секунд не отпуская
  // обработчик) на практике так и не завершилась ни разу за несколько
  // прогонов: состояние в базе не обновлялось по 3+ минуты после старта,
  // хотя мягкий бюджет был выставлен всего на 35с — значит настоящий
  // жёсткий лимит этой среды заметно строже, чем 60с maxDuration, и
  // синхронный sleep() внутри функции, похоже, сам по себе плохо уживается
  // с этим лимитом. Каждый вызов теперь — один быстрый шаг (одна проверка
  // статуса, максимум один запрос к WB) и сразу возврат; следующий тик
  // крона (или ручной вызов) продолжает с того места, где остановились.
  const statusRes = await checkPaidStorageTaskStatus(target.statsToken, taskId);
  if (!statusRes.ok) {
    const rateLimited = isWbGlobalRateLimit(statusRes.status, statusRes.body);
    if (rateLimited) return { cabinet: target.name, status: "deferred", taskId };
    await writeWbSyncState(db, cabinetId, JOB, {
      cursor: state.frontier ?? null,
      status: "error",
      attempts: attempts + 1,
      lastError: statusRes.body,
      state,
    });
    throw new Error(`статус задачи WB ${statusRes.status}: ${statusRes.body}`);
  }

  if (statusRes.status === "purged" || statusRes.status === "canceled") {
    // Забываем taskId — следующий вызов создаст новую задачу на то же окно.
    await writeWbSyncState(db, cabinetId, JOB, {
      cursor: state.frontier ?? null,
      status: "backfill",
      attempts: attempts + 1,
      lastError: `задача WB ${statusRes.status}`,
      state: { ...state, taskId: undefined, lastRunAt: new Date().toISOString() },
    });
    return { cabinet: target.name, status: statusRes.status, taskId };
  }

  if (statusRes.status !== "done") {
    // "processing" ИЛИ "unknown" (WB прислал строку статуса вне нашего
    // известного набора) — трактуем как "ещё не готово", НЕ как мёртвую
    // задачу: раньше "unknown" сразу убивал задачу и создавал новую на то
    // же окно, из-за чего бэкфилл вечно топтался на первом окне, ни разу
    // не дав задаче шанс дойти до "done". rawStatus идёт в lastError как
    // диагностика (если "unknown"), не как сигнал к пересозданию.
    await writeWbSyncState(db, cabinetId, JOB, {
      cursor: state.frontier ?? null,
      status: "backfill",
      attempts: 0,
      lastError: statusRes.status === "unknown"
        ? `диагностика: неизвестный статус задачи WB (raw: ${statusRes.rawStatus})`
        : null,
      state: { ...state, lastRunAt: new Date().toISOString() },
    });
    return { cabinet: target.name, status: statusRes.status, taskId };
  }

  const download = await downloadPaidStorageTask(target.statsToken, taskId);
  if (!download.ok) {
    const rateLimited = isWbGlobalRateLimit(download.status, download.body);
    if (rateLimited) return { cabinet: target.name, status: "deferred", taskId };
    await writeWbSyncState(db, cabinetId, JOB, {
      cursor: state.frontier ?? null,
      status: "error",
      attempts: attempts + 1,
      lastError: download.body,
      state,
    });
    throw new Error(`скачивание WB ${download.status}: ${download.body}`);
  }

  // Только то, что реально используется: lib/opiu/paidStorage.ts считает
  // "Хранение" по date/vendor_code/warehouse_price, а gi_id/chrt_id/
  // office_id/calc_type/barcode нужны исключительно для rowId (WB не даёт
  // свой id строки). subject/brand/warehouse(текст)/size/volume/
  // barcodes_count нигде не читаются — не отправляем их в payload вообще:
  // WB всё равно генерирует и качает отчёт целиком (сократить сам download
  // так нельзя, это его сторона), но payload на upsert в базу становится
  // заметно легче на тысячах строк.
  const mappedRows = download.rows.map((row) => ({
    id: rowId(cabinetId, row),
    cabinet_id: cabinetId,
    date: String(row.date ?? "").slice(0, 10),
    vendor_code: row.vendorCode ?? null,
    barcode: row.barcode ?? null,
    office_id: row.officeId ?? null,
    gi_id: row.giId ?? null,
    chrt_id: row.chrtId ?? null,
    calc_type: row.calcType ?? null,
    warehouse_price: row.warehousePrice ?? 0,
    synced_at: new Date().toISOString(),
  })).filter((r) => r.date);

  // Защита от "ON CONFLICT DO UPDATE command cannot affect row a second
  // time": если у WB найдётся ещё одно измерение строки, которое rowId не
  // учитывает, дубль внутри одного upsert уронит всю пачку.
  const rows = [...new Map(mappedRows.map((r) => [r.id, r])).values()];

  // Крупный chunk (100КБ вместо дефолтных 20КБ) — меньше round-trip'ов к
  // Supabase на тысячах строк; сама запись, а не только скачивание, была
  // частью того, что не укладывалось в бюджет функции для больших кабинетов.
  const upsertError = await chunkedUpsert("wb_paid_storage_rows", rows, "id", 100_000);
  if (upsertError) {
    await writeWbSyncState(db, cabinetId, JOB, {
      cursor: state.frontier ?? null,
      status: "error",
      attempts: attempts + 1,
      lastError: upsertError,
      state,
    });
    throw new Error(`запись wb_paid_storage_rows: ${upsertError}`);
  }

  const frontier = state.periodStart ?? state.frontier ?? maxAllowedDate;
  const historyStart = state.historyStart ?? addDays(today, -HISTORY_DEPTH_DAYS);
  await writeWbSyncState(db, cabinetId, JOB, {
    cursor: frontier,
    status: frontier <= historyStart ? "caught_up" : "backfill",
    attempts: 0,
    lastError: null,
    state: { ...state, taskId: undefined, frontier, historyStart, lastRunAt: new Date().toISOString() },
  });

  return {
    cabinet: target.name,
    status: "downloaded",
    rows: rows.length,
    period: { periodStart: state.periodStart!, periodEnd: state.periodEnd! },
  };
}

export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  // «Платное хранение» нужно только ОПиУ — только 3 кабинета из OPIU_BRANDS,
  // не весь аккаунт (Оптима/Слоёно и другие сюда не относятся, тянуть их
  // здесь — впустую жечь лимиты WB API и время крона без всякой пользы).
  const allTargets = (await getWbSyncTargets()).filter((t) => t.cabinetId && OPIU_CABINET_IDS.has(t.cabinetId));
  const onlyCabinet = request.nextUrl.searchParams.get("cabinet");
  const targets = onlyCabinet ? allTargets.filter((t) => t.cabinetId === onlyCabinet) : allTargets;
  if (!targets.length) {
    return NextResponse.json({ error: "Нет активных кабинетов" }, { status: 500 });
  }

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const today = isoDate(new Date());
  const maxAllowedDate = addDays(today, -REPORT_LAG_DAYS);

  /**
   * Кабинеты — разные токены/аккаунты, друг от друга рейт-лимитом WB не
   * связаны. Раньше обрабатывались последовательно (for): крупный кабинет
   * (Retail Family — на порядок больше строк, чем у отдельных ИП) мог
   * занять большую часть бюджета функции на одном скачивании, и кабинеты,
   * идущие следом в очереди (Оптима, Слоёно), просто не успевали получить
   * свой черёд в течение того же вызова — их прогресс не двигался вообще,
   * хотя каждый по отдельности обрабатывался бы быстро. Обрабатываем
   * параллельно: общее время ограничено самым медленным кабинетом, а не
   * суммой всех.
   */
  async function runOneCabinet(
    dbClient: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
    target: SyncTarget,
  ): Promise<{ cabinetId: string | null; result?: CabinetResult; error?: string }> {
    const db = dbClient;
    const cabinetId = target.cabinetId;
    if (!cabinetId) return { cabinetId: null };

    if (!(await claimWbSyncJob(db, cabinetId, JOB, 15 * 60))) {
      return { cabinetId, result: { cabinet: target.name, status: "running" } };
    }

    try {
      const result = await processCabinet(db, target, cabinetId, today, maxAllowedDate);
      return { cabinetId, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Раньше необработанное исключение (например, таймаут запроса к WB)
      // оставляло claimWbSyncJob замок "running" висеть на все 15 минут:
      // processCabinet сам пишет состояние только на "чистых" ветках, а
      // брошенное исключение эту запись пропускало. Снимаем замок сразу,
      // сохраняя существующий прогресс (taskId и т.п.).
      try {
        const current = await readWbSyncState<PaidStorageJobState>(db, cabinetId, JOB);
        await writeWbSyncState(db, cabinetId, JOB, {
          cursor: current?.cursor ?? null,
          status: "error",
          attempts: (current?.attempts ?? 0) + 1,
          lastError: message,
          state: current?.state ?? {},
        });
      } catch {
        // Не удалось даже это — переживёт stale-recovery через 15 минут.
      }
      return { cabinetId, error: `${target.name}: ${message}` };
    }
  }

  const settled = await Promise.all(targets.map((target) => runOneCabinet(db, target)));

  let total = 0;
  const errors: string[] = [];
  const deferred: string[] = [];
  const progress: CabinetResult[] = [];
  for (const outcome of settled) {
    if (!outcome.cabinetId) continue;
    if (outcome.error) {
      errors.push(outcome.error);
      continue;
    }
    if (!outcome.result) continue;
    progress.push(outcome.result);
    if (outcome.result.status === "deferred") deferred.push(`${outcome.result.cabinet}: лимит WB`);
    if (outcome.result.status === "downloaded") total += outcome.result.rows ?? 0;
  }

  const nothingCollected = total === 0 && progress.every((p) => p.status !== "downloaded");
  const allDeferred = deferred.length > 0 && nothingCollected;
  const ok = errors.length === 0 && !allDeferred;
  const logNote = errors.join("; ") || (allDeferred ? `не обновлено: ${deferred.join("; ")}` : null);
  await writeSyncLog(JOB, ok ? "ok" : "error", total, logNote, startedAt);

  return NextResponse.json({ ok, total, progress, errors, deferred });
}
