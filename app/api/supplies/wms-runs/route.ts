import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getServerSession } from "@/lib/auth/server";
import { createMoySkladInternalOrder, fetchMoySkladAssortmentForTara, mapTaraToAssortment, type MoySkladMeta } from "@/lib/moysklad/api";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { normalizeDistributionSettingsPayload } from "@/lib/supplies/distribution";
import type { TaraLine } from "@/lib/supplies/tara";
import { allocateWholeContainers, restrictTaraLines, type WmsOrderPlan } from "@/lib/supplies/wms";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";
import { requestAllowedNmIds } from "@/lib/wb/requestProductScope";
import { fetchAcceptanceCoefficients } from "@/lib/wb/supplies";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const fail = (error: string, status: number, details?: unknown) => NextResponse.json({ data: details ? { details } : null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(code ?? "");

async function selected(raw: string | null) {
  if (!raw || raw === "all" || raw.startsWith("group:")) return null;
  return (await resolveShopCabinet(raw)).cabinetId;
}

function taraLine(row: Record<string, unknown>): TaraLine {
  return {
    lineNumber: Number(row.line_number),
    container: String(row.container ?? ""),
    nmId: row.nm_id == null ? null : Number(row.nm_id),
    article: String(row.article ?? ""),
    barcode: String(row.barcode ?? ""),
    quantity: Number(row.quantity),
    volumeLiters: row.volume_liters == null ? null : Number(row.volume_liters),
  };
}

async function closedWarehouses(cabinetId: string): Promise<Set<string>> {
  const cabinet = await getWbCabinet(cabinetId);
  if (!cabinet) throw new Error("WB-кабинет не найден");
  const coefficients = await fetchAcceptanceCoefficients(resolveWbToken(cabinet, "statistics"));
  const nearest = new Map<string, { date: string; coefficient: number }>();
  for (const row of coefficients) {
    const current = nearest.get(row.warehouseName);
    if (!current || row.date < current.date) nearest.set(row.warehouseName, { date: row.date, coefficient: row.coefficient });
  }
  return new Set([...nearest.entries()].filter(([, row]) => row.coefficient < 0).map(([name]) => name));
}

function meta(href: string, type: string): MoySkladMeta {
  return { href, type, mediaType: "application/json" };
}

function parseOrders(plan: unknown): WmsOrderPlan[] | null {
  if (!plan || typeof plan !== "object" || !Array.isArray((plan as { orders?: unknown }).orders)) return null;
  const orders = (plan as { orders: unknown[] }).orders;
  for (const raw of orders) {
    const order = raw as Partial<WmsOrderPlan>;
    if (!order || typeof order.warehouse !== "string" || typeof order.syncId !== "string" || !Array.isArray(order.containers) || !Array.isArray(order.positions) || !Number.isFinite(order.totalQuantity)) return null;
    if (order.positions.some((position) => !position || typeof position.quantity !== "number" || !position.assortment?.href || !position.assortment?.type)) return null;
  }
  return orders as WmsOrderPlan[];
}

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const cabinetId = await selected(new URL(request.url).searchParams.get("cabinet"));
  if (!cabinetId) return fail("Выберите один реальный WB-кабинет", 400);
  if (!(await hasCabinetAccess(cabinetId))) return fail("Нет доступа к кабинету", 403);
  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const { data, error } = await db.from("wms_order_runs").select("id, import_id, status, settings_snapshot, plan_json, external_orders, error, created_by, created_at, updated_at").eq("cabinet_id", cabinetId).order("created_at", { ascending: false }).limit(10);
  if (error) return fail(missingMigration(error.code) ? "Примените миграцию 20260713_wms_tara.sql" : error.message, missingMigration(error.code) ? 503 : 500);
  return NextResponse.json({ data: { runs: data ?? [] }, error: null });
}

export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const body = await request.json().catch(() => null) as { cabinetId?: string } | null;
  const cabinetId = await selected(body?.cabinetId ?? null);
  if (!cabinetId) return fail("Выберите один реальный WB-кабинет", 400);
  if (!(await hasCabinetAccess(cabinetId))) return fail("Нет доступа к кабинету", 403);
  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const [connectionResult, importResult, settingsResult] = await Promise.all([
    db.from("moysklad_connection").select("token, organization_href, organization_name, store_href, store_name").eq("cabinet_id", cabinetId).eq("is_active", true).maybeSingle(),
    db.from("wms_tara_imports").select("id, file_name, file_hash, summary").eq("cabinet_id", cabinetId).eq("status", "active").maybeSingle(),
    db.from("supply_distribution_settings").select("warehouse_shares, excluded_nm_ids, min_batch, pallet_liters").eq("cabinet_id", cabinetId).maybeSingle(),
  ]);
  const databaseError = connectionResult.error ?? importResult.error ?? settingsResult.error;
  if (databaseError) return fail(missingMigration(databaseError.code) ? "Примените миграцию 20260713_wms_tara.sql" : databaseError.message, missingMigration(databaseError.code) ? 503 : 500);
  if (!connectionResult.data?.token || !connectionResult.data.organization_href) return fail("Подключите МойСклад и выберите юрлицо", 409);
  if (!importResult.data) return fail("Сначала активируйте containerscontent.xlsx", 409);
  if (!settingsResult.data) return fail("Сначала сохраните сценарий распределения", 409);

  const normalizedSettings = normalizeDistributionSettingsPayload({
    cabinetId,
    warehouses: settingsResult.data.warehouse_shares,
    excludedNmIds: settingsResult.data.excluded_nm_ids,
    minBatch: settingsResult.data.min_batch,
    palletLiters: settingsResult.data.pallet_liters,
  }, cabinetId);
  if (!normalizedSettings.ok) return fail(normalizedSettings.error, 422);
  const { data: rawLines, error: linesError } = await db.from("wms_tara_lines").select("line_number, container, nm_id, article, barcode, quantity, volume_liters").eq("import_id", importResult.data.id).order("line_number");
  if (linesError) return fail(linesError.message, 500);
  const lines = (rawLines ?? []).map((row) => taraLine(row as Record<string, unknown>));
  const allowedNmIds = await requestAllowedNmIds(cabinetId);
  const scoped = restrictTaraLines(lines, allowedNmIds);
  if (scoped.blocked || scoped.unresolved || scoped.lines.length !== lines.length) return fail("Активная тара не проходит текущий товарный контур кабинета. Загрузите файл заново", 403);

  let closed: Set<string>;
  try { closed = await closedWarehouses(cabinetId); } catch (error) { return fail(error instanceof Error ? error.message : "Не удалось проверить ограничения WB", 502); }
  const blockedWarehouses = normalizedSettings.value.warehouses.filter((warehouse) => warehouse.pct > 0 && closed.has(warehouse.name)).map((warehouse) => warehouse.name);
  if (blockedWarehouses.length) return fail(`Приёмка WB закрыта: ${blockedWarehouses.join(", ")}. Примените ограничения в сценарии и сохраните его заново`, 409);

  let catalog;
  try { catalog = await fetchMoySkladAssortmentForTara(String(connectionResult.data.token), scoped.lines); } catch (error) { return fail(error instanceof Error ? error.message : "Не удалось сопоставить МойСклад", 502); }
  const mapped = mapTaraToAssortment(scoped.lines, catalog);
  if (mapped.errors.length) return fail("Не все позиции тары сопоставлены с МойСклад", 422, mapped.errors.slice(0, 50));
  const syncIds = normalizedSettings.value.warehouses.map(() => randomUUID());
  const plan = allocateWholeContainers(mapped.mapped, normalizedSettings.value.warehouses, new Set(normalizedSettings.value.excludedNmIds), syncIds);
  if (!plan.orders.length) return fail("После исключений не осталось коробов для WMS-заказа", 422);
  const session = await getServerSession();
  const planJson = { ...plan, sourceFile: importResult.data.file_name, generatedAt: new Date().toISOString() };
  const { data: run, error: insertError } = await db.from("wms_order_runs").insert({
    cabinet_id: cabinetId,
    import_id: importResult.data.id,
    status: "dry_run",
    settings_snapshot: normalizedSettings.value,
    plan_json: planJson,
    created_by: session?.email ?? null,
  }).select("id, import_id, status, settings_snapshot, plan_json, external_orders, error, created_by, created_at, updated_at").single();
  if (insertError) return fail(missingMigration(insertError.code) ? "Примените миграцию 20260713_wms_tara.sql" : insertError.message, missingMigration(insertError.code) ? 503 : 500);
  return NextResponse.json({ data: { run }, error: null }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const body = await request.json().catch(() => null) as { runId?: string; confirm?: string } | null;
  if (!body?.runId || body.confirm !== "CREATE_WMS_ORDERS") return fail("Нужно явное подтверждение создания WMS-заказов", 400);
  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const { data: run, error: runError } = await db.from("wms_order_runs").select("id, cabinet_id, import_id, status, plan_json, external_orders").eq("id", body.runId).maybeSingle();
  if (runError) return fail(runError.message, 500);
  if (!run) return fail("Dry-run не найден", 404);
  const cabinetId = String(run.cabinet_id);
  if (!(await hasCabinetAccess(cabinetId))) return fail("Нет доступа к кабинету", 403);
  if (run.status === "created") return NextResponse.json({ data: { run }, error: null });
  const orders = parseOrders(run.plan_json);
  if (!orders?.length) return fail("Сохранённый dry-run повреждён", 409);

  const [{ data: connection, error: connectionError }, { data: currentLines, error: currentLinesError }, allowedNmIds] = await Promise.all([
    db.from("moysklad_connection").select("token, organization_href, organization_name, store_href, store_name").eq("cabinet_id", cabinetId).eq("is_active", true).maybeSingle(),
    db.from("wms_tara_lines").select("nm_id").eq("import_id", run.import_id),
    requestAllowedNmIds(cabinetId),
  ]);
  if (connectionError || !connection?.token || !connection.organization_href) return fail(connectionError?.message ?? "МойСклад отключён или не настроен", 409);
  if (currentLinesError) return fail(currentLinesError.message, 500);
  if (allowedNmIds !== null && (currentLines ?? []).some((line) => line.nm_id == null || !allowedNmIds.has(Number(line.nm_id)))) return fail("Товарный контур кабинета изменился после dry-run. Создайте новый dry-run", 403);

  let closed: Set<string>;
  try { closed = await closedWarehouses(cabinetId); } catch (error) { return fail(error instanceof Error ? error.message : "Не удалось повторно проверить WB", 502); }
  const blockedWarehouses = orders.filter((order) => closed.has(order.warehouse)).map((order) => order.warehouse);
  if (blockedWarehouses.length) return fail(`Создание остановлено: WB закрыл приёмку ${blockedWarehouses.join(", ")}. Сделайте новый dry-run`, 409);

  const claimed = await db.from("wms_order_runs").update({ status: "creating", error: null, updated_at: new Date().toISOString() }).eq("id", run.id).in("status", ["dry_run", "creating", "failed"]).select("id").maybeSingle();
  if (claimed.error || !claimed.data) return fail(claimed.error?.message ?? "Запуск уже обрабатывается", 409);
  const organization = meta(String(connection.organization_href), "organization");
  const store = connection.store_href ? meta(String(connection.store_href), "store") : null;
  const completed = new Map<string, Record<string, unknown>>((Array.isArray(run.external_orders) ? run.external_orders : []).map((item) => [String((item as { syncId?: string }).syncId ?? ""), item as Record<string, unknown>]));
  try {
    for (const order of orders) {
      if (completed.has(order.syncId)) continue;
      const created = await createMoySkladInternalOrder(String(connection.token), {
        syncId: order.syncId,
        name: `WMS ${order.warehouse} ${new Date().toLocaleDateString("ru-RU")}`,
        description: `Finance Panel · WB ${order.warehouse}\nКороба: ${order.containers.join(", ")}`,
        organization,
        store,
        positions: order.positions.map((position) => ({ quantity: position.quantity, assortment: position.assortment })),
      });
      completed.set(order.syncId, { syncId: order.syncId, warehouse: order.warehouse, id: created.id, name: created.name, href: created.meta.href });
      await db.from("wms_order_runs").update({ external_orders: [...completed.values()], updated_at: new Date().toISOString() }).eq("id", run.id);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка создания МойСклад";
    await db.from("wms_order_runs").update({ status: "failed", external_orders: [...completed.values()], error: message, updated_at: new Date().toISOString() }).eq("id", run.id);
    return fail(message, 502, { created: [...completed.values()] });
  }
  const session = await getServerSession();
  const externalOrders = [...completed.values()];
  const { data: finished, error: finishError } = await db.from("wms_order_runs").update({ status: "created", external_orders: externalOrders, error: null, updated_at: new Date().toISOString() }).eq("id", run.id).select("id, status, plan_json, external_orders, error, created_at, updated_at").single();
  if (finishError) return fail(finishError.message, 500);
  await db.from("operation_audit_log").insert({ cabinet_id: cabinetId, entity_type: "wms_order_run", entity_id: run.id, action: "created_in_moysklad", actor: session?.email ?? null, after_data: { externalOrders } });
  return NextResponse.json({ data: { run: finished }, error: null });
}
