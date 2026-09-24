import { NextRequest, NextResponse } from "next/server";
import { valueMarketplaceStocks, moscowMonthSnapshot, type MarketplaceStockInput, type MarketplaceUnitCost } from "@/lib/finance/monthlyMarketplaceStock";
import { ozonSellerStocks, ozonStocks } from "@/lib/ozon/api";
import { getOzonCabinetScope } from "@/lib/ozon/cabinet";
import { allowsProduct } from "@/lib/wb/productScope";
import { fetchWbCardPages } from "@/lib/wb/cardPagination";
import { fetchWarehouseRemains, remainsToStockRows } from "@/lib/wb/remainsApi";
import { isWbWarehouse } from "@/lib/wb/realStock";
import { getWbSyncTargets, groupWbStatisticsTargets } from "@/lib/sync/cabinets";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const maxDuration = 300;

type CostRow = { article: string; cost_rub: number | null; warehouse_expenses: number | null; organization_id?: string | null };
type CabinetMeta = { id: string; name: string; organization_id: string | null };

const sourceKey = (marketplace: "wb" | "ozon", cabinetId: string | null) => `${marketplace}:${cabinetId ?? "env"}`;
const articleKey = (value: unknown) => String(value ?? "").normalize("NFKC").trim().toLocaleUpperCase("ru-RU");

async function loadCosts(): Promise<CostRow[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  try {
    return await loadAllSupabasePages<CostRow>((from, to) => db.from("product_costs")
      .select("article,cost_rub,warehouse_expenses,organization_id").order("article").range(from, to),
    { label: "Себестоимость месячного остатка", maxPages: 100 });
  } catch (error) {
    if (!/organization_id|schema cache|column/i.test(error instanceof Error ? error.message : String(error))) throw error;
    return loadAllSupabasePages<CostRow>((from, to) => db.from("product_costs")
      .select("article,cost_rub,warehouse_expenses").order("article").range(from, to),
    { label: "Себестоимость месячного остатка", maxPages: 100 });
  }
}

function costsForOrganization(rows: readonly CostRow[], organizationId: string | null): MarketplaceUnitCost[] {
  const tenantColumnAvailable = rows.some((row) => Object.prototype.hasOwnProperty.call(row, "organization_id"));
  return rows
    // При новой схеме стоимость чужой организации никогда не подставляем как
    // fallback. Отсутствие своей цены должно сделать снимок неполным, а не
    // превратить чужую себестоимость в актив этой компании.
    .filter((row) => !tenantColumnAvailable || row.organization_id === organizationId)
    .map((row) => ({ article: row.article, costRub: Number(row.cost_rub ?? 0), packagingRub: Number(row.warehouse_expenses ?? 0) }));
}

async function saveSource(input: {
  month: string; capturedAt: string; marketplace: "wb" | "ozon"; cabinet: CabinetMeta;
  stocks: MarketplaceStockInput[]; costs: MarketplaceUnitCost[]; warning?: string | null;
}) {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase не настроен");
  const key = sourceKey(input.marketplace, input.cabinet.id || null);
  const valued = valueMarketplaceStocks(input.stocks, input.costs);
  const missingCostCount = valued.filter((row) => row.totalValue === null).length;
  const status = missingCostCount > 0 || input.warning ? "partial" : "ok";
  const totalValue = missingCostCount > 0 ? null : valued.reduce((sum, row) => sum + (row.totalValue ?? 0), 0);
  const run = {
    snapshot_month: input.month, source_key: key, marketplace: input.marketplace,
    cabinet_id: input.cabinet.id || null, cabinet_name: input.cabinet.name,
    organization_id: input.cabinet.organization_id, status, rows_count: valued.length,
    missing_cost_count: missingCostCount,
    total_quantity: valued.reduce((sum, row) => sum + row.quantity, 0), total_value: totalValue,
    captured_at: input.capturedAt,
    error: [input.warning, missingCostCount ? `${missingCostCount} SKU без себестоимости` : null].filter(Boolean).join("; ") || null,
  };
  const prepared = await db.from("balance_marketplace_stock_runs").upsert(run, { onConflict: "snapshot_month,source_key" });
  if (prepared.error) throw new Error(prepared.error.message);
  const removed = await db.from("balance_marketplace_stock_lines").delete().eq("snapshot_month", input.month).eq("source_key", key);
  if (removed.error) throw new Error(removed.error.message);
  const lines = valued.map((row) => ({
    snapshot_month: input.month, source_key: key, marketplace: input.marketplace,
    cabinet_id: input.cabinet.id || null, organization_id: input.cabinet.organization_id,
    article: row.article, product_name: row.name, quantity: row.quantity,
    cost_rub: row.costRub, packaging_rub: row.packagingRub, unit_value: row.unitValue,
    total_value: row.totalValue, captured_at: input.capturedAt,
  }));
  const error = await chunkedUpsert("balance_marketplace_stock_lines", lines, "snapshot_month,source_key,article");
  if (error) throw new Error(error);
  return { status, rows: valued.length, missingCostCount };
}

