import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { fulfillmentReconciliation, valueMarketplaceStocks, moscowMonthSnapshot, type MarketplaceStockInput, type MarketplaceUnitCost, type ValuedMarketplaceStock } from "@/lib/finance/monthlyMarketplaceStock";
import { ozonMarketplaceBalance, ozonStocks } from "@/lib/ozon/api";
import { getOzonCabinetScope } from "@/lib/ozon/cabinet";
import { allowsProduct } from "@/lib/wb/productScope";
import { fetchWarehouseRemains, remainsToStockRows } from "@/lib/wb/remainsApi";
import { isWbWarehouse } from "@/lib/wb/realStock";
import { getWbSyncTargets, groupWbStatisticsTargets } from "@/lib/sync/cabinets";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadGroupReportingScope } from "@/lib/finance/groupReportingScope";
import { balanceWbProductScope, buildBalanceWbCatalogIndex, type BalanceWbCatalogItem, type BalanceWbCatalogRow } from "@/lib/finance/balanceWbCatalog";
import { fetchWbAccountBalance } from "@/lib/wb/financeApi";
import { loadBalanceCompanyScopes } from "@/lib/finance/balanceScopes";

export const maxDuration = 300;

type SourceKind = "fulfillment" | "wb" | "ozon" | "supplier_transit";
type CostRow = { article: string; cost_rub: number | null; warehouse_expenses: number | null; organization_id?: string | null };
type CabinetMeta = { id: string; name: string; organization_id: string | null };
type FulfillmentRow = { legal_entity_id: string; warehouse_id: string; warehouse_name: string; variant_id: string; article: string; product_name: string; size_label: string; qty: number; amount: number; unit_cost: number };
type LegalEntityMeta = { id: string; name: string };

