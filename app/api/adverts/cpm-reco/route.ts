import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const WB_ADV_TOKEN = process.env.WB_TOKEN_ADVERT;
const RECO_URL = "https://advert-api.wildberries.ru/api/advert/v0/bids/recommendations";

// Рекомендованные ставки WB по кампании (advertId).
export async function GET(request: NextRequest) {
  if (!WB_ADV_TOKEN) return NextResponse.json({ error: "WB_TOKEN_ADVERT не настроен" }, { status: 500 });
  const sp = new URL(request.url).searchParams;
  const advertId = sp.get("advertId");
  const nmId = sp.get("nmId");
  if (!advertId || !nmId) return NextResponse.json({ error: "Нужны advertId и nmId" }, { status: 400 });

  try {
    const res = await fetch(`${RECO_URL}?advertId=${advertId}&nmId=${nmId}`, {
      headers: { Authorization: WB_ADV_TOKEN },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `WB ${res.status}: ${text.slice(0, 200)}` }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "error" }, { status: 500 });
  }
}
