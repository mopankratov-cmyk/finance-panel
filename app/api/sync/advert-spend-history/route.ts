import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { getWbSyncTargets } from "@/lib/sync/cabinets";
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

  let total = 0;
  const errors: string[] = [];
  const progress: Array<Record<string, unknown>> = [];

  for (const target of targets) {
    if (!target.cabinetId) continue;
    const cabinetId = target.cabinetId;

    if (!(await claimWbSyncJob(db, cabinetId, JOB, 15 * 60))) {
      progress.push({ cabinet: target.name, status: "running", skipped: true });
      continue;
    }

    try {
      const res = await getAdvertSpendHistory(target.advertToken, from, to);
      if (!res.ok) {
        if (res.rateLimited) {
          progress.push({ cabinet: target.name, status: "deferred" });
          await writeWbSyncState(db, cabinetId, JOB, { status: "running", attempts: 0, lastError: null, state: {} });
          continue;
        }
        errors.push(`${target.name}: ${res.message}`);
        await writeWbSyncState(db, cabinetId, JOB, { status: "error", attempts: 1, lastError: res.message, state: {} });
        continue;
      }

      const items = Array.isArray(res.data) ? res.data : [];
      const rows = items
        .map((item) => ({
          id: rowId(cabinetId, item),
          cabinet_id: cabinetId,
          advert_id: item.advertId ?? null,
          campaign_name: item.campaignName ?? null,
          payment_type: String(item.paymentType ?? "").trim(),
          amount: item.updSum ?? 0,
          doc_number: item.updNum ?? null,
          charged_at: item.updTime ?? null,
          date: item.updTime ? String(item.updTime).slice(0, 10) : null,
          synced_at: new Date().toISOString(),
        }))
        .filter((r) => r.advert_id && r.charged_at && r.date && r.payment_type);

      const upsertError = await chunkedUpsert("wb_advert_spend_history", rows, "id");
      if (upsertError) {
        errors.push(`${target.name}: запись wb_advert_spend_history: ${upsertError}`);
        await writeWbSyncState(db, cabinetId, JOB, { status: "error", attempts: 1, lastError: upsertError, state: {} });
        continue;
      }

      total += rows.length;
      await writeWbSyncState(db, cabinetId, JOB, {
        status: "caught_up",
        attempts: 0,
        lastError: null,
        state: { lastRunAt: new Date().toISOString(), rowsLoaded: rows.length, scanned: items.length },
      });
      progress.push({ cabinet: target.name, status: "ok", scanned: items.length, rows: rows.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${target.name}: ${message}`);
      await writeWbSyncState(db, cabinetId, JOB, { status: "error", attempts: 1, lastError: message, state: {} });
    }
  }

  const ok = errors.length === 0;
  await writeSyncLog(JOB, ok ? "ok" : "error", total, errors.join("; ") || null, startedAt);

  return NextResponse.json({ ok, total, progress, errors });
}
