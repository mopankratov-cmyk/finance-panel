import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth, writeSyncLog } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { ozonAccrualTypes } from "@/lib/ozon/api";
import { parseAccrualTypeRows } from "@/lib/ozon/accrualTypesCache";

export const maxDuration = 30;

/**
 * Справочник категорий Ozon кабинето-независим — годится любой активный
 * Ozon-кабинет только для авторизации запроса, сами данные от него не
 * зависят. Раз в сутки достаточно (справочник у Ozon меняется редко).
 */
export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });

  const { data: cabinets, error: cabinetsError } = await db
    .from("wb_cabinets")
    .select("client_id, token")
    .eq("marketplace", "ozon")
    .eq("is_active", true)
    .limit(1);
  if (cabinetsError) {
    await writeSyncLog("ozon_accrual_types", "error", null, cabinetsError.message, startedAt);
    return NextResponse.json({ error: cabinetsError.message }, { status: 502 });
  }
  const cabinet = cabinets?.[0];
  if (!cabinet) {
    return NextResponse.json({ error: "Нет активных кабинетов Ozon" }, { status: 503 });
  }

  const result = await ozonAccrualTypes({ clientId: String(cabinet.client_id), apiKey: String(cabinet.token) });
  if (!result.ok) {
    await writeSyncLog("ozon_accrual_types", "error", null, result.error, startedAt);
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  const rows = parseAccrualTypeRows(result.types, startedAt);
  if (rows.length) {
    const { error } = await db.from("ozon_accrual_types").upsert(rows, { onConflict: "type_id" });
    if (error) {
      await writeSyncLog("ozon_accrual_types", "error", rows.length, error.message, startedAt);
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
  }

  await writeSyncLog("ozon_accrual_types", "ok", rows.length, null, startedAt);
  return NextResponse.json({ types: rows.length });
}
