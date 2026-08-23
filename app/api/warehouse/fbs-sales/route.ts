import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveEntity } from "@/lib/warehouse/entityAccess";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** «Склад продавца» в отчёте заказов WB — это и есть FBS. */
const FBS_WAREHOUSE_TYPE = "Склад продавца";

export interface FbsSalesWarehouseResult {
  warehouseId: string;
  warehouseName: string;
  since: string;
  /** Списано продаж этим запуском. */
  written: number;
  /** Уже были списаны прошлым запуском. */
  skipped: number;
  /** Списаны при нулевом или недостаточном остатке — регистр не знает о приходе. */
  negative: number;
}

export interface FbsSalesResult {
  warehouses: FbsSalesWarehouseResult[];
  /** Заказы, по которым не удалось опознать размер. */
  unresolved: { article: string; count: number }[];
  /** Прочитано заказов FBS за период. */
  scanned: number;
  /** Заказов чужих юрлиц — они спишутся при синхронизации своего юрлица. */
  otherEntity: number;
}

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST204", "PGRST205", "42883"].includes(code ?? "");
const migrationHint = "Примените миграцию 202608240019_fbs_sales.sql";

interface OrderRow { srid: string; nm_id: number; supplier_article: string; date: string; cabinet_id: string }

/**
 * Списать продажи FBS со склада.
 *
 * Чьё юрлицо списывать, решает ТОВАР, а не кабинет: пеналы продаются через
 * агентский кабинет Оптимы, но принадлежат ООО РИО. Кабинет остаётся на движении
 * как канал продажи.
 */
