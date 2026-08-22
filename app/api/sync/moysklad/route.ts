import { NextRequest, NextResponse } from "next/server";
import { validateMoySkladToken } from "@/lib/moysklad/api";
import { checkCronAuth, writeSyncLog } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const maxDuration = 60;

// Периодический кабинетный healthcheck. Не импортирует ассортимент и не может
// смешать аккаунты: каждая активная строка привязана к своему WB cabinet_id.
export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;
  const startedAt = new Date();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: true, rows: 0, connected: false });
  const { data: connections, error } = await db.from("moysklad_connection").select("id, cabinet_id, token, account_name").eq("is_active", true).not("cabinet_id", "is", null);
  if (error) {
    await writeSyncLog("moysklad", "error", 0, error.message, startedAt);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!connections?.length) {
    await writeSyncLog("moysklad", "ok", 0, "Нет активных кабинетных подключений МойСклад", startedAt);
    return NextResponse.json({ ok: true, rows: 0, connected: false });
  }

  const results: { cabinetId: string; ok: boolean; error: string | null }[] = [];
  for (const connection of connections) {
    const validation = await validateMoySkladToken(String(connection.token));
    const message = validation.ok ? null : validation.error;
    await db.from("moysklad_connection").update({ last_sync_at: new Date().toISOString(), last_sync_error: message }).eq("id", connection.id);
    results.push({ cabinetId: String(connection.cabinet_id), ok: validation.ok, error: message });
  }
  const failed = results.filter((result) => !result.ok);
  const note = failed.length ? `Ошибок подключений: ${failed.length} из ${results.length}` : `Проверено кабинетных подключений: ${results.length}`;
  await writeSyncLog("moysklad", failed.length ? "error" : "ok", results.length, note, startedAt);
  return NextResponse.json({ ok: failed.length === 0, rows: results.length, connected: true, results, note }, { status: failed.length ? 502 : 200 });
}
