import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { fetchCbrRate, isSupportedCurrency } from "@/lib/loans/exchangeRate";

export async function GET(request: Request) {
  const gate = await requireApiSession(["director", "finance"]);
  if (gate) return gate;
  const currency = new URL(request.url).searchParams.get("currency")?.toUpperCase() ?? "RUB";
  if (!isSupportedCurrency(currency)) return NextResponse.json({ error: "Неподдерживаемая валюта" }, { status: 400 });
  try {
    return NextResponse.json(await fetchCbrRate(currency));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось получить курс" }, { status: 502 });
  }
}
