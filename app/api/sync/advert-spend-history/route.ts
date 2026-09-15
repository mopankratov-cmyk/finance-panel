import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { checkCronAuth, chunkedUpsertWithOptionalColumns, writeSyncLog } from "@/lib/sync/helpers";
import { getWbSyncTargets, type SyncTarget } from "@/lib/sync/cabinets";
import { OPIU_CABINET_IDS } from "@/lib/opiu/constants";
import { claimWbSyncJob, readWbSyncState, writeWbSyncState } from "@/lib/wb/syncState";
import { getAdvertSpendHistory, type AdvertSpendHistoryItem } from "@/lib/wb/advertApi";

export const maxDuration = 60;

const JOB = "advert_spend_history";
// Окно за один шаг: этот отчёт синхронный (не задача-с-опросом, как
// paid-storage) — можно смело забирать месяц за один запрос.
const WINDOW_DAYS = 30;
const HISTORY_DEPTH_DAYS = 180;

/**
 * Раньше синк держал только скользящее окно "последние 30 дней от сегодня"
 * без курсора/бэкфилла — как только день выпадал за пределы окна, данные по
 * нему пропадали из зоны внимания синка навсегда (не были удалены из базы,
 * но и не обновлялись, а первоначально могли не грузиться вовсе для
 * периодов старше 30 дней на момент первого запуска). Из-за этого ОПиУ за
 * прошлые месяцы показывал заниженную "Рекламу" — данных просто не было.
 *
 * Два курсора — тот же паттерн, что и в paid-storage (см. её PR):
 * frontier — бэкфилл вглубь истории; newestSynced — свежие дни всегда
 * актуальны, синк каждый прогон сначала проверяет их и досинхронизирует
 * в приоритете, не трогая backfill-прогресс.
 */
