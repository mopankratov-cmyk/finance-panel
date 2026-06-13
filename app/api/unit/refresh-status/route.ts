import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Статус обновления юнит-данных. Цены/остатки/себес держатся свежими по Vercel cron,
// поэтому on-demand обновление сразу завершено.
export async function GET() {
  return NextResponse.json({ running: false, done: true, msg: "" });
}
