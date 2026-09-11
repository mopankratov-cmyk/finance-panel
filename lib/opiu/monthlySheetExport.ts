import type { MonthlyOpiuAmount, MonthlyOpiuRow, MonthlyOpiuStatement } from "./monthlyStatement";

function safeSheetName(value: string): string {
  return value.replace(/[\\/?*\[\]:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "ОПиУ";
}

function directionValue(amount: MonthlyOpiuAmount, row: MonthlyOpiuRow): string | number {
  if (amount.value == null) return "";
  return row.kind === "percent" ? amount.value / 100 : amount.value;
}

function totalValue(amount: MonthlyOpiuAmount, row: MonthlyOpiuRow): string | number {
  if (amount.value == null) return "";
  return row.kind === "percent" ? amount.value / 100 : amount.value;
}

export interface MonthlyOpiuSheetPayload {
  sheetName: string;
  rows: Array<Array<string | number>>;
}

export function buildMonthlyOpiuSheetPayload(
  statement: MonthlyOpiuStatement,
  context: { monthLabel: string; generatedAt: string; companyLabel?: string },
): MonthlyOpiuSheetPayload {
  const companyLabel = context.companyLabel?.trim() || "Все компании";
  const rows: Array<Array<string | number>> = [
    [`ОПиУ · ${companyLabel} · ${context.monthLabel}`, "", "", "", ""],
    ["ФАКТ", "", "", "", ""],
    ["Период", context.monthLabel, "", "", ""],
    ["Компания", companyLabel, "", "", ""],
    ["Обновлено", context.generatedAt, "", "", ""],
    ["Статья", "WB", "Ozon", "Общие", "Итого"],
  ];
  for (const row of statement.rows) {
    if (row.kind === "section") {
      rows.push([row.label, "", "", "", ""]);
      continue;
    }
    rows.push([
      row.label,
      directionValue(row.amounts.wb, row),
      directionValue(row.amounts.ozon, row),
      directionValue(row.amounts.shared, row),
      totalValue(row.amounts.total, row),
    ]);
  }
  return { sheetName: safeSheetName(`ОПиУ ${companyLabel} ${context.monthLabel}`), rows };
}

export async function exportMonthlyOpiuToGoogleSheets(payload: MonthlyOpiuSheetPayload): Promise<{ spreadsheetUrl?: string }> {
  const response = await fetch("/api/opiu/google-sheets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sheetName: payload.sheetName, template: "opiu_monthly", rows: payload.rows }),
  });
  const result = await response.json().catch(() => null) as { error?: string; spreadsheetUrl?: string } | null;
  if (!response.ok) throw new Error(result?.error ?? "Не удалось выгрузить ОПиУ в Google Таблицу");
  return { spreadsheetUrl: result?.spreadsheetUrl };
}
