import { NextResponse } from "next/server";
import { runWbSync } from "@/lib/wb/sync";

export const maxDuration = 300;

/** Vercel Cron — каждые 3 часа, полная синхронизация */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runWbSync({ full: true });
  return NextResponse.json(result);
}

/** Ручное обновление — только выбранный период */
export async function POST(request: Request) {
  let dateFrom: string | undefined;
  let dateTo: string | undefined;

  try {
    const body = (await request.json()) as {
      dateFrom?: string;
      dateTo?: string;
    };
    dateFrom = body.dateFrom;
    dateTo = body.dateTo;
  } catch {
    // пустое тело — синхронизируем 7 дней по умолчанию
  }

  const result = await runWbSync({ dateFrom, dateTo });
  return NextResponse.json(result);
}