export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;
  const startedAt = new Date();
  const window = moscowMonthSnapshot(startedAt);
  if (!window.allowed) {
    // Cron выражается в UTC и запускается 28–31-го в 21:01; только последний
    // день месяца уже является первым числом в Москве. Остальные вызовы —
    // штатный no-op, не ошибка мониторинга.
    return NextResponse.json({ ok: true, skipped: true, reason: `Снимок только 1-го числа в 00:01 МСК; сейчас ${window.date} ${window.time}` });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const capturedAt = startedAt.toISOString();
  let affected = 0;
  const errors: string[] = [];
  try {
    const [costRows, cabinetRows, wbTargets, ozonScope] = await Promise.all([
      loadCosts(),
      db.from("wb_cabinets").select("id,name,organization_id").eq("is_active", true),
      getWbSyncTargets(),
      getOzonCabinetScope("all"),
    ]);
    if (cabinetRows.error) throw new Error(cabinetRows.error.message);
    const metaById = new Map(((cabinetRows.data ?? []) as CabinetMeta[]).map((row) => [String(row.id), row]));

    for (const group of groupWbStatisticsTargets(wbTargets)) {
      try {
        const [remains, cards] = await Promise.all([
          fetchWarehouseRemains({ token: group[0].statsToken }),
          fetchWbCardPages<Record<string, unknown>>({ token: group[0].contentToken, maxPagesThisRun: 1_000 }),
        ]);
        if (!cards.caughtUp) throw new Error("каталог WB не дочитан целиком");
        const articleByNm = new Map(cards.rows.flatMap((row) => {
          const nmId = Number(row.nmID ?? row.nmId ?? row.nm_id);
          const article = String(row.supplierArticle ?? row.vendorCode ?? "").trim();
          return Number.isInteger(nmId) && nmId > 0 && article ? [[nmId, article] as const] : [];
        }));
        for (const target of group) {
          const byNm = new Map<number, number>();
          for (const row of remainsToStockRows(remains.filter((item) => allowsProduct(target.productScope, item.nmId)))) {
            const quantity = (isWbWarehouse(row.warehouse) ? Number(row.quantity ?? 0) : 0)
              + Number(row.in_way_to_client ?? 0) + Number(row.in_way_from_client ?? 0);
            if (quantity > 0) byNm.set(row.nm_id, (byNm.get(row.nm_id) ?? 0) + quantity);
          }
          const cabinet = target.cabinetId ? metaById.get(target.cabinetId) : null;
          const result = await saveSource({
            month: window.month, capturedAt, marketplace: "wb",
            cabinet: cabinet ?? { id: target.cabinetId ?? "", name: target.name, organization_id: null },
            stocks: [...byNm].map(([nmId, quantity]) => ({ article: articleByNm.get(nmId) ?? `WB:${nmId}`, quantity })),
            costs: costsForOrganization(costRows, cabinet?.organization_id ?? null),
          });
          affected += result.rows;
        }
      } catch (error) {
        errors.push(`WB ${group.map((item) => item.name).join(", ")}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (ozonScope.ok) {
      for (const cabinet of ozonScope.scope.cabinets) {
        try {
          const [warehouses, seller] = await Promise.all([
            ozonStocks(cabinet.creds, { fresh: true }),
            ozonSellerStocks(cabinet.creds, { fresh: true }),
          ]);
          if (!warehouses.ok) throw new Error(warehouses.error);
          const warning = seller.ok ? null : `FBS: ${seller.error}`;
          const meta = metaById.get(cabinet.id) ?? { id: cabinet.id, name: cabinet.name, organization_id: null };
          const result = await saveSource({
            month: window.month, capturedAt, marketplace: "ozon", cabinet: meta,
            stocks: [...warehouses.rows, ...(seller.ok ? seller.rows : [])]
              .map((row) => ({ article: row.article, name: row.name, quantity: row.free + row.reserved })),
            costs: costsForOrganization(costRows, meta.organization_id), warning,
          });
          affected += result.rows;
        } catch (error) {
          errors.push(`Ozon ${cabinet.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } else {
      errors.push(`Ozon: ${ozonScope.error}`);
    }

    const status = errors.length ? "partial" : "ok";
    await writeSyncLog("balance-monthly-stock", status, affected, errors.join("; ") || null, startedAt);
    return NextResponse.json({ ok: errors.length === 0, month: window.month, capturedAt, rows: affected, errors }, { status: errors.length ? 207 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось собрать месячный остаток";
    await writeSyncLog("balance-monthly-stock", "error", affected, message, startedAt);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
