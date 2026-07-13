import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getServerSession } from "@/lib/auth/server";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { normalizeDistributionSettingsPayload, type SupplyDistributionSettings } from "@/lib/supplies/distribution";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requestAllowedNmIds, requestAllowsNm } from "@/lib/wb/requestProductScope";

export const dynamic = "force-dynamic";

const meta = (cabinetId: string, warnings: string[] = []) => ({ cabinetId, generatedAt: new Date().toISOString(), status: "ready" as const, warnings });
const fail = (message: string, status: number, cabinetId = "") => NextResponse.json({ meta: meta(cabinetId), data: null, error: message }, { status });

interface DbSettings {
  cabinet_id: string;
  warehouse_shares: { name: string; pct: number }[];
  excluded_nm_ids: number[];
  min_batch: number;
  pallet_liters: number;
}

function fromDb(row: DbSettings, allowedNmIds: Set<number> | null): SupplyDistributionSettings {
  return {
    cabinetId: row.cabinet_id,
    warehouses: Array.isArray(row.warehouse_shares) ? row.warehouse_shares.map((warehouse) => ({ name: String(warehouse.name), pct: Number(warehouse.pct) })) : [],
    excludedNmIds: (row.excluded_nm_ids ?? []).map(Number).filter((nmId) => requestAllowsNm(allowedNmIds, nmId)),
    minBatch: Number(row.min_batch),
    palletLiters: Number(row.pallet_liters),
  };
}

async function cabinet(raw: string | null) {
  if (!raw || raw === "all") return null;
  return (await resolveShopCabinet(raw)).cabinetId;
}

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const rawCabinet = new URL(request.url).searchParams.get("cabinet");
  if (!rawCabinet || rawCabinet === "all") return fail("Выберите один реальный WB-кабинет", 400);
  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const cabinetId = await cabinet(rawCabinet);
  if (!cabinetId) return fail("WB-кабинет не найден", 404);
  if (!(await hasCabinetAccess(cabinetId))) return fail("Нет доступа к кабинету", 403, cabinetId);

  const [{ data, error }, allowedNmIds] = await Promise.all([
    db.from("supply_distribution_settings").select("cabinet_id, warehouse_shares, excluded_nm_ids, min_batch, pallet_liters").eq("cabinet_id", cabinetId).maybeSingle(),
    requestAllowedNmIds(cabinetId),
  ]);
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return NextResponse.json({ meta: meta(cabinetId, ["Сценарий ещё не сохранён на сервере"]), data: { settings: null }, error: null });
    return fail(error.message, 500, cabinetId);
  }
  return NextResponse.json({ meta: meta(cabinetId), data: { settings: data ? fromDb(data as DbSettings, allowedNmIds) : null }, error: null });
}

export async function PATCH(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return fail("Некорректное тело запроса", 400);
  const cabinetId = await cabinet(typeof body.cabinetId === "string" ? body.cabinetId : null);
  if (!cabinetId) return fail("Выберите один реальный WB-кабинет", 400);
  if (!(await hasCabinetAccess(cabinetId))) return fail("Нет доступа к кабинету", 403, cabinetId);

  const normalized = normalizeDistributionSettingsPayload(body, cabinetId);
  if (!normalized.ok) return fail(normalized.error, 400, cabinetId);
  const allowedNmIds = await requestAllowedNmIds(cabinetId);
  const disallowed = normalized.value.excludedNmIds.filter((nmId) => !requestAllowsNm(allowedNmIds, nmId));
  if (disallowed.length) return fail(`Эти nmId не входят в разрешённый товарный контур: ${disallowed.join(", ")}`, 403, cabinetId);

  const session = await getServerSession();
  const { data, error } = await db.rpc("save_supply_distribution_settings", { p_settings: normalized.value, p_actor: session?.email ?? null });
  if (error) {
    const missing = ["42P01", "42883", "PGRST202"].includes(error.code ?? "");
    return fail(missing ? "Контур распределения ещё не развёрнут: примените миграцию 20260713_supply_distribution_settings.sql" : error.message, missing ? 503 : 500, cabinetId);
  }
  return NextResponse.json({ meta: meta(cabinetId), data: { settings: fromDb(data as DbSettings, allowedNmIds) }, error: null });
}
