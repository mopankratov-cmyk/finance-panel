import { NextResponse } from "next/server";
import { creatifyBalance, creatifyReady } from "@/lib/factory/creatify";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

// Read-only кредитный индикатор Creatify для кокпита.
// Дешёвый live-check без записи в БД.
export async function GET() {
  try {
    if (!creatifyReady()) {
      return NextResponse.json({ ok: true, balance: null, currency: "credits", note: "CREATIFY_API_ID/KEY не настроены — добавь в Vercel" }, { headers: { "Cache-Control": "no-store" } });
    }
    const balance = await creatifyBalance();
    return NextResponse.json({ ok: true, ...balance }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ok: true, balance: null, currency: "credits", warning: "кредиты Creatify недоступны: " + String((e as Error)?.message || e).slice(0, 180) }, { headers: { "Cache-Control": "no-store" } });
  }
}
