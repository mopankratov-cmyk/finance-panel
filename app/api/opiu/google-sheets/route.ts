import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const webhookUrl = process.env.FINANCE_GOOGLE_SHEETS_WEBHOOK_URL;
  const secret = process.env.FINANCE_GOOGLE_SHEETS_SECRET;
  if (!webhookUrl || !secret) return NextResponse.json({ error: "Google Таблица не настроена" }, { status: 503 });
  const body = await request.json() as { rows?: Array<Array<string | number>> };
  if (!Array.isArray(body.rows) || !body.rows.length) return NextResponse.json({ error: "Нет строк для выгрузки" }, { status: 400 });
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, sheet: "Платёжный календарь", rows: body.rows }),
  });
  if (!response.ok) return NextResponse.json({ error: `Google Apps Script вернул ${response.status}` }, { status: 502 });
  return NextResponse.json({ ok: true, rows: body.rows.length - 1 });
}
