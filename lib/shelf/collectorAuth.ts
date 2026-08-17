import { NextRequest, NextResponse } from "next/server";

// Сборщик «Полок» — внешний процесс на Mac владельца. CRON_SECRET в Vercel
// помечен sensitive и наружу не выгружается, поэтому у сборщика свой
// SHELF_CRON_SECRET; серверные кроны с CRON_SECRET тоже остаются валидными.
// Оба не заданы (локальный dev) — пропускаем, как checkCronAuth.
export function checkShelfCollectorAuth(request: NextRequest): NextResponse | null {
  const secrets = [process.env.CRON_SECRET, process.env.SHELF_CRON_SECRET].filter(Boolean);
  if (!secrets.length) return null;
  const auth = request.headers.get("authorization");
  if (secrets.some((secret) => auth === `Bearer ${secret}`)) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
