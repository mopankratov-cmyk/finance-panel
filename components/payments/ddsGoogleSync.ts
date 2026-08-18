export interface GoogleSyncResult {
  rows: number;
  sheets: string[];
  spreadsheetUrl?: string;
}

export interface DdsGoogleSheet {
  name: string;
  rows: Array<Array<string | number>>;
  rowIds: string[];
}

export async function syncDdsToGoogleSheets(sheets: DdsGoogleSheet[]): Promise<GoogleSyncResult> {
  const response = await fetch("/api/opiu/google-sheets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sheets: sheets.map((sheet) => ({ sheetName: sheet.name, template: "dds", rows: sheet.rows, rowIds: sheet.rowIds })),
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error ?? "Не удалось обновить Google Таблицу. Проверьте подключение владельца.");
  }
  return {
    rows: data.rows ?? sheets.reduce((sum, sheet) => sum + Math.max(0, sheet.rows.length - 1), 0),
    sheets: data.sheets ?? sheets.map((sheet) => sheet.name),
    spreadsheetUrl: data.spreadsheetUrl,
  };
}
