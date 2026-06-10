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

/** Ручное обновление — выбранный период или полная синхронизация */
export async function POST(request: Request) {
  let dateFrom: string | undefined;
  let dateTo: string | undefined;
  let full = false;

  try {
    const body = (await request.json()) as {
      dateFrom?: string;
      dateTo?: string;
      full?: boolean;
    };
    dateFrom = body.dateFrom;
    dateTo = body.dateTo;
    full = body.full === true;
  } catch {
    // пустое тело — синхронизируем 7 дней по умолчанию
  }

  const result = await runWbSync(full ? { full: true } : { dateFrom, dateTo });
  return NextResponse.json(result);
}
