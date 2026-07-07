import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth, writeSyncLog } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { validateMoySkladToken } from "@/lib/moysklad/api";

export const maxDuration = 30;

// Заглушка: интеграция МойСклад подключается через форму на /supplies (таб «Источник»),
// но импорт товаров/остатков в product_costs/wb_stocks ещё не реализован — нет решения,
// что именно и как маппить. Job пока только проверяет, что сохранённый токен ещё
// валиден, и пишет статус в sync_log/moysklad_connection — чтобы подключение было
// видно живым на /sync, не просто «сохранили токен и забыли».
// Не добавлен в JOBS (app/api/sync/all) — нечего гонять ежедневно, пока нет реального
// импорта; вызывается вручную (кнопка «Проверить соединение» на /supplies).
export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;
  const startedAt = new Date();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: true, rows: 0, connected: false });

  const { data: conn } = await db.from("moysklad_connection").select("*").eq("is_active", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!conn) {
    await writeSyncLog("moysklad", "ok", 0, "МойСклад не подключён (заглушка, нет активного токена)", startedAt);
    return NextResponse.json({ ok: true, rows: 0, connected: false });
  }

  const v = await validateMoySkladToken(conn.token as string);
  const note = v.ok
    ? `Заглушка: токен валиден (${v.accountName ?? "МойСклад"}), импорт данных ещё не реализован`
    : `Токен МойСклад больше не работает: ${v.error}`;
  await db.from("moysklad_connection").update({ last_sync_at: new Date().toISOString(), last_sync_error: v.ok ? null : v.error }).eq("id", conn.id as number);
  await writeSyncLog("moysklad", v.ok ? "ok" : "error", 0, note, startedAt);
  return NextResponse.json({ ok: v.ok, rows: 0, connected: true, note });
}
