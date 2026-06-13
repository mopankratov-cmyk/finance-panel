import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Статус фонового обновления снапшота. Данные обновляются по расписанию (Vercel cron),
// поэтому on-demand статус сразу «готово» — поллинг inferno завершается без зависания.
export async function GET() {
  return NextResponse.json({ running: false, done: true, msg: "" });
}
