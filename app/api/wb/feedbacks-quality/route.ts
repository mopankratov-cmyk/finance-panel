import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Качество отзывов по nm (карта {nm: {...}}) для дизайн-таблицы. Требует WB Feedbacks API —
// отложено (нет токена обратной связи). Пустая карта — таблица работает без украшения.
export async function GET() {
  return NextResponse.json({});
}
