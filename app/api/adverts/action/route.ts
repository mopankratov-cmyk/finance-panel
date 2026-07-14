import { NextRequest, NextResponse } from "next/server";
import { auditAdvertOperation, resolveAdvertCabinetContext } from "@/lib/adverts/cabinetGuard";

export const dynamic = "force-dynamic";

const ADV_BASE = "https://advert-api.wildberries.ru";

// action → WB endpoint + новый локальный статус
const ACTIONS: Record<string, { path: string; status: number }> = {
  start: { path: "/adv/v0/start", status: 9 },
  pause: { path: "/adv/v0/pause", status: 11 },
  stop: { path: "/adv/v0/stop", status: 7 },
};

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const advertId: number | null = typeof body.advertId === "number" ? body.advertId : null;
  const action: string = typeof body.action === "string" ? body.action : "";

  if (!advertId || !ACTIONS[action]) {
    return NextResponse.json({ error: "Неверные параметры (advertId/action)" }, { status: 400 });
  }
  const resolved = await resolveAdvertCabinetContext({ cabinetId: body.cabinetId, advertIds: [advertId] });
  if (resolved.response) return resolved.response;
  const context = resolved.context;

  const { path, status } = ACTIONS[action];
  const oldStatus = context.adverts.get(advertId)?.status ?? null;
  try {
    const url = `${ADV_BASE}${path}?id=${advertId}`;
    const res = await fetch(url, { method: "GET", headers: { Authorization: context.token }, cache: "no-store" });
    if (!res.ok) {
      const text = await res.text();
      await auditAdvertOperation({ context, advertId, action, status: "error", oldValue: oldStatus, newValue: status, wbResult: `WB ${res.status}: ${text.slice(0, 200)}` });
      return NextResponse.json({ error: `WB ${res.status}: ${text.slice(0, 200)}` }, { status: 502 });
    }
    // оптимистично обновляем статус в Supabase, чтобы UI не ждал ресинка
    await context.db.from("wb_adverts").update({ status }).eq("advert_id", advertId).eq("cabinet_id", context.cabinet.id);
    await auditAdvertOperation({ context, advertId, action, status: "ok", oldValue: oldStatus, newValue: status, wbResult: { status: res.status } });

    return NextResponse.json({ ok: true, advertId, status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await auditAdvertOperation({ context, advertId, action, status: "error", oldValue: oldStatus, newValue: status, wbResult: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
