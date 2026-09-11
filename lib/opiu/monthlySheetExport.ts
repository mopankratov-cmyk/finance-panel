import type { MonthlyOpiuAmount, MonthlyOpiuRow, MonthlyOpiuStatement } from "./monthlyStatement";

const STATUS_LABELS = {
  complete: "Полные данные",
  partial: "Частично",
  missing: "Нет данных",
  na: "Не применяется",
} as const;

function safeSheetName(value: string): string {
  return value.replace(/[\\/?*\[\]:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "ОПиУ";
}

function directionValue(amount: MonthlyOpiuAmount, row: MonthlyOpiuRow): string | number {
  if (amount.status === "na" || amount.status === "missing") return "";
  const value = amount.value ?? amount.known;
  return row.kind === "percent" ? value / 100 : value;
}

function totalValue(amount: MonthlyOpiuAmount, row: MonthlyOpiuRow): string | number {
  if (amount.value == null) return "";
  return row.kind === "percent" ? amount.value / 100 : amount.value;
}

function knownValue(amount: MonthlyOpiuAmount, row: MonthlyOpiuRow): string | number {
  if (amount.status !== "partial") return "";
  return row.kind === "percent" ? amount.known / 100 : amount.known;
}

export interface MonthlyOpiuSheetPayload {
  sheetName: string;
  rows: Array<Array<string | number>>;
}

export function buildMonthlyOpiuSheetPayload(
  statement: MonthlyOpiuStatement,
  context: { monthLabel: string; generatedAt: string },
): MonthlyOpiuSheetPayload {
  const rows: Array<Array<string | number>> = [
    [`ОПиУ · ${context.monthLabel}`, "", "", "", "", "", "", ""],
    ["ФАКТ", "", "", "", "", "", "", ""],
    ["Период", context.monthLabel, "", "", "", "", "", ""],
    ["Обновлено", context.generatedAt, "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", ""],
    ["Статья", "WB", "Ozon", "Общие", "Итого", "Известная часть", "Источник", "Полнота"],
  ];
  for (const row of statement.rows) {
    if (row.kind === "section") {
      rows.push([row.label, "", "", "", "", "", "", ""]);
      continue;
    }
    rows.push([
      row.label,
      directionValue(row.amounts.wb, row),
      directionValue(row.amounts.ozon, row),
      directionValue(row.amounts.shared, row),
      totalValue(row.amounts.total, row),
      knownValue(row.amounts.total, row),
      row.source ?? "Расчёт",
      STATUS_LABELS[row.amounts.total.status],
    ]);
  }
  return { sheetName: safeSheetName(`ОПиУ ${context.monthLabel}`), rows };
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
