import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Наличие видео в карточке по nm (декоративный сигнал для дизайн-таблицы). Карта {nm: {...}}.
// Пока пусто — определение видео требует отдельного скана медиа Content API. См. docs/отложено.md.
export async function GET() {
  return NextResponse.json({});
}
