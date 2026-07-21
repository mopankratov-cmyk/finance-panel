export interface GoogleSyncResult {
  rows: number;
  sheets: string[];
  spreadsheetUrl?: string;
}

export async function syncDdsToGoogleSheets(): Promise<GoogleSyncResult> {
  const response = await fetch("/api/finance/google-sheets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ factsOnly: true }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error ?? "Не удалось обновить Google Таблицу. Проверьте подключение владельца.");
  }
  return data as GoogleSyncResult;
}
