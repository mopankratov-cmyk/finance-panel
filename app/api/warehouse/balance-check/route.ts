import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { moscowToday } from "@/lib/sync/moscowDay";
import { resolveEntity } from "@/lib/warehouse/entityAccess";

export const dynamic = "force-dynamic";

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST202", "PGRST204", "PGRST205", "42883"].includes(code ?? "");
const migrationHint = "Примените миграцию 202609150008_stock_balance_check_rpc.sql";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

interface DbRow {
  bucket: string;
  qty: number;
  amount: number;
}

/** Виды движения из stock_moves.kind, как реально встречаются в регистре —
 *  не форс-мажорно подогнанные под 8 строк формулы ТЗ §19.3, а честные. */
const KIND_LABELS: Record<string, string> = {
  receipt: "Поступления",
  return: "Возвраты (с маркетплейса)",
  shipment: "Отгрузки",
  sale: "Продажи (FBS)",
  writeoff: "Списания",
  adjustment: "Корректировки остатка (излишки и недостачи)",
  transfer: "Перемещения между складами",
};

export interface BalanceCheckLine {
  key: string;
  label: string;
  qty: number;
  amount: number;
}

export interface BalanceCheckResponse {
  asOf: string;
  from: string | null;
  opening: { qty: number; amount: number };
  closing: { qty: number; amount: number };
  lines: BalanceCheckLine[];
  /** Два пункта формулы ТЗ, для которых в регистре нет отдельного вида
   *  движения — излишки тонут внутри 'receipt'/'adjustment', возврата
   *  поставщику как понятия нет вовсе. Честно показываем «не отслеживается»,
   *  а не подставляем чужую цифру под чужой смысл. */
  untracked: { key: string; label: string }[];
  /** opening + сумма всех строк должна сойтись с closing по построению
   *  регистра (append-only) — это и есть проверка §27.28, не косметика. */
  reconciles: boolean;
}

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;

  const url = new URL(request.url);
  const scope = await resolveEntity(url.searchParams.get("entity"));
  if (!scope.ok) return fail(scope.error, scope.status);

  const asOf = url.searchParams.get("asOf")?.trim() || moscowToday();
  if (!DATE.test(asOf)) return fail("Дата — в формате ГГГГ-ММ-ДД", 400);
  const fromParam = url.searchParams.get("from")?.trim() || null;
  if (fromParam && !DATE.test(fromParam)) return fail("Дата начала периода — в формате ГГГГ-ММ-ДД", 400);
  const warehouseId = url.searchParams.get("warehouse")?.trim() || null;

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const { data, error } = await db.rpc("stock_balance_check", {
    p_legal_entity_id: scope.entity.id,
    p_as_of: asOf,
    p_from: fromParam,
    p_warehouse_id: warehouseId,
  });
  if (error) return fail(missingMigration(error.code) ? migrationHint : error.message, missingMigration(error.code) ? 503 : 500);

  const rows = (data ?? []) as DbRow[];
  const opening = rows.find((row) => row.bucket === "opening");
  const closing = rows.find((row) => row.bucket === "closing");
  const lines: BalanceCheckLine[] = rows
    .filter((row) => row.bucket !== "opening" && row.bucket !== "closing")
    .map((row) => ({ key: row.bucket, label: KIND_LABELS[row.bucket] ?? row.bucket, qty: Number(row.qty), amount: Number(row.amount) }));

  const openingQty = Number(opening?.qty ?? 0);
  const closingQty = Number(closing?.qty ?? 0);
  const linesQty = lines.reduce((sum, line) => sum + line.qty, 0);

  const payload: BalanceCheckResponse = {
    asOf,
    from: fromParam,
    opening: { qty: openingQty, amount: Number(opening?.amount ?? 0) },
    closing: { qty: closingQty, amount: Number(closing?.amount ?? 0) },
    lines,
    untracked: [
      { key: "surplus", label: "Оприходованные излишки" },
      { key: "supplier_return", label: "Возврат поставщику" },
    ],
    reconciles: openingQty + linesQty === closingQty,
  };
  return NextResponse.json({ data: payload, error: null });
}
