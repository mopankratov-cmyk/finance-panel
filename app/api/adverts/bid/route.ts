import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireApiSession } from "@/lib/auth/apiGuard";

export const dynamic = "force-dynamic";

const WB_ADV_TOKEN = process.env.WB_TOKEN_ADVERT;
const ADV_BASE = "https://advert-api.wildberries.ru";
// защита: не даём поднять ставку больше чем в 2 раза за одно изменение
const MAX_FACTOR = 2;
const MIN_BID = 100; // минимум ₽

// Текущая ставка кампании (CPM, ₽) из v2/adverts.
async function currentBid(advertId: number): Promise<number | null> {
  try {
    const res = await fetch(`${ADV_BASE}/api/advert/v2/adverts?id=${advertId}`, {
      headers: { Authorization: WB_ADV_TOKEN! },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { adverts?: { id: number; nm_settings?: { bids_kopecks?: { search?: number } }[] }[] };
    const adv = (json.adverts ?? []).find((a) => a.id === advertId);
    const kop = adv?.nm_settings?.[0]?.bids_kopecks?.search;
    return typeof kop === "number" ? Math.round(kop / 100) : null;
  } catch {
    return null;
  }
}

async function logChange(advertId: number, oldBid: number | null, newBid: number, status: string, detail: string) {
  const db = getSupabaseAdmin();
  if (db) await db.from("advert_bid_changes").insert({ advert_id: advertId, old_bid: oldBid, new_bid: newBid, status, detail: detail.slice(0, 500) });
}

export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  if (!WB_ADV_TOKEN) return NextResponse.json({ error: "WB_TOKEN_ADVERT не настроен" }, { status: 500 });
  const b = await request.json().catch(() => ({}));
  const advertId: number | null = typeof b.advertId === "number" ? b.advertId : null;
  const newBid: number | null = typeof b.newBid === "number" ? b.newBid : null;
  if (!advertId || !newBid) return NextResponse.json({ error: "Нужны advertId и newBid" }, { status: 400 });

  const oldBid = await currentBid(advertId);

  // Защита: минимум и лимит роста ×2
  if (newBid < MIN_BID) {
    await logChange(advertId, oldBid, newBid, "rejected", `ниже минимума ${MIN_BID}₽`);
    return NextResponse.json({ error: `Минимальная ставка ${MIN_BID}₽`, oldBid, newBid }, { status: 400 });
  }
  if (oldBid && newBid > oldBid * MAX_FACTOR) {
    await logChange(advertId, oldBid, newBid, "rejected", `рост >×${MAX_FACTOR} (было ${oldBid})`);
    return NextResponse.json(
      { error: `Защита: нельзя поднять больше чем в ${MAX_FACTOR}× за раз (было ${oldBid}₽, лимит ${oldBid * MAX_FACTOR}₽)`, oldBid, newBid },
      { status: 400 },
    );
  }

  // WB ожидает ставку в копейках
  const wbBody = { advertId, cpm: newBid * 100, instrument: 4 };
  try {
    const res = await fetch(`${ADV_BASE}/api/advert/v1/bids`, {
      method: "PATCH",
      headers: { Authorization: WB_ADV_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify(wbBody),
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      await logChange(advertId, oldBid, newBid, "error", `WB ${res.status}: ${text.slice(0, 200)}`);
      return NextResponse.json({ error: `WB ${res.status}: ${text.slice(0, 200)}`, oldBid, newBid, request: wbBody }, { status: 502 });
    }
    await logChange(advertId, oldBid, newBid, "ok", text.slice(0, 200));
    return NextResponse.json({ ok: true, oldBid, newBid, request: wbBody, response: text.slice(0, 200) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    await logChange(advertId, oldBid, newBid, "error", msg);
    return NextResponse.json({ error: msg, oldBid, newBid }, { status: 500 });
  }
}
