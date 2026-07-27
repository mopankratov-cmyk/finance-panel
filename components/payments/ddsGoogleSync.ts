export interface GoogleSyncResult {
  rows: number;
  sheets: string[];
  spreadsheetUrl?: string;
}

export async function syncDdsToGoogleSheets(rows: Array<Array<string | number>>): Promise<GoogleSyncResult> {
  const response = await fetch("/api/opiu/google-sheets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sheetName: "ДДС месяц", template: "dds", rows }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error ?? "Не удалось обновить Google Таблицу. Проверьте подключение владельца.");
  }
  return { rows: data.rows ?? Math.max(0, rows.length - 1), sheets: data.sheets ?? ["ДДС месяц"], spreadsheetUrl: data.spreadsheetUrl };
}
