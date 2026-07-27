import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";

const MAX_REQUEST_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 10_000;
const MAX_COLUMNS = 100;
const MAX_CELL_LENGTH = 50_000;

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
  if (!webhookUrl || !secret) return NextResponse.json({ error: "Google Таблица не настроена" }, { status: 503 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "Выгрузка больше 10 МБ" }, { status: 413 });
  }
  const body = await request.json().catch(() => null) as {
    rows?: Array<Array<string | number>>;
    sheetName?: string;
    template?: string;
  } | null;
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  if (!Array.isArray(body.rows) || !body.rows.length) return NextResponse.json({ error: "Нет строк для выгрузки" }, { status: 400 });
  if (body.rows.length > MAX_ROWS) return NextResponse.json({ error: "В одной выгрузке допускается не более 10 000 строк" }, { status: 413 });
  if (body.rows.some((row) => !Array.isArray(row) || row.length > MAX_COLUMNS)) {
    return NextResponse.json({ error: "Некорректная структура таблицы" }, { status: 400 });
  }
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret,
      sheet: body.sheetName?.trim() || "Платёжный календарь",
      template: body.template?.trim() || "calendar",
      mode: "append_deduplicate",
      rows: body.rows.map((row) => row.map(safeCell)),
    }),
  });
  if (!response.ok) return NextResponse.json({ error: `Google Apps Script вернул ${response.status}` }, { status: 502 });
  const result = await response.json().catch(() => ({})) as {
    ok?: boolean;
    error?: string;
    spreadsheetUrl?: string;
    appended?: number;
    skipped?: number;
  };
  if (result.ok !== true) return NextResponse.json({ error: result.error || "Google Apps Script не подтвердил выгрузку" }, { status: 502 });
  return NextResponse.json({
    ok: true,
    rows: Number.isFinite(result.appended) ? result.appended : body.rows.length - 1,
    skipped: Number.isFinite(result.skipped) ? result.skipped : 0,
    sheets: [body.sheetName?.trim() || "Платёжный календарь"],
    spreadsheetUrl: result.spreadsheetUrl,
  });
}
