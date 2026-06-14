import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ?cabinet=<uuid> → uuid | null (для RPC p_cabinet). Пустое/"all"/мусор → null (все кабинеты).
export function cabinetIdFromParam(v: string | null | undefined): string | null {
  return v && UUID.test(v) ? v : null;
}

// Сегмент пути РНП → кабинет. uuid активного WB-кабинета → его id + имя.
// "all" / "ip" / "" / неизвестное → null (все кабинеты).
export async function resolveShopCabinet(shop: string | undefined): Promise<{ cabinetId: string | null; label: string | undefined }> {
  if (!shop || !UUID.test(shop)) return { cabinetId: null, label: undefined };
  const db = getSupabaseAdmin();
  if (!db) return { cabinetId: null, label: undefined };
  const { data } = await db
    .from("wb_cabinets")
    .select("name")
    .eq("id", shop)
    .eq("marketplace", "wb")
    .maybeSingle();
  if (!data) return { cabinetId: null, label: undefined };
  return { cabinetId: shop, label: (data.name as string) || undefined };
}
