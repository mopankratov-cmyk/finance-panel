import { NextRequest, NextResponse } from "next/server";

/**
 * Сборщик отпечатков фото на Mac mini — безголовый процесс со своим секретом
 * ASSORTMENT_COLLECTOR_SECRET (CRON_SECRET sensitive и на машину не
 * выгружается; серверный секрет тоже остаётся валидным). В проде без
 * секретов — отказ, а не открытая дверь.
 */
export function checkAssortmentCollectorAuth(request: NextRequest): NextResponse | null {
  const secrets = [process.env.ASSORTMENT_COLLECTOR_SECRET, process.env.CRON_SECRET].filter(Boolean);
  if (!secrets.length) {
    return process.env.NODE_ENV === "production" ? NextResponse.json({ error: "Unauthorized" }, { status: 401 }) : null;
  }
  const auth = request.headers.get("authorization");
  if (secrets.some((secret) => auth === `Bearer ${secret}`)) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
