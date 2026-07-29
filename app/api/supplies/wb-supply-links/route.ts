import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getServerSession } from "@/lib/auth/server";
import { compareWbSupplyGoods, compareWbSupplyPackages, normalizeWbSupplyId, supplyWarehouseMatches } from "@/lib/supplies/wbSupply";
import { parseWmsOrders } from "@/lib/supplies/wms";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";
import { fetchFbwSupplySnapshot, WbFbwSupplyError } from "@/lib/wb/fbwSupplies";
import { requestAllowedNmIds } from "@/lib/wb/requestProductScope";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const fail = (error: string, status: number, details?: unknown) => NextResponse.json({ data: details ? { details } : null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(code ?? "");

function wbFailure(error: unknown) {
  if (error instanceof WbFbwSupplyError) return fail(error.message, error.status === 404 ? 404 : error.status === 401 || error.status === 403 ? 403 : 502);
  return fail(error instanceof Error ? error.message : "Не удалось проверить поставку WB", 502);
}

export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const body = await request.json().catch(() => null) as { runId?: string; warehouse?: string; supplyId?: unknown; confirm?: string } | null;
  const supplyId = normalizeWbSupplyId(body?.supplyId);
  const warehouse = String(body?.warehouse ?? "").normalize("NFKC").trim().slice(0, 255);
  if (!body?.runId || !warehouse || !supplyId || body.confirm !== "LINK_WB_SUPPLY") return fail("Укажите dry-run, склад, номер поставки и подтвердите привязку", 400);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const { data: run, error: runError } = await db.from("wms_order_runs").select("id, cabinet_id, import_id, status, plan_json, external_orders").eq("id", body.runId).maybeSingle();
  if (runError) return fail(runError.message, 500);
  if (!run) return fail("Dry-run не найден", 404);
  if (run.status === "created") return fail("Заказы этого dry-run уже созданы — привязку менять нельзя", 409);
  if (run.status === "creating") return fail("WMS-заказы сейчас создаются — дождитесь завершения", 409);
  const cabinetId = String(run.cabinet_id);
  if (!(await hasCabinetAccess(cabinetId))) return fail("Нет доступа к кабинету", 403);
  const orders = parseWmsOrders(run.plan_json);
  const order = orders?.find((item) => item.warehouse === warehouse);
  if (!order) return fail("Склад отсутствует в этом dry-run", 404);
  if (Array.isArray(run.external_orders) && run.external_orders.some((item) => String((item as { warehouse?: unknown }).warehouse ?? "") === warehouse)) return fail("WMS-заказ этого склада уже создан — привязка зафиксирована", 409);

  // Проверяем кабинетный товарный контур до любого запроса наружу. Для Optima
  // пустой/неактуальный allowlist закрывает операцию, а не раскрывает весь кабинет.
  const [{ data: rawLines, error: linesError }, allowedNmIds] = await Promise.all([
    db.from("wms_tara_lines").select("container, nm_id, article, barcode, quantity").eq("import_id", run.import_id),
    requestAllowedNmIds(cabinetId),
  ]);
  if (linesError) return fail(linesError.message, 500);
  const allLines = rawLines ?? [];
  if (allowedNmIds !== null && allLines.some((line) => line.nm_id == null || !allowedNmIds.has(Number(line.nm_id)))) return fail("Товарный контур кабинета изменился после dry-run. Создайте новый dry-run", 403);
  const containers = new Set(order.containers);
  const selectedLines = allLines.filter((line) => containers.has(String(line.container)));
  if (!selectedLines.length || selectedLines.some((line) => !String(line.barcode ?? "").trim())) return fail("В раскладке склада отсутствуют товарные штрихкоды", 422);

  const cabinet = await getWbCabinet(cabinetId);
  if (!cabinet) return fail("WB-кабинет не найден", 404);
  let snapshot;
  try {
    snapshot = await fetchFbwSupplySnapshot(resolveWbToken(cabinet, "statistics"), supplyId);
  } catch (error) {
    return wbFailure(error);
  }
  if (![1, 2, 3].includes(Number(snapshot.detail.statusID))) return fail("Поставка уже находится на приёмке или завершена — выберите редактируемую поставку", 409);
  if (!supplyWarehouseMatches(order.warehouse, snapshot.detail)) return fail("Склад в поставке WB не совпадает со складом dry-run", 409, { planned: order.warehouse, actual: snapshot.detail.warehouseName });
  if (allowedNmIds !== null && snapshot.goods.some((row) => !allowedNmIds.has(Number(row.nmID)))) return fail("Поставка WB содержит товары вне контура выбранного кабинета", 403);

  const goodsComparison = compareWbSupplyGoods(selectedLines.map((row) => ({ barcode: String(row.barcode), quantity: Number(row.quantity) })), snapshot.goods);
  if (!goodsComparison.ok) return fail("Состав поставки WB не совпадает с dry-run", 409, goodsComparison);
  const packageComparison = compareWbSupplyPackages(selectedLines.map((row) => ({
    container: String(row.container), barcode: String(row.barcode), quantity: Number(row.quantity),
  })), snapshot.packages);

  const { data: duplicate, error: duplicateError } = await db.from("wms_wb_supply_links").select("id, run_id, warehouse").eq("cabinet_id", cabinetId).eq("supply_id", supplyId).maybeSingle();
  if (duplicateError && missingMigration(duplicateError.code)) return fail("Примените миграцию 20260713_wb_supply_links.sql", 503);
  if (duplicateError) return fail(duplicateError.message, 500);
  if (duplicate && (String(duplicate.run_id) !== String(run.id) || String(duplicate.warehouse) !== warehouse)) return fail("Эта поставка WB уже привязана к другому складу или dry-run", 409);
  const { data: before } = await db.from("wms_wb_supply_links").select("*").eq("run_id", run.id).eq("warehouse", warehouse).maybeSingle();
  const session = await getServerSession();
  const payload = {
    cabinet_id: cabinetId,
    run_id: run.id,
    warehouse,
    supply_id: supplyId,
    status_id: Number(snapshot.detail.statusID),
    box_type_id: Number(snapshot.detail.boxTypeID),
    wb_snapshot: snapshot,
    goods_comparison: goodsComparison,
    package_comparison: packageComparison,
    linked_by: session?.email ?? null,
    verified_at: snapshot.capturedAt,
    updated_at: new Date().toISOString(),
  };
  const { data: link, error: saveError } = await db.from("wms_wb_supply_links").upsert(payload, { onConflict: "run_id,warehouse" }).select("*").single();
  if (saveError) return fail(missingMigration(saveError.code) ? "Примените миграцию 20260713_wb_supply_links.sql" : saveError.message, missingMigration(saveError.code) ? 503 : saveError.code === "23505" ? 409 : 500);
  await db.from("operation_audit_log").insert({
    cabinet_id: cabinetId,
    entity_type: "wms_wb_supply_link",
    entity_id: link.id,
    action: before ? "verified" : "linked",
    actor: session?.email ?? null,
    before_data: before,
    after_data: link,
  });
  return NextResponse.json({ data: { link }, error: null }, { status: before ? 200 : 201 });
}

export async function DELETE(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const body = await request.json().catch(() => null) as { runId?: string; warehouse?: string; confirm?: string } | null;
  if (!body?.runId || !body.warehouse || body.confirm !== "UNLINK_WB_SUPPLY") return fail("Нужно явное подтверждение удаления привязки", 400);
  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const { data: run, error: runError } = await db.from("wms_order_runs").select("id, cabinet_id, status, external_orders").eq("id", body.runId).maybeSingle();
  if (runError) return fail(runError.message, 500);
  if (!run) return fail("Dry-run не найден", 404);
  if (run.status === "created") return fail("Заказы уже созданы — история привязки зафиксирована", 409);
  if (run.status === "creating") return fail("WMS-заказы сейчас создаются — дождитесь завершения", 409);
  const cabinetId = String(run.cabinet_id);
  if (!(await hasCabinetAccess(cabinetId))) return fail("Нет доступа к кабинету", 403);
  if (Array.isArray(run.external_orders) && run.external_orders.some((item) => String((item as { warehouse?: unknown }).warehouse ?? "") === String(body.warehouse))) return fail("WMS-заказ этого склада уже создан — привязка зафиксирована", 409);
  const { data: removed, error } = await db.from("wms_wb_supply_links").delete().eq("run_id", run.id).eq("warehouse", String(body.warehouse)).select("*").maybeSingle();
  if (error) return fail(missingMigration(error.code) ? "Примените миграцию 20260713_wb_supply_links.sql" : error.message, missingMigration(error.code) ? 503 : 500);
  if (removed) {
    const session = await getServerSession();
    await db.from("operation_audit_log").insert({ cabinet_id: cabinetId, entity_type: "wms_wb_supply_link", entity_id: removed.id, action: "unlinked", actor: session?.email ?? null, before_data: removed });
  }
  return NextResponse.json({ data: { removed: Boolean(removed) }, error: null });
}
