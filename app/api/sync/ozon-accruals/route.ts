import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { readWbSyncState, writeWbSyncState } from "@/lib/wb/syncState";
import { flattenOzonAccrual } from "@/lib/ozon/accrualRows";
import { selectOzonAccrualQueueCabinet, type OzonAccrualQueueState } from "@/lib/ozon/accrualSyncQueue";
import {
  advanceAfterFailure,
  advanceAfterSuccess,
  initAccrualCursorState,
  MAX_DATE_ATTEMPTS,
  targetSyncDate,
  type OzonAccrualCursorState,
} from "@/lib/ozon/accrualSyncCursor";
import { ozonAccrualByDay, ozonPostings } from "@/lib/ozon/api";

export const maxDuration = 300;

const JOB = "ozon_accrual_report";
const BACKFILL_DAYS = 75;
const POSTINGS_WINDOW_DAYS = 30;

type OzonAccrualSyncState = OzonAccrualCursorState;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

function readCursorState(stored: Partial<OzonAccrualSyncState> | undefined): OzonAccrualCursorState {
  if (stored?.backfillFloor && stored?.pendingDate) {
    return {
      backfillFloor: stored.backfillFloor,
      pendingDate: stored.pendingDate,
      pendingAttempts: stored.pendingAttempts ?? 0,
    };
  }
  return initAccrualCursorState(isoDate(daysAgo(BACKFILL_DAYS)));
}

/**
 * Одна дата на прогон, один кабинет на прогон — намеренно консервативно.
 * Ozon лимитирует по секундам (см. 429 при параллельных вызовах в разведке
 * API), и WB-аналог (opiu-report) держится того же принципа: лучше медленный
 * бэкфилл, чем оборванная на середине сеть.
 *
 * Курсор начислений (см. lib/ozon/accrualSyncCursor.ts) двигается на +1 день
 * только после того, как день реально прочитан целиком: без обрезки
 * пагинацией и без ошибок разбора строк. Отправления синкуются отдельным
 * скользящим окном, без своего курсора — это отдельный, не постраничный по
 * датам эндпоинт Ozon, и его сбой не должен блокировать бэкфилл начислений.
 */
