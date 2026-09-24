import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { readWbSyncState, writeWbSyncState } from "@/lib/wb/syncState";
import { flattenOzonAccrual } from "@/lib/ozon/accrualRows";
import { selectOzonAccrualQueueCabinet, type OzonAccrualQueueState } from "@/lib/ozon/accrualSyncQueue";
import { ozonAccrualByDay, ozonPostings } from "@/lib/ozon/api";

export const maxDuration = 60;

const JOB = "ozon_accrual_report";
const BACKFILL_DAYS = 75;

interface OzonAccrualSyncState extends Record<string, unknown> {
  cursorDate?: string;
  backfillFloor?: string;
  backfillComplete?: boolean;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

/**
 * Одна дата на прогон, один кабинет на прогон — намеренно консервативно.
 * Ozon лимитирует по секундам (см. 429 при параллельных вызовах в разведке
 * API), и WB-аналог (opiu-report) держится того же принципа: лучше медленный
 * бэкфилл, чем оборванная на середине сеть.
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
  const backfillFloor = previous?.state.backfillFloor ?? isoDate(daysAgo(BACKFILL_DAYS));
  const backfillComplete = previous?.state.backfillComplete ?? false;
  const syncDate = backfillComplete
    ? isoDate(daysAgo(1))
    : (previous?.state.cursorDate ?? isoDate(daysAgo(1)));

  const accrualResult = await ozonAccrualByDay(creds, syncDate);
  if (!accrualResult.ok) {
    await writeWbSyncState(db, cabinetId, JOB, {
      cursor: previous?.cursor ?? null,
      status: accrualResult.rateLimited ? "rate_limited" : "error",
      attempts: (previous?.attempts ?? 0) + 1,
      lastError: accrualResult.error,
      state: previous?.state ?? { backfillFloor, backfillComplete },
    });
    // 429 не двигает курсор — следующий часовой тик повторит тот же день, и
    // это не сбой синка, а нормальный бэк-офф. Настоящий сбой (не 429)
    // тоже не двигает курсор, но помечается 502, чтобы Vercel не считал
    // прогон зелёным при неподвижных данных.
    return NextResponse.json(
      { cabinetId, date: syncDate, error: accrualResult.error },
      { status: accrualResult.rateLimited ? 200 : 502 },
    );
  }

  const accrualRows = accrualResult.accruals.flatMap((raw) => {
    try {
      return flattenOzonAccrual(raw as Parameters<typeof flattenOzonAccrual>[0]).map((row) => ({
        cabinet_id: cabinetId,
        ...row,
        updated_at: new Date().toISOString(),
      }));
    } catch {
      return [];
    }
  });

  if (accrualRows.length) {
    const { error } = await db
      .from("ozon_accrual_rows")
      .upsert(accrualRows, { onConflict: "cabinet_id,accrual_id,sku,type_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  }

  const { postings, errors: postingErrors } = await ozonPostings(
    creds,
    `${syncDate}T00:00:00.000Z`,
    `${syncDate}T23:59:59.999Z`,
  );
  const postingRows = postings.map((posting) => ({
    cabinet_id: cabinetId,
    posting_number: posting.postingNumber,
    scheme: posting.scheme,
    order_number: posting.orderNumber,
    status: posting.status,
    created_at: posting.createdAt,
    amount: posting.amount,
    units: posting.units,
    updated_at: new Date().toISOString(),
  }));
  if (postingRows.length) {
    const { error } = await db
      .from("ozon_postings")
      .upsert(postingRows, { onConflict: "cabinet_id,posting_number" });
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  }

  const nextCursorDate = isoDate(new Date(Date.parse(`${syncDate}T00:00:00.000Z`) - 86_400_000));
  const nowComplete = backfillComplete || nextCursorDate < backfillFloor;

  await writeWbSyncState(db, cabinetId, JOB, {
    cursor: syncDate,
    status: "ok",
    attempts: 0,
    lastError: postingErrors.length ? postingErrors.join("; ").slice(0, 500) : null,
    state: {
      backfillFloor,
      backfillComplete: nowComplete,
      cursorDate: nowComplete ? isoDate(daysAgo(1)) : nextCursorDate,
    },
  });

  return NextResponse.json({
    cabinetId,
    date: syncDate,
    accrualRows: accrualRows.length,
    postingRows: postingRows.length,
    backfillComplete: nowComplete,
    postingErrors,
  });
}
