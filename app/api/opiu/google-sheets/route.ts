import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { syncFinanceSheetsDirect } from "@/lib/opiu/googleSheetsDirect";

const MAX_REQUEST_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 10_000;
const MAX_COLUMNS = 100;
const MAX_CELL_LENGTH = 50_000;
const MAX_SHEETS = 50;

type SheetPayload = {
  rows?: Array<Array<string | number>>;
  rowIds?: string[];
  sheetName?: string;
  template?: string;
};

function safeCell(value: string | number): string | number {
  if (typeof value === "number") return Number.isFinite(value) ? value : "";
  const trimmed = value.slice(0, MAX_CELL_LENGTH);
  return /^[=+\-@\t\r]/.test(trimmed) ? `'${trimmed}` : trimmed;
}

export async function POST(request: Request) {
  const gate = await requireApiSession(["director", "finance"]);
  if (gate) return gate;
  const webhookUrl = process.env.FINANCE_GOOGLE_SHEETS_WEBHOOK_URL;
  const secret = process.env.FINANCE_GOOGLE_SHEETS_SECRET;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "Выгрузка больше 10 МБ" }, { status: 413 });
  }
  const body = await request.json().catch(() => null) as {
    sheets?: SheetPayload[];
  } & SheetPayload | null;
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const sheets = Array.isArray(body.sheets) && body.sheets.length
    ? body.sheets
    : [{ rows: body.rows, rowIds: body.rowIds, sheetName: body.sheetName, template: body.template }];
  if (sheets.length > MAX_SHEETS) {
    return NextResponse.json({ error: `В одной выгрузке допускается не более ${MAX_SHEETS} листов` }, { status: 413 });
  }
  for (const sheet of sheets) {
    if (!Array.isArray(sheet.rows) || !sheet.rows.length) {
      return NextResponse.json({ error: "Нет строк для выгрузки" }, { status: 400 });
    }
    if (sheet.rows.length > MAX_ROWS) {
      return NextResponse.json({ error: "В одном листе допускается не более 10 000 строк" }, { status: 413 });
    }
    if (sheet.rows.some((row) => !Array.isArray(row) || row.length > MAX_COLUMNS)) {
      return NextResponse.json({ error: "Некорректная структура таблицы" }, { status: 400 });
    }
    if (sheet.rowIds && sheet.rowIds.length !== Math.max(0, sheet.rows.length - 1)) {
      return NextResponse.json({ error: "Количество служебных ID не совпадает с количеством строк" }, { status: 400 });
    }
  }
  const exportSheets = sheets.map((sheet) => ({
    sheet: sheet.sheetName?.trim() || "Платёжный календарь",
    template: sheet.template?.trim() || "calendar",
    rows: sheet.rows!.map((row) => row.map(safeCell)),
    rowIds: sheet.rowIds?.map((id) => String(id).slice(0, 200)),
  }));
  const syncDirectly = async () => {
    try {
      const direct = await syncFinanceSheetsDirect(exportSheets);
      return NextResponse.json({
        ok: true,
        rows: direct.appended,
        updated: direct.updated,
        skipped: direct.skipped,
        sheets: direct.sheets.map((sheet) => sheet.sheet),
        spreadsheetUrl: direct.spreadsheetUrl,
        transport: "service_account",
      });
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : "Не удалось обновить Google Таблицу через service account",
      }, { status: 502 });
    }
  };
  // Строки со стабильными ID синхронизируются напрямую: старый Apps Script
  // умеет только добавлять и не может безопасно обновлять существующие записи.
  if (exportSheets.some((sheet) => sheet.rowIds?.length)) return syncDirectly();
  if (!webhookUrl || !secret) {
    return syncDirectly();
  }
  let response: Response;
  try {
    response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret,
        mode: "append_deduplicate",
        sheets: exportSheets,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return syncDirectly();
  }
  if (!response.ok) return syncDirectly();
  const result = await response.json().catch(() => ({})) as {
    ok?: boolean;
    error?: string;
    spreadsheetUrl?: string;
    appended?: number;
    skipped?: number;
    updated?: number;
    sheets?: Array<{ sheet?: string }>;
  };
  if (result.ok !== true) return syncDirectly();
  return NextResponse.json({
    ok: true,
    rows: Number.isFinite(result.appended)
      ? result.appended
      : exportSheets.reduce((sum, sheet) => sum + Math.max(0, sheet.rows.length - 1), 0),
    skipped: Number.isFinite(result.skipped) ? result.skipped : 0,
    updated: Number.isFinite(result.updated) ? result.updated : 0,
    sheets: result.sheets?.map((sheet) => sheet.sheet).filter((name): name is string => Boolean(name))
      ?? exportSheets.map((sheet) => sheet.sheet),
    spreadsheetUrl: result.spreadsheetUrl,
  });
}
