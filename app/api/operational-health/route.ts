import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import {
  buildOperationalOrder,
  freshnessState,
  healthScore,
  type HealthCheck,
  type OperationalAlert,
  type RawOperationalOrder,
  type RawOperationalReceipt,
} from "@/lib/health/operations";
import { cabinetIdFromParam } from "@/lib/rnp/resolveShop";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getWbCabinet } from "@/lib/wb/cabinetTokens";
import { syncFactVerdict } from "@/lib/health/syncFacts";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === "object") : [];
const string = (value: unknown) => typeof value === "string" ? value : "";
const nullableString = (value: unknown) => typeof value === "string" && value ? value : null;
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const missingOptionalTable = (code?: string) => ["42P01", "42703", "PGRST200", "PGRST204", "PGRST205"].includes(code ?? "");

function fail(error: string, status: number) {
  return NextResponse.json({ meta: null, data: null, error }, { status });
}

function rawOrder(row: Row): RawOperationalOrder {
  return {
    id: string(row.id),
    orderNumber: string(row.order_number),
    supplier: string(row.supplier),
    status: string(row.status),
    orderDate: string(row.order_date),
    expectedReadyDate: string(row.expected_ready_date),
    receiptBatchId: nullableString(row.receipt_batch_id),
    items: rows(row.purchase_order_items).map((item) => ({ nmId: number(item.nm_id), quantity: number(item.quantity) })),
    logisticsStages: rows(row.purchase_logistics_stages)
      .sort((a, b) => number(a.position) - number(b.position))
      .map((stage) => ({
        title: string(stage.title),
        provider: string(stage.provider),
        dueDate: nullableString(stage.due_date),
        completedAt: nullableString(stage.completed_at),
        status: string(stage.status),
      })),
  };
}

function rawReceipt(row: Row): RawOperationalReceipt {
  return {
    batchId: string(row.batch_id),
    expectedAt: nullableString(row.expected_at),
    receivedAt: nullableString(row.received_at),
    status: row.status === "received" ? "received" : "expected",
  };
}

async function latestScoped(
  db: SupabaseClient,
  table: string,
  column: string,
  cabinetId: string,
  allowedNmIds: Set<number> | null,
): Promise<{ value: string | null; error: string | null }> {
  if (allowedNmIds !== null && allowedNmIds.size === 0) return { value: null, error: null };
  let query = db.from(table).select(column).eq("cabinet_id", cabinetId).order(column, { ascending: false }).limit(1);
  if (allowedNmIds !== null) query = query.in("nm_id", [...allowedNmIds]);
  const { data, error } = await query.maybeSingle();
  return { value: error ? null : nullableString((data as Row | null)?.[column]), error: error?.message ?? null };
}

