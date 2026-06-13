import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Прогресс фонового опроса активных реклам по SKU (дизайн-таблица).
// Данные о рекламе уже отдаются /api/adverts/list; здесь — завершённый «пустой» прогресс,
// чтобы поллинг inferno корректно останавливался без 404.
export async function GET() {
  return NextResponse.json({ nms: [], spent: {}, active_count: 0, checked: true, done: true });
}
