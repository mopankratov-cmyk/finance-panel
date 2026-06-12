import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const WB_ADV_TOKEN = process.env.WB_TOKEN_ADVERT;
const ADV_BASE = "https://advert-api.wildberries.ru";

// action → WB endpoint + новый локальный статус
const ACTIONS: Record<string, { path: string; status: number }> = {
  start: { path: "/adv/v0/start", status: 9 },
  pause: { path: "/adv/v0/pause", status: 11 },
  stop: { path: "/adv/v0/stop", status: 7 },
};

export async function POST(request: NextRequest) {
  if (!WB_ADV_TOKEN) {
    return NextResponse.json({ error: "WB_TOKEN_ADVERT не настроен" }, { status: 500 });
  }
  const body = await request.json().catch(() => ({}));
  const advertId: number | null = typeof body.advertId === "number" ? body.advertId : null;
  const action: string = typeof body.action === "string" ? body.action : "";

  if (!advertId || !ACTIONS[action]) {
    return NextResponse.json({ error: "Неверные параметры (advertId/action)" }, { status: 400 });
  }

  const { path, status } = ACTIONS[action];
  try {
    const url = `${ADV_BASE}${path}?id=${advertId}`;
    const res = await fetch(url, { method: "GET", headers: { Authorization: WB_ADV_TOKEN }, cache: "no-store" });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `WB ${res.status}: ${text.slice(0, 200)}` }, { status: 502 });
    }
    // оптимистично обновляем статус в Supabase, чтобы UI не ждал ресинка
    const db = getSupabaseAdmin();
    if (db) await db.from("wb_adverts").update({ status }).eq("advert_id", advertId);

    return NextResponse.json({ ok: true, advertId, status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