function syncCheck(
  job: string,
  name: string,
  stateRow: Row | undefined,
  now: Date,
  facts?: { own: string | null; peer: string | null; peerName: string },
): HealthCheck {
  const updatedAt = nullableString(stateRow?.updated_at);
  const state = string(stateRow?.status);
  const base: HealthCheck = {
    key: job,
    name,
    state: state === "failed" ? "error" : freshnessState(updatedAt, now),
    detail: !stateRow ? "Синхронизация ещё не запускалась" : state === "failed" ? "Последний запуск завершился ошибкой" : state === "backfill" || state === "pending" ? "Идёт восстановление истории" : "Данные синхронизированы",
    updatedAt,
    href: "/sync",
  };
  // Заявленное сверяем с фактическим: «сходил» и «принёс» — разные события.
  if (!facts || base.state === "error") return base;
  const verdict = syncFactVerdict({ ...facts, today: new Date(now).toISOString().slice(0, 10) });
  return verdict ? { ...base, ...verdict } : base;
}

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const cabinetId = cabinetIdFromParam(new URL(request.url).searchParams.get("cabinet"));
  if (!cabinetId) return fail("Выберите один реальный WB-кабинет", 400);
  if (!(await hasCabinetAccess(cabinetId))) return fail("Нет доступа к кабинету", 403);
  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const cabinet = await getWbCabinet(cabinetId);
  if (!cabinet) return fail("Кабинет не найден", 404);

  // Контур определяется до чтения таблиц со SKU. Для Optima пустой allowlist
  // означает честное отсутствие продуктовых данных, а не fallback на весь кабинет.
  const allowedNmIds = cabinet.allowed_nm_ids === null ? null : new Set(cabinet.allowed_nm_ids);
  const orderSelect = "id, order_number, supplier, order_date, expected_ready_date, status, receipt_batch_id, updated_at, purchase_order_items(nm_id, quantity), purchase_logistics_stages(title, provider, due_date, completed_at, status, position)";
  let receiptQuery = db.from("purchase_receipts").select("batch_id, nm_id, expected_at, received_at, status").eq("cabinet_id", cabinetId).limit(2_000);
  if (allowedNmIds !== null && allowedNmIds.size > 0) receiptQuery = receiptQuery.in("nm_id", [...allowedNmIds]);

  const receiptPromise = allowedNmIds !== null && allowedNmIds.size === 0
    ? Promise.resolve({ data: [] as Row[], error: null })
    : receiptQuery;
  const [orderResult, receiptResult, syncResult, connectionResult, taraResult, distributionResult, runResult, stockFreshness, funnelFreshness, ordersFactFreshness, salesFactFreshness] = await Promise.all([
    db.from("purchase_orders").select(orderSelect).eq("cabinet_id", cabinetId).neq("status", "draft").neq("status", "cancelled").order("updated_at", { ascending: false }).limit(40),
    receiptPromise,
    db.from("wb_sync_state").select("job, status, updated_at").eq("cabinet_id", cabinetId).in("job", ["orders", "sales", "history-365"]),
    db.from("moysklad_connection").select("account_name, is_active, last_sync_at, last_sync_error").eq("cabinet_id", cabinetId).eq("is_active", true).maybeSingle(),
    db.from("wms_tara_imports").select("id, file_name, updated_at").eq("cabinet_id", cabinetId).eq("status", "active").maybeSingle(),
    db.from("supply_distribution_settings").select("warehouse_shares, updated_at").eq("cabinet_id", cabinetId).maybeSingle(),
    db.from("wms_order_runs").select("status, updated_at").eq("cabinet_id", cabinetId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    latestScoped(db, "wb_stocks", "synced_at", cabinetId, allowedNmIds),
    latestScoped(db, "wb_funnel_daily", "date", cabinetId, allowedNmIds),
    // Свежесть самих фактов, а не отметки о запуске: заявленное сверяется с тем,
    // что реально лежит в базе.
    latestScoped(db, "wb_orders", "date", cabinetId, allowedNmIds),
    latestScoped(db, "wb_sales", "date", cabinetId, allowedNmIds),
  ]);

  if (orderResult.error) return fail(missingOptionalTable(orderResult.error.code) ? "Контур заказов не развёрнут: примените миграцию purchase_orders" : orderResult.error.message, missingOptionalTable(orderResult.error.code) ? 503 : 500);
  if (receiptResult.error) return fail(receiptResult.error.message, 500);

  const warnings: string[] = [];
  for (const result of [syncResult, connectionResult, taraResult, distributionResult, runResult]) {
    if (result.error && missingOptionalTable(result.error.code)) warnings.push("Часть operational health недоступна: не применены операционные миграции");
    else if (result.error) warnings.push("Часть operational health временно недоступна");
  }
  if (stockFreshness.error || funnelFreshness.error) warnings.push("Не удалось определить свежесть части WB-данных");

  const scopedOrders = rows(orderResult.data).map(rawOrder).filter((order) => allowedNmIds === null || (order.items.length > 0 && order.items.every((item) => allowedNmIds.has(item.nmId))));
  const receipts = rows(receiptResult.data).map(rawReceipt);
  const now = new Date();
  const orders = scopedOrders.map((order) => buildOperationalOrder(order, receipts, now));
  const syncRows = rows(syncResult.data);
  const byJob = new Map(syncRows.map((row) => [string(row.job), row]));
  const checks: HealthCheck[] = [
    {
      key: "wb-cabinet",
      name: "WB API",
      state: cabinet.token ? "ok" : "error",
      detail: cabinet.token ? `Основной токен подключён · дополнительных ${[cabinet.token_content, cabinet.token_advert, cabinet.token_feedbacks].filter(Boolean).length}` : "Основной токен отсутствует",
      updatedAt: null,
      href: "/cabinets",
    },
    syncCheck("orders", "Заказы WB", byJob.get("orders"), now, {
      own: ordersFactFreshness.value,
      peer: salesFactFreshness.value,
      peerName: "Продажи WB",
    }),
    syncCheck("sales", "Продажи WB", byJob.get("sales"), now, {
      own: salesFactFreshness.value,
      peer: ordersFactFreshness.value,
      peerName: "Заказы WB",
    }),
    {
      key: "stocks",
      name: "Остатки WB",
      state: freshnessState(stockFreshness.value, now),
      detail: stockFreshness.value ? "Снимок остатков получен" : "Нет данных по разрешённым SKU",
      updatedAt: stockFreshness.value,
      href: "/wb/supplies",
    },
    {
      key: "funnel",
      name: "Воронка WB",
      state: freshnessState(funnelFreshness.value, now, 54, 96),
      detail: funnelFreshness.value ? "Кабинетная аналитика доступна" : "Нет данных по разрешённым SKU",
      updatedAt: funnelFreshness.value,
      href: "/wb/funnel",
    },
  ];

  const connection = connectionResult.data as Row | null;
  checks.push({
    key: "moysklad",
    name: "МойСклад",
    state: !connection ? "warning" : connection.last_sync_error ? "error" : "ok",
    detail: !connection ? "Интеграция не подключена" : connection.last_sync_error ? "Последняя проверка завершилась ошибкой" : `Подключено: ${string(connection.account_name) || "аккаунт"}`,
    updatedAt: nullableString(connection?.last_sync_at),
    href: "/wb/supplies",
  });

  const tara = taraResult.data as Row | null;
  const distribution = distributionResult.data as Row | null;
  const latestRun = runResult.data as Row | null;
  const runStatus = string(latestRun?.status);
  const hasDistribution = rows(distribution?.warehouse_shares).length > 0 || (Array.isArray(distribution?.warehouse_shares) && distribution.warehouse_shares.length > 0);
  checks.push({
    key: "wms",
    name: "WMS-конвейер",
    state: runStatus === "failed" ? "error" : tara && hasDistribution ? "ok" : "warning",
    detail: runStatus === "failed" ? "Последний WMS-запуск завершился ошибкой" : !tara ? "Нет активной готовой тары" : !hasDistribution ? "Не сохранено распределение складов" : runStatus === "created" ? "Последний заказ создан" : "Тара и распределение готовы",
    updatedAt: nullableString(latestRun?.updated_at) ?? nullableString(tara?.updated_at),
    href: "/wb/supplies",
  });

  const overdueReceipts = receipts.filter((receipt) => receipt.status === "expected" && receipt.expectedAt && Date.parse(`${receipt.expectedAt}T23:59:59Z`) < now.getTime()).length;
  checks.push({
    key: "receiving",
    name: "Приёмка",
    state: overdueReceipts ? "error" : receipts.some((receipt) => receipt.status === "expected") ? "warning" : "ok",
    detail: overdueReceipts ? `Просрочено строк: ${overdueReceipts}` : receipts.some((receipt) => receipt.status === "expected") ? "Есть ожидаемые поступления" : "Просрочек нет",
    updatedAt: null,
    href: "/wb/supplies",
  });

  const alerts: OperationalAlert[] = orders.flatMap((order) => order.alerts);
  if (allowedNmIds !== null && allowedNmIds.size === 0) alerts.unshift({ key: "empty-scope", severity: "critical", title: "Товарный контур кабинета пуст", detail: "Синхронизация ожидает разрешённые SKU NORVIA/RIOBOX" });
  checks.filter((check) => check.state === "error" && !["receiving"].includes(check.key)).forEach((check) => alerts.push({ key: `service:${check.key}`, severity: "critical", title: `${check.name}: требуется внимание`, detail: check.detail }));

  return NextResponse.json({
    meta: { cabinetId, generatedAt: now.toISOString(), warnings: [...new Set(warnings)] },
    data: {
      orders,
      checks,
      alerts,
      score: healthScore(checks),
      scope: { restricted: allowedNmIds !== null, count: allowedNmIds?.size ?? null },
      summary: {
        activeOrders: orders.filter((order) => order.state !== "complete").length,
        overdueOrders: orders.filter((order) => order.state === "overdue").length,
        criticalAlerts: alerts.filter((alert) => alert.severity === "critical").length,
      },
    },
    error: null,
  });
}
