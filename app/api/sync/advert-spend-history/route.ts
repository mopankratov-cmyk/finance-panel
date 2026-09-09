import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { checkCronAuth, chunkedUpsertWithOptionalColumns, writeSyncLog } from "@/lib/sync/helpers";
import { getWbSyncTargets, type SyncTarget } from "@/lib/sync/cabinets";
import { claimWbSyncJob, writeWbSyncState } from "@/lib/wb/syncState";
import { getAdvertSpendHistory, type AdvertSpendHistoryItem } from "@/lib/wb/advertApi";

export const maxDuration = 60;

const JOB = "advert_spend_history";
// Небольшой объём (десятки-сотни строк на кабинет в неделю) — забираем
// разом за фиксированное окно, без курсора/бэкфилла по частям, как у
// более тяжёлых отчётов (funnel, paid-storage). Идемпотентно — upsert.
const WINDOW_DAYS = 30;

function rowId(cabinetId: string, item: AdvertSpendHistoryItem): string {
  return [cabinetId, item.advertId ?? "", item.updTime ?? "", item.paymentType ?? "", item.updNum ?? ""].join("|");
}

interface CabinetResult {
  cabinet: string;
  status: string;
  scanned?: number;
  rows?: number;
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
  from: string,
  to: string,
): Promise<CabinetResult> {
  const cabinetId = target.cabinetId;
  if (!cabinetId) return { cabinet: target.name, status: "skipped" };

  if (!(await claimWbSyncJob(db, cabinetId, JOB, 15 * 60))) {
    return { cabinet: target.name, status: "running" };
  }

  const res = await getAdvertSpendHistory(target.advertToken, from, to);
  if (!res.ok) {
    if (res.rateLimited) {
      await writeWbSyncState(db, cabinetId, JOB, { status: "running", attempts: 0, lastError: null, state: {} });
      return { cabinet: target.name, status: "deferred" };
    }
    await writeWbSyncState(db, cabinetId, JOB, { status: "error", attempts: 1, lastError: res.message, state: {} });
    throw new Error(res.message);
  }

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
  if (upsertError) {
    await writeWbSyncState(db, cabinetId, JOB, { status: "error", attempts: 1, lastError: upsertError, state: {} });
    throw new Error(`запись wb_advert_spend_history: ${upsertError}`);
  }

  await writeWbSyncState(db, cabinetId, JOB, {
    status: "caught_up",
    attempts: 0,
    lastError: null,
    state: { lastRunAt: new Date().toISOString(), rowsLoaded: rows.length, scanned: items.length },
  });
  return { cabinet: target.name, status: "ok", scanned: items.length, rows: rows.length };
}

export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const allTargets = await getWbSyncTargets();
  const onlyCabinet = request.nextUrl.searchParams.get("cabinet");
  const targets = onlyCabinet ? allTargets.filter((t) => t.cabinetId === onlyCabinet) : allTargets;
  if (!targets.length) {
    return NextResponse.json({ error: "Нет активных кабинетов" }, { status: 500 });
  }

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const to = toDate.toISOString().slice(0, 10);
  const from = fromDate.toISOString().slice(0, 10);

  const settled = await Promise.allSettled(targets.map((target) => processCabinet(db, target, from, to)));

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