const sourceKey = (kind: SourceKind, id = "all") => `${kind}:${id}`;
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const privateSourceKey = (marketplace: "wb" | "ozon", identity: string) =>
  `${marketplace}:${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;

async function saveCashSnapshot(input: {
  month: string;
  sourceKey: string;
  marketplace: "wb" | "ozon";
  cabinet: CabinetMeta;
  cabinetName?: string;
  amount: number | null;
  availableAmount?: number | null;
  currency?: string;
  capturedAt: string;
  error?: string | null;
  persist?: boolean;
}) {
  const summary = {
    sourceKey: input.sourceKey,
    marketplace: input.marketplace,
    cabinetName: input.cabinetName ?? input.cabinet.name,
    amount: input.amount,
    availableAmount: input.availableAmount ?? null,
    currency: input.currency ?? "RUB",
    status: input.error || input.amount === null ? "error" : "ok",
    error: input.error ?? null,
  };
  if (input.persist === false) return summary;
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase не настроен");
  const result = await db.from("balance_marketplace_cash_snapshots").upsert({
    snapshot_month: input.month,
    source_key: input.sourceKey,
    marketplace: input.marketplace,
    cabinet_id: input.cabinet.id || null,
    cabinet_name: summary.cabinetName,
    organization_id: input.cabinet.organization_id,
    amount: input.amount,
    available_amount: input.availableAmount ?? null,
    currency: summary.currency,
    status: summary.status,
    error: summary.error,
    captured_at: input.capturedAt,
    updated_at: input.capturedAt,
  }, { onConflict: "snapshot_month,source_key" });
  if (result.error) throw new Error(result.error.message);
  return summary;
}

async function fulfillmentFinality(closeThrough: string, legalEntityIds: ReadonlySet<string>) {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase не настроен");
  const result = await db.from("legal_entities").select("id,name,period_closed_through").eq("is_active", true);
  if (result.error) throw new Error(result.error.message);
  const unclosed = (result.data ?? [])
    .filter((row) => legalEntityIds.has(String(row.id)))
    .filter((row) => !row.period_closed_through || String(row.period_closed_through) < closeThrough)
    .map((row) => String(row.name));
  return { final: unclosed.length === 0, unclosed };
}

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

async function loadWbCatalogIndex(cabinetIds: readonly string[]) {
  const db = getSupabaseAdmin();
  if (!db || cabinetIds.length === 0) return new Map<string, Map<number, BalanceWbCatalogItem>>();
  const [cards, scopedProducts] = await Promise.all([
    loadAllSupabasePages<BalanceWbCatalogRow>((from, to) => db.from("wb_cards")
      .select("cabinet_id,nm_id,article,brand").in("cabinet_id", cabinetIds)
      .order("cabinet_id").order("nm_id").range(from, to),
    { label: "Локальный каталог WB", maxPages: 100, concurrency: 4 }),
    loadAllSupabasePages<BalanceWbCatalogRow>((from, to) => db.from("wb_cabinet_product_scope")
      .select("cabinet_id,nm_id,article,brand").in("cabinet_id", cabinetIds)
      .order("cabinet_id").order("nm_id").range(from, to),
    { label: "Товарный контур WB", maxPages: 100, concurrency: 4 }),
  ]);
  // wb_cards — основной справочник. Scope идёт вторым как безопасный fallback;
  // индекс сохраняет первое непустое значение для одинакового cabinet/nm.
  return buildBalanceWbCatalogIndex([...cards, ...scopedProducts]);
}

function costsForOrganization(rows: readonly CostRow[], organizationId: string | null): MarketplaceUnitCost[] {
  const tenantColumnAvailable = rows.some((row) => Object.prototype.hasOwnProperty.call(row, "organization_id"));
  return rows
    .filter((row) => !tenantColumnAvailable || row.organization_id === organizationId)
    .map((row) => ({ article: row.article, costRub: Number(row.cost_rub ?? 0), packagingRub: Number(row.warehouse_expenses ?? 0) }));
}

async function saveSource(input: {
  month: string;
  capturedAt: string;
  sourceKind: SourceKind;
  sourceLabel: string;
  lines: ValuedMarketplaceStock[];
  marketplace?: "wb" | "ozon";
  cabinet?: CabinetMeta | null;
  scopeId?: string;
  legalEntity?: LegalEntityMeta | null;
  warning?: string | null;
  persist?: boolean;
  provisional?: boolean;
  snapshotCutoff?: string | null;
}) {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase не настроен");
  const key = sourceKey(input.sourceKind, input.scopeId || input.cabinet?.id || input.legalEntity?.id || "all");
  const missingCostCount = input.lines.filter((row) => row.totalValue === null).length;
  const status = missingCostCount > 0 || input.warning ? "partial" : "ok";
  const totalValue = missingCostCount > 0 ? null : round2(input.lines.reduce((sum, row) => sum + (row.totalValue ?? 0), 0));
  const summary = {
    sourceKey: key,
    sourceKind: input.sourceKind,
    sourceLabel: input.sourceLabel,
    status,
    rows: input.lines.length,
    quantity: round2(input.lines.reduce((sum, row) => sum + row.quantity, 0)),
    totalValue,
    missingCostCount,
    provisional: input.provisional ?? false,
    sample: input.lines.slice(0, 5).map((row) => ({ article: row.article, location: row.locationName, quantity: row.quantity, unitValue: row.unitValue, totalValue: row.totalValue })),
  };
  if (input.persist === false) return summary;
  const run = {
    snapshot_month: input.month,
    source_key: key,
    source_kind: input.sourceKind,
    source_label: input.sourceLabel,
    marketplace: input.marketplace ?? null,
    cabinet_id: input.cabinet?.id || null,
    cabinet_name: input.cabinet?.name ?? null,
    organization_id: input.cabinet?.organization_id ?? null,
    legal_entity_id: input.legalEntity?.id ?? null,
    status,
    rows_count: input.lines.length,
    missing_cost_count: missingCostCount,
    total_quantity: input.lines.reduce((sum, row) => sum + row.quantity, 0),
    total_value: totalValue,
    captured_at: input.capturedAt,
    is_provisional: input.provisional ?? false,
    snapshot_cutoff: input.snapshotCutoff ?? null,
    reconciled_at: input.sourceKind === "fulfillment" ? input.capturedAt : null,
    error: [input.warning, missingCostCount ? `${missingCostCount} позиций без себестоимости` : null].filter(Boolean).join("; ") || null,
  };
  const prepared = await db.from("balance_marketplace_stock_runs").upsert(run, { onConflict: "snapshot_month,source_key" });
  if (prepared.error) throw new Error(prepared.error.message);
  const removed = await db.from("balance_marketplace_stock_lines").delete().eq("snapshot_month", input.month).eq("source_key", key);
  if (removed.error) throw new Error(removed.error.message);
  const lines = input.lines.map((row) => ({
    snapshot_month: input.month,
    source_key: key,
    source_kind: input.sourceKind,
    line_key: row.lineKey,
    marketplace: input.marketplace ?? null,
    cabinet_id: input.cabinet?.id || null,
    organization_id: input.cabinet?.organization_id ?? null,
    legal_entity_id: input.legalEntity?.id ?? null,
    article: row.article,
    product_name: row.name,
    location_name: row.locationName,
    reference: row.reference,
    quantity: row.quantity,
    cost_rub: row.costRub,
    packaging_rub: row.packagingRub,
    unit_value: row.unitValue,
    total_value: row.totalValue,
    captured_at: input.capturedAt,
  }));
  const error = await chunkedUpsert("balance_marketplace_stock_lines", lines, "snapshot_month,source_key,line_key");
  if (error) throw new Error(error);
  return summary;
}

async function fulfillmentLines(cutoff: string, legalEntityIds: ReadonlySet<string>): Promise<ValuedMarketplaceStock[]> {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase не настроен");
  const result = await db.rpc("balance_fulfillment_as_of", { p_cutoff: cutoff });
  if (result.error) throw new Error(result.error.message);
  return ((result.data ?? []) as FulfillmentRow[]).filter((row) => legalEntityIds.has(String(row.legal_entity_id))).map((row) => {
    const quantity = Number(row.qty);
    const costRub = Number(row.unit_cost) > 0 ? Number(row.unit_cost) : null;
    return {
      lineKey: `${row.warehouse_id}:${row.variant_id}`,
      article: String(row.article),
      name: [String(row.product_name ?? ""), String(row.size_label ?? "")].filter(Boolean).join(" · ") || String(row.article),
      locationName: String(row.warehouse_name),
      reference: null,
      quantity,
      costRub,
      packagingRub: costRub === null ? null : 0,
      unitValue: costRub === null ? null : round2(costRub),
      totalValue: costRub === null ? null : round2(Number(row.amount) || costRub * quantity),
    };
  });
}

async function supplierTransitLines(cabinetIds: ReadonlySet<string>): Promise<ValuedMarketplaceStock[]> {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase не настроен");
  const result = await db.from("supplier_shipments")
    .select("id,status,supplier_shipment_items(nm_id,article,quantity),purchase_orders!inner(cabinet_id,order_number,supplier,currency,exchange_rate,purchase_order_items(nm_id,article,name,unit_price))")
    .in("status", ["shipped", "customs", "arrived"]);
  if (result.error) throw new Error(result.error.message);
  const lines: ValuedMarketplaceStock[] = [];
  for (const raw of result.data ?? []) {
    const row = raw as unknown as Record<string, unknown>;
    const orderRaw = Array.isArray(row.purchase_orders) ? row.purchase_orders[0] : row.purchase_orders;
    const order = (orderRaw ?? {}) as Record<string, unknown>;
    if (!cabinetIds.has(String(order.cabinet_id ?? ""))) continue;
    const orderItems = (Array.isArray(order.purchase_order_items) ? order.purchase_order_items : []) as Record<string, unknown>[];
    const byNm = new Map(orderItems.map((item) => [Number(item.nm_id), item]));
    for (const itemRaw of (Array.isArray(row.supplier_shipment_items) ? row.supplier_shipment_items : []) as Record<string, unknown>[]) {
      const nmId = Number(itemRaw.nm_id);
      const orderItem = byNm.get(nmId);
      const quantity = Number(itemRaw.quantity ?? 0);
      const exchangeRate = Number(order.exchange_rate ?? 0);
      const unitPrice = Number(orderItem?.unit_price ?? 0);
      const costRub = unitPrice > 0 && exchangeRate > 0 ? round2(unitPrice * exchangeRate) : null;
      const article = String(itemRaw.article || orderItem?.article || `NM:${nmId}`);
      lines.push({
        lineKey: `${String(row.id)}:${nmId}`,
        article,
        name: String(orderItem?.name || article),
        locationName: "В пути от поставщика",
        reference: [String(order.order_number ?? ""), String(order.supplier ?? ""), String(row.status ?? "")].filter(Boolean).join(" · "),
        quantity,
        costRub,
        packagingRub: costRub === null ? null : 0,
        unitValue: costRub,
        totalValue: costRub === null ? null : round2(costRub * quantity),
      });
    }
  }
  return lines;
}

export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;
  const startedAt = new Date();
  const window = moscowMonthSnapshot(startedAt);
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const reconcileFulfillment = request.nextUrl.searchParams.get("reconcile") === "fulfillment";
  const reconciliation = fulfillmentReconciliation(startedAt);
  if (!dryRun && !reconcileFulfillment && !window.allowed) {
    return NextResponse.json({ ok: true, skipped: true, reason: `Снимок только 1-го числа в 00:01 МСК; сейчас ${window.date} ${window.time}` });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const capturedAt = startedAt.toISOString();
  const monthCutoff = reconciliation.cutoff;
  let affected = 0;
  const errors: string[] = [];
  const summaries: Awaited<ReturnType<typeof saveSource>>[] = [];
  const cashSummaries: Awaited<ReturnType<typeof saveCashSnapshot>>[] = [];
  try {
    const [reportingScope, companyScopes] = await Promise.all([loadGroupReportingScope(), loadBalanceCompanyScopes()]);
    const reportingEntities = [...new Map(companyScopes.flatMap((scope) => scope.legalEntities).map((entity) => [entity.id, entity])).values()];
    if (reconcileFulfillment) {
      const reconciled = [];
      for (const entity of reportingEntities) {
        const entityIds = new Set([entity.id]);
        const [lines, finality] = await Promise.all([
          fulfillmentLines(monthCutoff, entityIds),
          fulfillmentFinality(reconciliation.closeThrough, entityIds),
        ]);
        reconciled.push(await saveSource({
          month: window.month,
          capturedAt,
          sourceKind: "fulfillment",
          sourceLabel: `Фулфилмент · ${entity.name}`,
          legalEntity: entity,
          lines,
          provisional: !finality.final,
          snapshotCutoff: monthCutoff,
        }));
      }
      const unclosedEntities = reconciled.filter((summary) => summary.provisional).map((summary) => summary.sourceLabel);
      const rows = reconciled.reduce((sum, summary) => sum + summary.rows, 0);
      const note = unclosedEntities.length ? `предварительно; период не закрыт: ${unclosedEntities.join(", ")}` : "период закрыт, финальная сверка";
      await writeSyncLog("balance-fulfillment-reconcile", "ok", rows, note, startedAt);
      return NextResponse.json({ ok: true, mode: "fulfillment-reconcile", month: window.month, capturedAt, closeThrough: reconciliation.closeThrough, unclosedEntities, summaries: reconciled });
    }
    const [costRows, cabinetRows, wbTargets, ozonScope] = await Promise.all([
      loadCosts(),
      db.from("wb_cabinets").select("id,name,organization_id").eq("is_active", true),
      getWbSyncTargets(),
      getOzonCabinetScope("all"),
    ]);
    if (cabinetRows.error) throw new Error(cabinetRows.error.message);
    const metaById = new Map(((cabinetRows.data ?? []) as CabinetMeta[]).map((row) => [String(row.id), row]));

    for (const entity of reportingEntities) {
      try {
        const entityIds = new Set([entity.id]);
        const [lines, finality] = await Promise.all([
          fulfillmentLines(dryRun ? capturedAt : monthCutoff, entityIds),
          dryRun ? Promise.resolve({ final: false, unclosed: [] as string[] }) : fulfillmentFinality(reconciliation.closeThrough, entityIds),
        ]);
        const summary = await saveSource({ month: window.month, capturedAt, sourceKind: "fulfillment", sourceLabel: `Фулфилмент · ${entity.name}`, legalEntity: entity, lines, persist: !dryRun, provisional: !dryRun && !finality.final, snapshotCutoff: dryRun ? capturedAt : monthCutoff });
        summaries.push(summary);
        affected += summary.rows;
      } catch (error) {
        errors.push(`Фулфилмент ${entity.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    for (const cabinetId of reportingScope.cabinetIds) {
      const cabinet = metaById.get(cabinetId);
      if (!cabinet) continue;
      try {
        const lines = await supplierTransitLines(new Set([cabinetId]));
        const summary = await saveSource({ month: window.month, capturedAt, sourceKind: "supplier_transit", sourceLabel: `В пути · ${cabinet.name}`, cabinet, lines, persist: !dryRun });
        summaries.push(summary);
        affected += summary.rows;
      } catch (error) {
        errors.push(`В пути ${cabinet.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const reportingWbTargets = wbTargets.filter((target) => target.cabinetId && reportingScope.cabinetIds.has(target.cabinetId));
    const wbCatalogIndex = await loadWbCatalogIndex(reportingWbTargets.flatMap((target) => target.cabinetId ? [target.cabinetId] : []));
    for (const group of groupWbStatisticsTargets(reportingWbTargets)) {
      try {
        const remains = await fetchWarehouseRemains({ token: group[0].statsToken });
        for (const target of group) {
          const byNm = new Map<number, number>();
          const productScope = balanceWbProductScope(target.name, target.productScope);
          const catalogByNm = target.cabinetId ? wbCatalogIndex.get(target.cabinetId) : null;
          for (const row of remainsToStockRows(remains.filter((item) => allowsProduct(productScope, item.nmId, catalogByNm?.get(item.nmId)?.brand)))) {
            if (!isWbWarehouse(row.warehouse)) continue;
            const quantity = Number(row.quantity ?? 0);
            if (quantity > 0) byNm.set(row.nm_id, (byNm.get(row.nm_id) ?? 0) + quantity);
          }
          const cabinet = target.cabinetId ? metaById.get(target.cabinetId) : null;
          const stocks: MarketplaceStockInput[] = [...byNm].map(([nmId, quantity]) => ({ article: catalogByNm?.get(nmId)?.article ?? `WB:${nmId}`, quantity, lineKey: String(nmId), locationName: `Склад WB · ${cabinet?.name ?? target.name}` }));
          const lines = valueMarketplaceStocks(stocks, costsForOrganization(costRows, cabinet?.organization_id ?? null));
          const summary = await saveSource({
            month: window.month, capturedAt, sourceKind: "wb", sourceLabel: `Склад WB · ${cabinet?.name ?? target.name}`,
            marketplace: "wb", cabinet: cabinet ?? { id: target.cabinetId ?? "", name: target.name, organization_id: null }, lines, persist: !dryRun,
          });
          summaries.push(summary);
          affected += summary.rows;
        }
      } catch (error) {
        errors.push(`WB ${group.map((item) => item.name).join(", ")}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Денежный баланс WB относится ко всему seller, а не к бренду внутри
    // виртуального кабинета. Поэтому один общий API-вызов и одна строка на
    // группу токенов: NORVIA/Heaton не удваивают одну и ту же сумму.
    for (const sellerGroup of groupWbStatisticsTargets(wbTargets)) {
      const group = sellerGroup.filter((item) => item.cabinetId && reportingScope.cabinetIds.has(item.cabinetId));
      if (!group.length) continue;
      const excluded = sellerGroup.filter((item) => item.cabinetId && !reportingScope.cabinetIds.has(item.cabinetId));
      const representative = group.find((item) => item.cabinetId && metaById.has(item.cabinetId));
      if (!representative?.cabinetId) continue;
      const cabinet = metaById.get(representative.cabinetId)!;
      const label = group.map((item) => metaById.get(item.cabinetId ?? "")?.name ?? item.name).join(" / ");
      const key = privateSourceKey("wb", group[0].statisticsSourceKey || group[0].statsToken);
      if (excluded.length) {
        const message = `Общий seller также содержит исключённые кабинеты: ${excluded.map((item) => item.name).join(", ")}. WB не разбивает денежный баланс по брендам`;
        cashSummaries.push(await saveCashSnapshot({
          month: window.month, sourceKey: key, marketplace: "wb", cabinet,
          cabinetName: label, amount: null, capturedAt, error: message, persist: !dryRun,
        }));
        errors.push(`Деньги WB ${label}: ${message}`);
        continue;
      }
      try {
        const balance = await fetchWbAccountBalance(group[0].statsToken);
        const summary = await saveCashSnapshot({
          month: window.month, sourceKey: key, marketplace: "wb", cabinet,
          cabinetName: label, amount: balance.current, availableAmount: balance.forWithdraw,
          currency: balance.currency, capturedAt, persist: !dryRun,
        });
        cashSummaries.push(summary);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        cashSummaries.push(await saveCashSnapshot({
          month: window.month, sourceKey: key, marketplace: "wb", cabinet,
          cabinetName: label, amount: null, capturedAt, error: message, persist: !dryRun,
        }));
        errors.push(`Деньги WB ${label}: ${message}`);
      }
    }

    if (ozonScope.ok) {
      for (const cabinet of ozonScope.scope.cabinets.filter((item) => reportingScope.cabinetIds.has(item.id))) {
        try {
          const warehouses = await ozonStocks(cabinet.creds, { fresh: true });
          if (!warehouses.ok) throw new Error(warehouses.error);
          const meta = metaById.get(cabinet.id) ?? { id: cabinet.id, name: cabinet.name, organization_id: null };
          const stocks = warehouses.rows.map((row) => ({ article: row.article, name: row.name, quantity: row.free + row.reserved, lineKey: `${row.article}:${row.warehouse}`, locationName: `Склад Ozon · ${cabinet.name}${row.warehouse ? ` · ${row.warehouse}` : ""}` }));
          const lines = valueMarketplaceStocks(stocks, costsForOrganization(costRows, meta.organization_id));
          const summary = await saveSource({
            month: window.month, capturedAt, sourceKind: "ozon", sourceLabel: `Склад Ozon · ${cabinet.name}`,
            marketplace: "ozon", cabinet: meta, lines, persist: !dryRun,
          });
          summaries.push(summary);
          affected += summary.rows;
        } catch (error) {
          errors.push(`Ozon ${cabinet.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
        const meta = metaById.get(cabinet.id) ?? { id: cabinet.id, name: cabinet.name, organization_id: null };
        const key = privateSourceKey("ozon", cabinet.id);
        const balance = await ozonMarketplaceBalance(cabinet.creds, window.month);
        if (balance.ok) {
          cashSummaries.push(await saveCashSnapshot({
            month: window.month, sourceKey: key, marketplace: "ozon", cabinet: meta,
            amount: balance.balance.closing, availableAmount: null, currency: balance.balance.currency,
            capturedAt, persist: !dryRun,
          }));
        } else {
          cashSummaries.push(await saveCashSnapshot({
            month: window.month, sourceKey: key, marketplace: "ozon", cabinet: meta,
            amount: null, capturedAt, error: balance.error, persist: !dryRun,
          }));
          errors.push(`Деньги Ozon ${cabinet.name}: ${balance.error}`);
        }
      }
    } else {
      errors.push(`Ozon: ${ozonScope.error}`);
    }

    const status = errors.length ? "partial" : "ok";
    if (!dryRun) await writeSyncLog("balance-monthly-stock", status, affected, errors.join("; ") || null, startedAt);
    return NextResponse.json({ ok: errors.length === 0, mode: dryRun ? "dry-run" : "snapshot", persisted: !dryRun, month: window.month, capturedAt, rows: affected, summaries, cashSummaries, errors }, { status: errors.length ? 207 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось собрать месячный остаток";
    await writeSyncLog("balance-monthly-stock", "error", affected, message, startedAt);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
