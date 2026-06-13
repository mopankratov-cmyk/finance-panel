import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Генерация XLSX «Новые_цены» (±5/10%) для загрузки в WB. Требует xlsx-экспорт +
// надёжный источник текущей цены WB (в синке пока нет) — отложено, см. docs/отложено.md.
// Отдаём понятную ошибку (UI покажет сообщение), а не 404.
export async function POST() {
  return NextResponse.json(
    { error: "Экспорт новых цен (XLSX) в разработке: нужен источник текущих цен WB" },
    { status: 501 },
  );
}
