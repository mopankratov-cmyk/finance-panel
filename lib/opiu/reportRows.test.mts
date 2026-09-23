import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { WbReportRow } from "@/lib/wb/types";
import type { OpiuReportDateMode } from "./reportRows";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

const [{ isMissingDeliveryAmountColumnError, rowsBySaleDate }, { filterReportRowsByAllowedNmIds, reportRowForStorage }] = await Promise.all([
  import("./reportRows"),
  import("./syncReportRows"),
]);

test("agent cabinet report keeps only allowlisted nm_id rows", () => {
  const rows = [
    { rrd_id: 1, rr_dt: "2026-08-01", nm_id: 101 },
    { rrd_id: 2, rr_dt: "2026-08-01", nm_id: 202 },
    { rrd_id: 3, rr_dt: "2026-08-01", nm_id: 0 },
  ] as WbReportRow[];

  assert.deepEqual(
    filterReportRowsByAllowedNmIds(rows, new Set([202])).map((row) => row.rrd_id),
    [2],
  );
  assert.deepEqual(
    filterReportRowsByAllowedNmIds(rows, null).map((row) => row.rrd_id),
    [1, 2, 3],
  );
});

test("sale-date report uses sale_dt while preserving report-date rows", () => {
  const source: WbReportRow[] = [{
    rrd_id: 101,
    rr_dt: "2026-07-13",
    sale_dt: "2026-07-05T12:00:00+03:00",
    nm_id: 123,
    retail_amount: 1_000,
  }];

  const saleRows = rowsBySaleDate(source);

  assert.equal(saleRows[0]?.rr_dt, "2026-07-05");
  assert.equal(source[0]?.rr_dt, "2026-07-13");
});

test("sale-date report falls back to rr_dt for report-only charges", () => {
  const source: WbReportRow[] = [{
    rrd_id: 102,
    rr_dt: "2026-07-20",
    sale_dt: undefined,
    supplier_oper_name: "Удержание",
    deduction: 500,
  }];

  assert.equal(rowsBySaleDate(source)[0]?.rr_dt, "2026-07-20");
});

test("report date mode is constrained to supported database columns", () => {
  const modes: Record<OpiuReportDateMode, string> = {
    sale: "sale_dt",
    report: "rr_dt",
  };

  assert.deepEqual(modes, { sale: "sale_dt", report: "rr_dt" });
});

test("missing delivery_amount is recognized as an optional schema lag", () => {
  assert.equal(
    isMissingDeliveryAmountColumnError(new Error("column wb_report_rows.delivery_amount does not exist")),
    true,
  );
  assert.equal(
    isMissingDeliveryAmountColumnError("Could not find the 'delivery_amount' column in the schema cache"),
    true,
  );
  assert.equal(isMissingDeliveryAmountColumnError(new Error("statement timeout")), false);
});

test("WB finance row is mapped to exact persisted money fields", () => {
  const stored = reportRowForStorage("cabinet-uuid", {
    rrd_id: 777,
    rr_dt: "2026-07-21T03:00:00+03:00",
    sale_dt: "2026-07-20T18:00:00+03:00",
    nm_id: 123456,
    sa_name: "SKU-1",
    barcode: "4600000000000",
    doc_type_name: "Продажа",
    supplier_oper_name: "Продажа",
    quantity: 2,
    retail_price: "1000",
    retail_price_withdisc_rub: "900.50",
    retail_amount: "850.25",
    ppvz_for_pay: "700.10",
    ppvz_sales_commission: "120.40",
    delivery_rub: "55.30",
    rebill_logistic_cost: "5.20",
    penalty: "1.10",
    deduction: "2.20",
    additional_payment: "3.30",
    storage_fee: "4.40",
    acceptance: "5.50",
    acquiring_fee: "6.60",
    delivery_amount: "12",
    bonus_type_name: "Тест",
    realizationreport_id: 999,
  } as unknown as WbReportRow);

  assert.deepEqual(stored, {
    cabinet_id: "cabinet-uuid",
    rr_dt: "2026-07-21",
    sale_dt: "2026-07-20",
    nm_id: 123456,
    sa_name: "SKU-1",
    barcode: "4600000000000",
    doc_type_name: "Продажа",
    supplier_oper_name: "Продажа",
    quantity: 2,
    retail_price: 1000,
    retail_price_withdisc_rub: 900.5,
    retail_amount: 850.25,
    ppvz_for_pay: 700.1,
    ppvz_sales_commission: 120.4,
    delivery_rub: 55.3,
    rebill_logistic_cost: 5.2,
    penalty: 1.1,
    deduction: 2.2,
    additional_payment: 3.3,
    storage_fee: 4.4,
    acceptance: 5.5,
    acquiring_fee: 6.6,
    delivery_amount: 12,
    cashback_discount: null,
    bonus_type_name: "Тест",
    realizationreport_id: 999,
    rrd_id: 777,
    updated_at: stored.updated_at,
  });
  assert.match(String(stored.updated_at), /^\d{4}-\d{2}-\d{2}T/);
});

test("invalid WB finance row fails closed instead of corrupting totals", () => {
  assert.throws(
    () => reportRowForStorage("cabinet-uuid", { rr_dt: "2026-07-21" }),
    /rrd_id/,
  );
  assert.throws(
    () => reportRowForStorage("cabinet-uuid", { rrd_id: 1 }),
    /rr_dt/,
  );
  assert.throws(
    () => reportRowForStorage("", { rrd_id: 1, rr_dt: "2026-07-21" }),
    /cabinet_id/,
  );
});

test("WB payout forecast reads exact report rows only for planned articles", () => {
  const reportRowsSource = readFileSync(new URL("./reportRows.ts", import.meta.url), "utf8");
  const forecastSource = readFileSync(new URL("./forecast.ts", import.meta.url), "utf8");

  assert.match(reportRowsSource, /export async function fetchForecastReportRows/);
  assert.match(reportRowsSource, /\.in\("sa_name", articleBatch\)/);
  assert.match(forecastSource, /fetchForecastReportRows/);
  assert.doesNotMatch(forecastSource, /fetchOrders\(/);
});