export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });

  const { data: cabinets, error: cabinetsError } = await db
    .from("wb_cabinets")
    .select("id, name, client_id, token")
    .eq("marketplace", "ozon")
    .eq("is_active", true);
  if (cabinetsError) return NextResponse.json({ error: cabinetsError.message }, { status: 502 });
  if (!cabinets?.length) return NextResponse.json({ error: "Нет активных кабинетов Ozon" }, { status: 503 });

  const cabinetIds = cabinets.map((row) => String(row.id));
  const { data: syncRows, error: syncStateError } = await db
    .from("wb_sync_state")
    .select("cabinet_id, status, updated_at")
    .in("cabinet_id", cabinetIds)
    .eq("job", JOB);
  if (syncStateError) return NextResponse.json({ error: syncStateError.message }, { status: 502 });

  const queueStates: OzonAccrualQueueState[] = (syncRows ?? []).map((row) => ({
    cabinetId: String(row.cabinet_id),
    status: String(row.status ?? "pending"),
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  }));
  const cabinetId = selectOzonAccrualQueueCabinet(cabinetIds, queueStates);
  if (!cabinetId) return NextResponse.json({ error: "Не удалось выбрать кабинет" }, { status: 503 });

  const cabinet = cabinets.find((row) => String(row.id) === cabinetId)!;
  const creds = { clientId: String(cabinet.client_id), apiKey: String(cabinet.token) };

  const previous = await readWbSyncState<OzonAccrualSyncState>(db, cabinetId, JOB);
  const cursorState = readCursorState(previous?.state);
  const yesterday = isoDate(daysAgo(1));
  const syncDate = targetSyncDate(cursorState, yesterday);
  const runStartedAt = new Date().toISOString();

  const accrualResult = await ozonAccrualByDay(creds, syncDate);

  if (!accrualResult.ok) {
    if (accrualResult.rateLimited) {
      // 429 не двигает курсор — следующий часовой тик повторит тот же день,
      // это нормальный бэк-офф, а не сбой синка.
      await writeWbSyncState(db, cabinetId, JOB, {
        cursor: previous?.cursor ?? null,
        status: "rate_limited",
        attempts: (previous?.attempts ?? 0) + 1,
        lastError: accrualResult.error,
        state: cursorState,
      });
      return NextResponse.json({ cabinetId, date: syncDate, error: accrualResult.error }, { status: 200 });
    }

    const { state: nextState, gaveUp } = advanceAfterFailure(cursorState, syncDate);
    await writeWbSyncState(db, cabinetId, JOB, {
      cursor: previous?.cursor ?? null,
      status: "error",
      attempts: (previous?.attempts ?? 0) + 1,
      lastError: gaveUp
        ? `${accrualResult.error} (сдались после ${MAX_DATE_ATTEMPTS} попыток, дата ${syncDate} пропущена)`
        : accrualResult.error,
      state: nextState,
    });
    return NextResponse.json(
      { cabinetId, date: syncDate, error: accrualResult.error, gaveUpOnDate: gaveUp },
      { status: 502 },
    );
  }

  let flattenErrors = 0;
  const accrualRows = accrualResult.accruals.flatMap((raw) => {
    try {
      return flattenOzonAccrual(raw as Parameters<typeof flattenOzonAccrual>[0]).map((row) => ({
        cabinet_id: cabinetId,
        ...row,
        updated_at: runStartedAt,
      }));
    } catch {
      flattenErrors += 1;
      return [];
    }
  });

  if (accrualRows.length) {
    const { error } = await db
      .from("ozon_accrual_rows")
      .upsert(accrualRows, { onConflict: "cabinet_id,accrual_id,sku,type_id" });
    if (error) {
      await writeWbSyncState(db, cabinetId, JOB, {
        cursor: previous?.cursor ?? null,
        status: "error",
        attempts: (previous?.attempts ?? 0) + 1,
        lastError: error.message,
        state: cursorState,
      });
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
  }

  // Честно: день считается прочитанным целиком только без обрезки пагинацией
  // и без ошибок разбора — иначе рано и продвигать курсор, и удалять
  // "устаревшие" строки (мы не знаем, что реально устарело, а что просто ещё
  // не прочли).
  const dayFullyRead = !accrualResult.truncated && flattenErrors === 0;

  if (dayFullyRead) {
    const { error: staleError } = await db
      .from("ozon_accrual_rows")
      .delete()
      .eq("cabinet_id", cabinetId)
      .eq("date", syncDate)
      .lt("updated_at", runStartedAt);
    if (staleError) {
      await writeWbSyncState(db, cabinetId, JOB, {
        cursor: previous?.cursor ?? null,
        status: "error",
        attempts: (previous?.attempts ?? 0) + 1,
        lastError: staleError.message,
        state: cursorState,
      });
      return NextResponse.json({ error: staleError.message }, { status: 502 });
    }
  }

  const postingsFrom = isoDate(daysAgo(POSTINGS_WINDOW_DAYS));
  const { postings, errors: postingErrors } = await ozonPostings(
    creds,
    `${postingsFrom}T00:00:00.000Z`,
    new Date().toISOString(),
  );
  // created_at может прийти пустой строкой (ни created_at, ни in_process_at в
  // ответе) — колонка NOT NULL, такую строку не пишем, а считаем и сообщаем.
  const postingRows = postings
    .filter((posting) => posting.createdAt)
    .map((posting) => ({
      cabinet_id: cabinetId,
      posting_number: posting.postingNumber,
      scheme: posting.scheme,
      order_number: posting.orderNumber,
      status: posting.status,
      created_at: posting.createdAt,
      amount: posting.amount,
      units: posting.units,
      updated_at: runStartedAt,
    }));
  const skippedPostings = postings.length - postingRows.length;

  if (postingRows.length) {
    const { error } = await db
      .from("ozon_postings")
      .upsert(postingRows, { onConflict: "cabinet_id,posting_number" });
    if (error) {
      await writeWbSyncState(db, cabinetId, JOB, {
        cursor: previous?.cursor ?? null,
        status: "error",
        attempts: (previous?.attempts ?? 0) + 1,
        lastError: error.message,
        state: cursorState,
      });
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
  }

  let gaveUpOnDate = false;
  let nextCursorState: OzonAccrualCursorState;
  if (dayFullyRead) {
    nextCursorState = advanceAfterSuccess(cursorState, syncDate);
  } else {
    const result = advanceAfterFailure(cursorState, syncDate);
    nextCursorState = result.state;
    gaveUpOnDate = result.gaveUp;
  }

  const dayIssues = [
    accrualResult.truncated ? `день ${syncDate} обрезан потолком пагинации` : null,
    flattenErrors ? `${flattenErrors} начислений не разобрались` : null,
    gaveUpOnDate ? `сдались после ${MAX_DATE_ATTEMPTS} попыток, дата ${syncDate} пропущена` : null,
    postingErrors.length ? `postings: ${postingErrors.join("; ")}` : null,
  ].filter(Boolean);

  await writeWbSyncState(db, cabinetId, JOB, {
    cursor: syncDate,
    status: dayFullyRead ? "ok" : "partial",
    attempts: 0,
    lastError: dayIssues.length ? dayIssues.join("; ").slice(0, 500) : null,
    state: nextCursorState,
  });

  return NextResponse.json({
    cabinetId,
    date: syncDate,
    accrualRows: accrualRows.length,
    truncated: accrualResult.truncated,
    flattenErrors,
    dayFullyRead,
    gaveUpOnDate,
    postingRows: postingRows.length,
    skippedPostings,
    postingErrors,
  });
}
