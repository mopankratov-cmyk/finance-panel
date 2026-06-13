import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { OzonCreds } from "@/lib/ozon/api";

// Креды активного Ozon-кабинета из БД (общий для всех Ozon-эндпоинтов).
export async function getActiveOzonCreds(cabinetId?: string | null): Promise<
  { ok: true; creds: OzonCreds; name: string } | { ok: false; error: string }
> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Supabase не настроен" };
  let q = db.from("wb_cabinets").select("id, name, client_id, token").eq("marketplace", "ozon").eq("is_active", true);
  if (cabinetId) q = q.eq("id", cabinetId);
  const { data } = await q.limit(1);
  const cab = data?.[0];
  if (!cab?.client_id || !cab?.token) return { ok: false, error: "Нет подключённого Ozon-кабинета" };
  return { ok: true, creds: { clientId: cab.client_id as string, apiKey: cab.token as string }, name: cab.name as string };
}
