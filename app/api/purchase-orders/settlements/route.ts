import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { purchaseOrderTotals } from "@/lib/purchases/order";
import { summarizeDiscrepancy, type DiscrepancyReceiptLine, type DiscrepancyResolution } from "@/lib/purchases/discrepancyActs";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ data: null, error: message }, { status });
}

const ACTS_TABLE_MISSING = ["42P01", "42883", "PGRST200", "PGRST202", "PGRST205"];

export interface SupplierSettlementRow {
  supplierId: string | null;
  supplierName: string;
  orderCount: number;
  ordered: number;
  paid: number;
  received: number;
  toRestock: number;
  /** balance = paid − received: сохранён для обратной совместимости и как
   *  единое число для сортировки/суммирования. advance/debt (§27.6, §8.3
   *  ТЗ) — тот же знак, разложенный на два явных поля, а не выведенный
   *  клиентом из знака balance — «аванс поставщику» и «долг компании» это
   *  два разных по смыслу состояния, а не одна цифра с минусом. */
  balance: number;
  advance: number;
  debt: number;
}

interface DbOrderRow {
  id: string;
  order_number: string;
  supplier: string;
  supplier_id: string | null;
  exchange_rate: number;
  receipt_batch_id: string | null;
  purchase_order_items: { nm_id: number; quantity: number; unit_price: number }[];
  purchase_payment_stages: { amount: number; status: string }[];
}

/**
 * «Расчёты» — сводка по поставщику: заказано / оплачено / получено / баланс.
 * Чистое чтение поверх уже существующих данных, без новой таблицы — заказано
 * и оплачено берутся из самого заказа, получено — из purchase_receipts по
 * цене ЗАКАЗА (а не stock_batches.total_amount: та цифра — фактическая
 * себестоимость склада с откатом на цену карточки и расчётный курс при
 * нехватке данных, и тянуть её сюда означало бы объяснять поставщику чужие
 * допущения склада вместо того, что реально с ним согласовано).
 */
