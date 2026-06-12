import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WB_ADV_TOKEN = process.env.WB_TOKEN_ADVERT;
const ADV_BASE = "https://advert-api.wildberries.ru";

const ACTIONS: Record<string, { path: string; status: number }> = {
  start: { path: "/adv/v0/start", status: 9 },
  pause: { path: "/adv/v0/pause", status: 11 },
  stop: { path: "/adv/v0/stop", status: 7 },
};

// Массовое действие над набором кампаний. Между запросами — пауза (rate limit WB).
export async function POST(request: NextRequest) {
  if (!WB_ADV_TOKEN) {
    return NextResponse.json({ error: "WB_TOKEN_ADVERT не настроен" }, { status: 500 });
  }
  const b = await request.json().catch(() => ({}));
  const ids: number[] = Array.isArray(b.advertIds) ? b.advertIds.filter((x: unknown) => typeof x === "number") : [];
  const action: string = typeof b.action === "string" ? b.action : "";

  if (!ids.length || !ACTIONS[action]) {
    return NextResponse.json({ error: "Неверные параметры (advertIds/action)" }, { status: 400 });
  }

  const { path, status } = ACTIONS[action];
  const db = getSupabaseAdmin();
  const results: { advertId: number; ok: boolean; error?: string }[] = [];

  for (let i = 0; i < ids.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 700)); // мягкая пауза для rate limit
    const advertId = ids[i];
    try {
      const res = await fetch(`${ADV_BASE}${path}?id=${advertId}`, {
        method: "GET",
        headers: { Authorization: WB_ADV_TOKEN },
        cache: "no-store",
      });
      if (res.ok) {
        if (db) await db.from("wb_adverts").update({ status }).eq("advert_id", advertId);
        results.push({ advertId, ok: true });
      } else {
        results.push({ advertId, ok: false, error: `WB ${res.status}` });
      }
    } catch (err) {
      results.push({ advertId, ok: false, error: err instanceof Error ? err.message : "error" });
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  return NextResponse.json({ ok: true, total: ids.length, success: okCount, results });
}
