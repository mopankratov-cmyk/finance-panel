import type { MonthlyOpiuAmount, MonthlyOpiuRow, MonthlyOpiuStatement } from "./monthlyStatement";

function safeSheetName(value: string): string {
  return value.replace(/[\\/?*\[\]:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) || "ОПиУ";
}

function stableSheetKey(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function displayedValue(amount: MonthlyOpiuAmount, row: MonthlyOpiuRow): string | number {
  const value = amount.value ?? (amount.status === "partial" ? amount.known : null);
  if (value == null) return "";
  return row.kind === "percent" ? value / 100 : value;
}

export interface MonthlyOpiuSheetColumn {
  label: string;
  statement: MonthlyOpiuStatement;
  direction: "wb" | "ozon";
}

export interface MonthlyOpiuSheetPayload {
  sheetName: string;
  rows: Array<Array<string | number>>;
}

export function buildMonthlyOpiuSheetPayload(
  statement: MonthlyOpiuStatement,
  context: { monthKey: string; monthLabel: string; generatedAt: string; companyKey?: string; companyLabel?: string; columns?: MonthlyOpiuSheetColumn[] },
): MonthlyOpiuSheetPayload {
  const companyLabel = context.companyLabel?.trim() || "Все компании";
  const columns = context.columns?.length ? context.columns : [
    { label: "WB", statement, direction: "wb" as const },
    { label: "Ozon", statement, direction: "ozon" as const },
  ];
  const width = columns.length + 3;
  const blankRow = () => Array.from({ length: width - 1 }, () => "");
  const rows: Array<Array<string | number>> = [
    [`ОПиУ · ${companyLabel} · ${context.monthLabel}`, ...blankRow()],
    ["ФАКТ", ...blankRow()],
    ["Период", context.monthLabel, ...Array.from({ length: width - 2 }, () => "")],
    ["Компания", companyLabel, ...Array.from({ length: width - 2 }, () => "")],
    ["Обновлено", context.generatedAt, ...Array.from({ length: width - 2 }, () => "")],
    ["Статья", ...columns.map((column) => column.label), "Общие", "Итого"],
  ];
  for (const row of statement.rows) {
    if (row.kind === "section") {
      rows.push([row.label, ...blankRow()]);
      continue;
    }
    rows.push([
      row.label,
      ...columns.map((column) => {
        const sourceRow = column.statement.rows.find((candidate) => candidate.id === row.id);
        return sourceRow ? displayedValue(sourceRow.amounts[column.direction], sourceRow) : "";
      }),
      displayedValue(row.amounts.shared, row),
      displayedValue(row.amounts.total, row),
    ]);
  }
  const identity = `${context.monthKey.trim()}|${context.companyKey?.trim() || companyLabel}`;
  return { sheetName: safeSheetName(`ОПиУ ${context.monthKey} ${stableSheetKey(identity)} ${companyLabel}`), rows };
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
