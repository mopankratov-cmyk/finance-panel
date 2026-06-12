import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const WB_ADV_TOKEN = process.env.WB_TOKEN_ADVERT;
const ADV_BASE = "https://advert-api.wildberries.ru";

// Пополнение бюджета кампании. type источника: 0 — счёт, 1 — баланс, 3 — бонусы.
export async function POST(request: NextRequest) {
  if (!WB_ADV_TOKEN) {
    return NextResponse.json({ error: "WB_TOKEN_ADVERT не настроен" }, { status: 500 });
  }
  const body = await request.json().catch(() => ({}));
  const advertId: number | null = typeof body.advertId === "number" ? body.advertId : null;
  const sum: number | null = typeof body.sum === "number" ? body.sum : null;
  const type: number = typeof body.type === "number" ? body.type : 1; // по умолчанию — баланс

  if (!advertId || !sum || sum < 50) {
    return NextResponse.json({ error: "Сумма пополнения минимум 50 ₽" }, { status: 400 });
  }

  try {
    const url = `${ADV_BASE}/adv/v1/budget/deposit?id=${advertId}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: WB_ADV_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ sum, type, return: true }),
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `WB ${res.status}: ${text.slice(0, 200)}` }, { status: 502 });
    }
    const data = await res.json().catch(() => ({}));
    return NextResponse.json({ ok: true, advertId, total: data?.total ?? null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
