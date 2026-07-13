import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// Backward-compatible Inferno contract. `cookie` historically meant that the
// external WMS session exists; for token auth it now reflects a cabinet-scoped connection.
export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const raw = new URL(request.url).searchParams.get("cabinet");
  const cabinetId = raw && raw !== "all" && !raw.startsWith("group:") ? (await resolveShopCabinet(raw)).cabinetId : null;
  if (!cabinetId) return NextResponse.json({ cookie: false, warehouses: [], ready: false, error: "Выберите один WB-кабинет" }, { status: 400 });
  if (!(await hasCabinetAccess(cabinetId))) return NextResponse.json({ cookie: false, warehouses: [], ready: false, error: "Нет доступа к кабинету" }, { status: 403 });
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ cookie: false, warehouses: [], ready: false, error: "Supabase не настроен" }, { status: 500 });
  const [connection, settings, tara] = await Promise.all([
    db.from("moysklad_connection").select("id").eq("cabinet_id", cabinetId).eq("is_active", true).maybeSingle(),
    db.from("supply_distribution_settings").select("warehouse_shares").eq("cabinet_id", cabinetId).maybeSingle(),
    db.from("wms_tara_imports").select("id, summary").eq("cabinet_id", cabinetId).eq("status", "active").maybeSingle(),
  ]);
  const error = connection.error ?? settings.error ?? tara.error;
  if (error) return NextResponse.json({ cookie: false, warehouses: [], ready: false, error: error.message }, { status: 503 });
  const warehouses = Array.isArray(settings.data?.warehouse_shares) ? settings.data.warehouse_shares : [];
  return NextResponse.json({ cookie: Boolean(connection.data), warehouses, tara: tara.data ?? null, ready: Boolean(connection.data && tara.data && warehouses.length) });
}
