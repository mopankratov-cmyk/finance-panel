import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * ВРЕМЕННЫЙ диагностический маршрут — удалить сразу после разведки.
 *
 * Ozon 8 сентября 2026 отключил /v3/finance/transaction/list и /totals, назвав
 * заменой /v1/finance/accrual/{postings,types,by-day}. Ни один из трёх методов
 * в проекте ещё не вызывался — неизвестна ни точная форма тела запроса, ни то,
 * даёт ли ответ разбивку по категориям начисления (нужно для П&Л по Ozon).
 * Разведка нужна один раз, чтобы не проектировать таблицы и синк вслепую.
 *
 * Ключ ниже — не переменная окружения специально: локальный .env.local и
 * прод-окружение на Vercel не гарантированно совпадают по секретам, а этот
 * маршрут читается один раз с прод-URL и сразу удаляется.
 */
const PROBE_KEY = "e156ffc7270c3c56f85c6da7d3e5e7755edf261cb21f1c72";

const BASE = "https://api-seller.ozon.ru";

async function call(clientId: string, apiKey: string, path: string, body: unknown) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "Client-Id": clientId.trim(),
        "Api-Key": apiKey.trim(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const text = await res.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch { json = text.slice(0, 2000); }
    return { status: res.status, json };
  } catch (e) {
    return { status: null, error: String(e).slice(0, 300) };
  }
}

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");
  if (key !== PROBE_KEY) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "No DB" }, { status: 500 });

  const { data: cabinets, error } = await db
    .from("wb_cabinets")
    .select("id, name, client_id, token")
    .eq("marketplace", "ozon")
    .eq("is_active", true)
    .limit(1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const cabinet = cabinets?.[0];
  if (!cabinet) return NextResponse.json({ error: "No active ozon cabinet" }, { status: 404 });

  const dateFrom = "2026-08-01T00:00:00.000Z";
  const dateTo = "2026-08-31T23:59:59.000Z";

  const [types, byDay, postings] = await Promise.all([
    call(cabinet.client_id, cabinet.token, "/v1/finance/accrual/types", {}),
    call(cabinet.client_id, cabinet.token, "/v1/finance/accrual/by-day", { date: "2026-08-15" }),
    call(cabinet.client_id, cabinet.token, "/v1/finance/accrual/postings", { date_from: dateFrom, date_to: dateTo, limit: 5 }),
  ]);

  return NextResponse.json({ cabinet: cabinet.name, types, byDay, postings });
}