export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const body = (await request.json().catch(() => null)) as { entityId?: string } | null;
  const scope = await resolveEntity(body?.entityId ?? null);
  if (!scope.ok) return fail(scope.error, scope.status);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const session = await getServerSession();

  // Склады, для которых списание включено. Пока дата не выставлена, вычитать
  // продажи нельзя: остаток уйдёт в минус на всю историю торговли.
  const settingsResult = await db
    .from("legal_entity_warehouses")
    .select("warehouse_id, fbs_sales_since")
    .eq("legal_entity_id", scope.entity.id)
    .not("fbs_sales_since", "is", null);
  if (settingsResult.error) {
    const code = settingsResult.error.code;
    return fail(missingMigration(code) ? migrationHint : settingsResult.error.message, missingMigration(code) ? 503 : 500);
  }
  const settings = settingsResult.data ?? [];
  if (settings.length === 0) {
    return fail("Ни для одного склада не включено списание продаж FBS. Включите его на вкладке «Склады», указав дату, с которой остатку склада можно верить.", 400);
  }

  const warehousesResult = await db.from("warehouses").select("id, name");
  const warehouseNames = new Map((warehousesResult.data ?? []).map((row) => [String(row.id), String(row.name)]));

  // Справочник: баркод и карточка → размер → товар → юрлицо товара.
  const variantsResult = await db
    .from("product_variants_view")
    .select("id, product_id, barcode, nm_id, article, legal_entity_id, is_default");
  if (variantsResult.error) return fail(variantsResult.error.message, 500);

  const byBarcode = new Map<string, { id: string; entityId: string | null }>();
  const byNm = new Map<number, { id: string; entityId: string | null }[]>();
  for (const row of variantsResult.data ?? []) {
    const entry = { id: String(row.id), entityId: row.legal_entity_id ? String(row.legal_entity_id) : null };
    const barcode = String(row.barcode ?? "").trim();
    if (barcode) byBarcode.set(barcode, entry);
    const nmId = row.nm_id === null || row.nm_id === undefined ? null : Number(row.nm_id);
    if (nmId) byNm.set(nmId, [...(byNm.get(nmId) ?? []), entry]);
  }

  const cabinetIds = scope.entity.cabinets.map((link) => link.cabinetId);
  const earliest = settings
    .map((row) => String(row.fbs_sales_since))
    .sort()[0];

  // Баркод заказа живёт в сборочных заданиях, а не в отчёте заказов: их
  // связывает srid. Без баркода размер определить нельзя — карточка знает
  // только модель.
  let barcodeBySrid = new Map<string, string>();
  try {
    const tasks = await loadAllSupabasePages<{ srid: string; barcode: string }>((from, to) =>
      db.from("wb_fbs_orders").select("srid, barcode").in("cabinet_id", cabinetIds).order("srid").range(from, to),
      { maxPages: 200, label: "FBS: баркоды сборочных заданий" });
    barcodeBySrid = new Map(tasks.filter((row) => row.srid && row.barcode).map((row) => [String(row.srid), String(row.barcode)]));
  } catch {
    // Без сборочных заданий останется только путь по карточке — он сработает
    // для безразмерных товаров и промолчит для одежды.
  }

  let orders: OrderRow[];
  try {
    orders = await loadAllSupabasePages<OrderRow>((from, to) =>
      db
        .from("wb_orders")
        .select("srid, nm_id, supplier_article, date, cabinet_id")
        .in("cabinet_id", cabinetIds)
        .eq("warehouse_type", FBS_WAREHOUSE_TYPE)
        .eq("is_cancel", false)
        .gte("date", earliest)
        .order("date")
        .range(from, to),
      { maxPages: 500, label: "FBS: заказы со склада продавца" });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Не удалось прочитать заказы", 500);
  }

  const unresolved = new Map<string, number>();
  let otherEntity = 0;
  const linesByWarehouse = new Map<string, Record<string, unknown>[]>();

  for (const setting of settings) {
    const warehouseId = String(setting.warehouse_id);
    const since = String(setting.fbs_sales_since);
    const lines: Record<string, unknown>[] = [];
    for (const order of orders) {
      if (!order.srid || order.date < since) continue;
      const barcode = barcodeBySrid.get(String(order.srid));
      const byCard = byNm.get(Number(order.nm_id));
      // По карточке размер определяется, только если он у неё один: иначе
      // непонятно, какой именно размер уехал, и молча выбрать любой — соврать.
      const variant = (barcode ? byBarcode.get(barcode) : undefined)
        ?? (byCard && byCard.length === 1 ? byCard[0] : undefined);
      if (!variant) {
        const key = String(order.supplier_article ?? order.nm_id);
        unresolved.set(key, (unresolved.get(key) ?? 0) + 1);
        continue;
      }
      if (variant.entityId && variant.entityId !== scope.entity.id) { otherEntity += 1; continue; }
      lines.push({
        srid: order.srid,
        variantId: variant.id,
        cabinetId: order.cabinet_id,
        qty: 1,
        occurredAt: order.date,
      });
    }
    linesByWarehouse.set(warehouseId, lines);
  }

  const results: FbsSalesWarehouseResult[] = [];
  for (const [warehouseId, lines] of linesByWarehouse) {
    const setting = settings.find((row) => String(row.warehouse_id) === warehouseId)!;
    // Пачками: одна продажа — одна строка, и на месяце торговли их тысячи.
    let written = 0, skipped = 0, negative = 0;
    for (let offset = 0; offset < lines.length; offset += 500) {
      const { data, error } = await db.rpc("post_fbs_sales", {
        p_legal_entity_id: scope.entity.id,
        p_warehouse_id: warehouseId,
        p_lines: lines.slice(offset, offset + 500),
        p_actor: session?.email ?? null,
      });
      if (error) {
        const code = error.code;
        return fail(missingMigration(code) ? migrationHint : error.message, missingMigration(code) ? 503 : 500);
      }
      const row = (data ?? {}) as { written?: number; skipped?: number; negative?: number };
      written += Number(row.written ?? 0);
      skipped += Number(row.skipped ?? 0);
      negative += Number(row.negative ?? 0);
    }
    await db
      .from("legal_entity_warehouses")
      .update({ fbs_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("legal_entity_id", scope.entity.id)
      .eq("warehouse_id", warehouseId);
    results.push({
      warehouseId,
      warehouseName: warehouseNames.get(warehouseId) ?? "склад",
      since: String(setting.fbs_sales_since),
      written,
      skipped,
      negative,
    });
  }

  const result: FbsSalesResult = {
    warehouses: results,
    unresolved: [...unresolved.entries()]
      .map(([article, count]) => ({ article, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
    scanned: orders.length,
    otherEntity,
  };
  return NextResponse.json({ data: result, error: null });
}