interface AdvertSpendJobState extends Record<string, unknown> {
  frontier?: string;
  newestSynced?: string;
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

function rowId(cabinetId: string, item: AdvertSpendHistoryItem): string {
  return [cabinetId, item.advertId ?? "", item.updTime ?? "", item.paymentType ?? "", item.updNum ?? ""].join("|");
}

interface CabinetResult {
  cabinet: string;
  status: string;
  scanned?: number;
  rows?: number;
  period?: { from: string; to: string };
}

async function fetchAndStore(
  db: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  target: SyncTarget,
  cabinetId: string,
  from: string,
  to: string,
): Promise<{ ok: true; scanned: number; rows: number } | { ok: false; rateLimited: boolean; message: string }> {
  const res = await getAdvertSpendHistory(target.advertToken, from, to);
  if (!res.ok) return { ok: false, rateLimited: Boolean(res.rateLimited), message: res.message };

  const items = Array.isArray(res.data) ? res.data : [];
  const rows = items
    .map((item) => ({
      id: rowId(cabinetId, item),
      cabinet_id: cabinetId,
      advert_id: item.advertId ?? null,
      // Точное имя JSON-поля не подтверждено (см. AdvertSpendHistoryItem) —
      // берём первое непустое среди кандидатов, raw хранит весь объект,
      // чтобы поправить без гадания, если ни один кандидат не совпал.
      campaign_name: item.campaignName ?? item.campName ?? item.advertName ?? item.name ?? null,
      payment_type: String(item.paymentType ?? "").trim(),
      amount: item.updSum ?? 0,
      doc_number: item.updNum ?? null,
      charged_at: item.updTime ?? null,
      date: item.updTime ? String(item.updTime).slice(0, 10) : null,
      raw: item,
      synced_at: new Date().toISOString(),
    }))
    .filter((r) => r.advert_id && r.charged_at && r.date && r.payment_type);

  const { error: upsertError } = await chunkedUpsertWithOptionalColumns("wb_advert_spend_history", rows, "id", ["raw"]);
  if (upsertError) return { ok: false, rateLimited: false, message: `запись wb_advert_spend_history: ${upsertError}` };

  return { ok: true, scanned: items.length, rows: rows.length };
}

/**
 * Кабинеты — разные токены/аккаунты, друг от друга рейт-лимитом WB не
 * связаны. Раньше обрабатывались последовательно (for), и при нескольких
 * кабинетах суммарное время (до 30с на запрос — TIMEOUT_MS в advertApi.ts —
 * на каждый) легко превышало maxDuration=60 и весь прогон падал по таймауту
 * Vercel, не записав вообще ничего. Обрабатываем параллельно — общее время
 * ограничено самым медленным кабинетом, а не суммой всех.
 */
async function processCabinet(
  db: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  target: SyncTarget,
  today: string,
): Promise<CabinetResult> {
  const cabinetId = target.cabinetId;
  if (!cabinetId) return { cabinet: target.name, status: "skipped" };

  if (!(await claimWbSyncJob(db, cabinetId, JOB, 15 * 60))) {
    return { cabinet: target.name, status: "running" };
  }

  // Необработанное исключение внутри этого блока раньше (см. paid-storage,
  // тот же класс бага) оставляло "running" залипшим на все staleAfterSeconds
  // без единой диагностической записи — оборачиваем в try/catch с явной
  // перезаписью в "error", сохраняя уже накопленный state.
  try {
    return await runCabinetStep(db, target, cabinetId, today);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const saved = await readWbSyncState<AdvertSpendJobState>(db, cabinetId, JOB);
    await writeWbSyncState(db, cabinetId, JOB, {
      status: "error",
      attempts: (saved?.attempts ?? 0) + 1,
      lastError: message,
      state: saved?.state ?? {},
    });
    throw e;
  }
}

async function runCabinetStep(
  db: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  target: SyncTarget,
  cabinetId: string,
  today: string,
): Promise<CabinetResult> {
  const saved = await readWbSyncState<AdvertSpendJobState>(db, cabinetId, JOB);
  const state: AdvertSpendJobState = saved?.state ?? {};
  const historyStart = state.historyStart ?? addDays(today, -HISTORY_DEPTH_DAYS);

  const isRecentCaughtUp = Boolean(state.newestSynced) && state.newestSynced! >= today;

  let from: string;
  let to: string;
  let mode: "recent" | "backfill" | "done";

  if (!isRecentCaughtUp) {
    mode = "recent";
    to = today;
    from = state.newestSynced ? addDays(state.newestSynced, 1) : addDays(today, -(WINDOW_DAYS - 1));
  } else {
    const frontier = state.frontier ?? today;
    if (frontier <= historyStart) {
      mode = "done";
      from = to = frontier;
    } else {
      mode = "backfill";
      to = addDays(frontier, -1);
      const windowStart = addDays(to, -(WINDOW_DAYS - 1));
      from = windowStart < historyStart ? historyStart : windowStart;
    }
  }

  if (mode === "done") {
    await writeWbSyncState(db, cabinetId, JOB, {
      status: "caught_up",
      attempts: 0,
      lastError: null,
      state: { ...state, historyStart, lastRunAt: new Date().toISOString() },
    });
    return { cabinet: target.name, status: "caught_up" };
  }

  const result = await fetchAndStore(db, target, cabinetId, from, to);
  if (!result.ok) {
    if (result.rateLimited) {
      await writeWbSyncState(db, cabinetId, JOB, { status: "running", attempts: 0, lastError: null, state });
      return { cabinet: target.name, status: "deferred" };
    }
    await writeWbSyncState(db, cabinetId, JOB, { status: "error", attempts: 1, lastError: result.message, state });
    throw new Error(result.message);
  }

  const nextState: AdvertSpendJobState = mode === "recent"
    ? { ...state, newestSynced: to, historyStart, lastRunAt: new Date().toISOString() }
    : { ...state, frontier: from, historyStart, lastRunAt: new Date().toISOString() };

  await writeWbSyncState(db, cabinetId, JOB, {
    status: mode === "backfill" && from <= historyStart ? "caught_up" : "backfill",
    attempts: 0,
    lastError: null,
    state: nextState,
  });
  return { cabinet: target.name, status: "ok", scanned: result.scanned, rows: result.rows, period: { from, to } };
}

export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  // "История затрат" нужна только ОПиУ — только 3 кабинета из OPIU_BRANDS,
  // не весь аккаунт (см. тот же фильтр в app/api/sync/paid-storage).
  const allTargets = (await getWbSyncTargets()).filter((t) => t.cabinetId && OPIU_CABINET_IDS.has(t.cabinetId));
  const onlyCabinet = request.nextUrl.searchParams.get("cabinet");
  const targets = onlyCabinet ? allTargets.filter((t) => t.cabinetId === onlyCabinet) : allTargets;
  if (!targets.length) {
    return NextResponse.json({ error: "Нет активных кабинетов" }, { status: 500 });
  }

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const today = isoDate(new Date());

  const settled = await Promise.allSettled(targets.map((target) => processCabinet(db, target, today)));

  let total = 0;
  const errors: string[] = [];
  const progress: CabinetResult[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      progress.push(result.value);
      total += result.value.rows ?? 0;
    } else {
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      errors.push(`${targets[index]!.name}: ${message}`);
    }
  });

  const ok = errors.length === 0;
  await writeSyncLog(JOB, ok ? "ok" : "error", total, errors.join("; ") || null, startedAt);

  return NextResponse.json({ ok, total, progress, errors });
}
