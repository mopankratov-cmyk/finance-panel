import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Позиции по поисковым запросам по дням требуют парсинга выдачи WB (нет в офиц. API).
// Отдаём пустой набор, чтобы раскрытие строки не падало. См. docs/отложено.md.
export async function GET() {
  return NextResponse.json({ words: [], days: [], deferred: true });
}
