import { NextRequest, NextResponse } from "next/server";
import { resolveAdvertCabinetContext } from "@/lib/adverts/cabinetGuard";

export const dynamic = "force-dynamic";

const RECO_URL = "https://advert-api.wildberries.ru/api/advert/v0/bids/recommendations";

// Рекомендованные ставки WB по кампании (advertId).
export async function GET(request: NextRequest) {
  const sp = new URL(request.url).searchParams;
  const advertId = sp.get("advertId");
  const nmId = sp.get("nmId");
  const numericAdvertId = Number(advertId);
  if (!Number.isInteger(numericAdvertId) || numericAdvertId <= 0 || !nmId) return NextResponse.json({ error: "Нужны advertId и nmId" }, { status: 400 });
  const resolved = await resolveAdvertCabinetContext({ cabinetId: sp.get("cabinetId"), advertIds: [numericAdvertId] });
  if (resolved.response) return resolved.response;
  const context = resolved.context;

  try {
    const res = await fetch(`${RECO_URL}?advertId=${advertId}&nmId=${nmId}`, {
      headers: { Authorization: context.token },
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
