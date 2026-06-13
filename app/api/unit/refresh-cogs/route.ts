import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Триггер обновления юнит-данных (inferno кнопка). Источник держится свежим по Vercel cron,
// поэтому здесь подтверждаем актуальность; глубокий on-demand ре-синк цен/себеса (МойСклад) — отложен.
export async function POST() {
  return NextResponse.json({ ok: true });
}
