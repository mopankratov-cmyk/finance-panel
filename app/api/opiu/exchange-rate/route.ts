import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";

const ids: Record<string, string> = { USD: "R01235", EUR: "R01239", CNY: "R01375" };

export async function GET(request: Request) {
  const gate = await requireApiSession(["director", "finance"]);
  if (gate) return gate;
  const currency = new URL(request.url).searchParams.get("currency")?.toUpperCase() ?? "RUB";
  if (currency === "RUB") return NextResponse.json({ currency, rate: 1, date: new Date().toISOString().slice(0, 10), source: "RUB" });
  if (!ids[currency]) return NextResponse.json({ error: "Неподдерживаемая валюта" }, { status: 400 });
  try {
    const response = await fetch("https://www.cbr.ru/scripts/XML_daily.asp", { cache: "no-store" });
    if (!response.ok) throw new Error("Банк России не вернул курс");
    const xml = await response.text();
    const block = xml.match(new RegExp(`<Valute ID="${ids[currency]}">([\\s\\S]*?)</Valute>`))?.[1];
    const nominal = Number(block?.match(/<Nominal>([^<]+)<\/Nominal>/)?.[1] ?? 1);
    const value = Number((block?.match(/<Value>([^<]+)<\/Value>/)?.[1] ?? "").replace(",", "."));
    const date = xml.match(/Date="([^"]+)"/)?.[1] ?? "";
    if (!block || !Number.isFinite(value)) throw new Error("Курс валюты не найден");
    return NextResponse.json({ currency, rate: value / nominal, date, source: "Банк России" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось получить курс" }, { status: 502 });
  }
}