function summarizeReceived(
  items: { nm_id: number; quantity: number; unit_price: number }[],
  receiptsByBatch: Map<string, Map<number, number>>,
  batchId: string | null,
  exchangeRate: number,
): number {
  if (!batchId) return 0;
  const receivedByNm = receiptsByBatch.get(batchId);
  if (!receivedByNm) return 0;
  let received = 0;
  for (const item of items) {
    const receivedQty = receivedByNm.get(Number(item.nm_id)) ?? 0;
    // min(...) — если пришло больше заказанного, лишнее в «получено» не
    // считаем: цена согласована на заказанное количество, а не на излишек.
    // Обратная сторона: экран не показывает сам факт перепоставки как повод
    // для разговора с поставщиком — баланс на неё не отреагирует.
    received += Math.min(receivedQty, Number(item.quantity)) * Number(item.unit_price) * exchangeRate;
  }
  return received;
}

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return errorResponse("Supabase не настроен", 500);

  const requestedCabinet = new URL(request.url).searchParams.get("cabinet");
  if (!requestedCabinet || requestedCabinet === "all") return errorResponse("Выберите один реальный кабинет", 400);
  const { cabinetId } = await resolveShopCabinet(requestedCabinet);
  if (!cabinetId) return errorResponse("Выберите один реальный кабинет", 400);
  if (!(await hasCabinetAccess(cabinetId))) return errorResponse("Нет доступа к кабинету", 403);

  const { data: orders, error } = await db
    .from("purchase_orders")
    .select("id, order_number, supplier, supplier_id, exchange_rate, receipt_batch_id, purchase_order_items(nm_id, quantity, unit_price), purchase_payment_stages(amount, status)")
    .eq("cabinet_id", cabinetId)
    .neq("status", "cancelled");
  if (error) return errorResponse(error.message, 500);

  const rows = (orders ?? []) as unknown as DbOrderRow[];
  const batchIds = [...new Set(rows.map((row) => row.receipt_batch_id).filter((value): value is string => Boolean(value)))];

  const receiptsByBatch = new Map<string, Map<number, number>>();
  // Для «к допоставке» (§27.9) нужны не только суммы по nm_id (как для денег
  // выше), а сами строки приёмки partии — та же арифметика недовоза, что уже
  // считает экран акта расхождений (lib/purchases/discrepancyActs.ts).
  const linesByBatch = new Map<string, DiscrepancyReceiptLine[]>();
  if (batchIds.length > 0) {
    const { data: receipts, error: receiptsError } = await db
      .from("purchase_receipts")
      .select("batch_id, nm_id, received_qty, expected_qty, status")
      .in("batch_id", batchIds);
    if (receiptsError) return errorResponse(receiptsError.message, 500);
    for (const receipt of receipts ?? []) {
      const batchId = String(receipt.batch_id);
      const byNm = receiptsByBatch.get(batchId) ?? new Map<number, number>();
      byNm.set(Number(receipt.nm_id), (byNm.get(Number(receipt.nm_id)) ?? 0) + Number(receipt.received_qty ?? 0));
      receiptsByBatch.set(batchId, byNm);

      const lines = linesByBatch.get(batchId) ?? [];
      lines.push({
        expected_qty: Number(receipt.expected_qty ?? 0),
        received_qty: receipt.received_qty === null ? null : Number(receipt.received_qty),
        defect_qty: null,
        status: receipt.status === "received" ? "received" : "expected",
      });
      linesByBatch.set(batchId, lines);
    }
  }

  // Недовоз, уже признанный и закрытый решением закупщика (кроме «ждать
  // допоставку»), больше не обязательство поставщика — деньгами/заменой/
  // претензией вопрос закрыт. Отсутствие таблицы актов (миграция ещё не
  // накатана) не должно ронять весь экран расчётов — тогда просто считаем
  // весь недовоз ещё не решённым, как и было до актов.
  const resolutionByBatch = new Map<string, DiscrepancyResolution>();
  if (batchIds.length > 0) {
    const { data: acts, error: actsError } = await db
      .from("discrepancy_acts")
      .select("batch_id, resolution")
      .in("batch_id", batchIds);
    if (actsError && !ACTS_TABLE_MISSING.includes(actsError.code ?? "")) return errorResponse(actsError.message, 500);
    for (const act of acts ?? []) {
      resolutionByBatch.set(String(act.batch_id), act.resolution as DiscrepancyResolution);
    }
  }

  const bySupplier = new Map<string, SupplierSettlementRow>();
  for (const row of rows) {
    const supplierName = row.supplier?.trim() || "Без названия";
    // Заказы без supplierId группировать по тексту названия НЕЛЬЗЯ: два разных
    // поставщика могли ввести (или им ввели) одинаковое имя буквально —
    // справочник для того и завели, что до него совпадение имени ничего не
    // гарантировало (см. 202609140003_suppliers.sql). Сливать их долг/аванс
    // по строковому совпадению — реальный риск для денежного экрана, поэтому
    // каждый непривязанный заказ остаётся своей отдельной строкой.
    const key = row.supplier_id ?? `order:${row.id}`;
    const current = bySupplier.get(key) ?? {
      supplierId: row.supplier_id,
      supplierName: row.supplier_id ? supplierName : `${supplierName} · ${row.order_number}`,
      orderCount: 0,
      ordered: 0,
      paid: 0,
      received: 0,
      toRestock: 0,
      // balance/advance/debt пересчитываются заново для всех строк в финальном
      // .map() ниже — здесь только валидная по типу заглушка на время накопления.
      balance: 0,
      advance: 0,
      debt: 0,
    };

    const items = row.purchase_order_items ?? [];
    const exchangeRate = Number(row.exchange_rate) || 1;
    // «Заказано» тут — стоимость товара (goodsRub), не totals.totalRub с
    // логистикой и расходами: этапы оплаты по умолчанию заводятся как
    // «Оплата фабрике» и обозначают долг именно перед поставщиком, а
    // логистику/сертификацию обычно платят не ему. Сравнивать оплаченное с
    // полной стоимостью заказа занизило бы долг на сумму логистики.
    const totals = purchaseOrderTotals({
      items: items.map((item) => ({ nmId: Number(item.nm_id), article: "", name: "", quantity: Number(item.quantity), unitPrice: Number(item.unit_price) })),
      exchangeRate,
      logisticsStages: [],
      expenses: [],
    });
    const paid = (row.purchase_payment_stages ?? []).filter((stage) => stage.status === "paid").reduce((sum, stage) => sum + Number(stage.amount ?? 0), 0);
    const received = summarizeReceived(items, receiptsByBatch, row.receipt_batch_id, exchangeRate);
    const resolution = row.receipt_batch_id ? resolutionByBatch.get(row.receipt_batch_id) : undefined;
    const toRestock = resolution && resolution !== "wait_restock"
      ? 0
      : summarizeDiscrepancy(row.receipt_batch_id ? linesByBatch.get(row.receipt_batch_id) ?? [] : []).short;

    current.orderCount += 1;
    current.ordered += totals.goodsRub;
    current.paid += paid;
    current.received += received;
    current.toRestock += toRestock;
    bySupplier.set(key, current);
  }

  const suppliers = [...bySupplier.values()]
    .map((row) => {
      const balance = row.paid - row.received;
      return { ...row, balance, advance: Math.max(0, balance), debt: Math.max(0, -balance) };
    })
    .sort((a, b) => b.ordered - a.ordered);

  return NextResponse.json({ data: { suppliers }, error: null });
}
