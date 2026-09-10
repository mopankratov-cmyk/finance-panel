import type { OpiuReport, OpiuTableRow } from "./buildReport";

export interface OpiuSheetExportContext {
  brandLabel: string;
  periodLabel: string;
  generatedAt: string;
}

export interface OpiuSheetPayload {
  sheetName: string;
  rows: Array<Array<string | number>>;
}

export const OPIU_SECTION_BEFORE: Partial<Record<OpiuTableRow["id"], string>> = {
  orders: "Выручка",
  commission: "Производственные расходы · Переменные",
  ads: "Прямые постоянные",
  loan_transfer: "Расходы ниже EBITDA",
};

function safeSheetName(value: string): string {
  return value.replace(/[\\/?*\[\]:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "ОПиУ";
}

function cellValue(value: number | null, row: OpiuTableRow): string | number {
  if (value == null) return "";
  if (row.kind === "percent") return value / 100;
  return row.expense ? Math.abs(value) : value;
}

export function buildOpiuSheetPayload(
  report: OpiuReport,
  context: OpiuSheetExportContext,
): OpiuSheetPayload {
  const periodColumns = report.weeks.map((week) => week.label);
  const header = ["Показатель", ...periodColumns, "Итого"];
  const width = header.length;
  const rows: Array<Array<string | number>> = [
    [`ОПиУ · ${context.brandLabel}`, ...Array.from({ length: width - 1 }, () => "")],
    ["ФАКТ", ...Array.from({ length: width - 1 }, () => "")],
    ["Период", context.periodLabel, ...Array.from({ length: Math.max(0, width - 2) }, () => "")],
    ["Обновлено", context.generatedAt, ...Array.from({ length: Math.max(0, width - 2) }, () => "")],
    Array.from({ length: width }, () => ""),
    header,
  ];

  for (const row of report.rows) {
    if (row.kind === "separator") continue;
    const section = OPIU_SECTION_BEFORE[row.id];
    if (section) rows.push([section, ...Array.from({ length: width - 1 }, () => "")]);
    rows.push([row.label, ...row.values.map((value) => cellValue(value, row))]);
  }

  return {
    sheetName: safeSheetName(`ОПиУ ${context.brandLabel} ${context.periodLabel}`),
    rows,
  };
}

export async function exportOpiuToGoogleSheets(payload: OpiuSheetPayload): Promise<{ spreadsheetUrl?: string }> {
  const response = await fetch("/api/opiu/google-sheets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sheetName: payload.sheetName,
      template: "opiu",
      rows: payload.rows,
    }),
  });
  const result = await response.json().catch(() => null) as { error?: string; spreadsheetUrl?: string } | null;
  if (!response.ok) throw new Error(result?.error ?? "Не удалось выгрузить ОПиУ в Google Таблицу");
  return { spreadsheetUrl: result?.spreadsheetUrl };
}
