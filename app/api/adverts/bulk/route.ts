import { NextRequest, NextResponse } from "next/server";
import { auditAdvertOperation, resolveAdvertCabinetContext } from "@/lib/adverts/cabinetGuard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ADV_BASE = "https://advert-api.wildberries.ru";

const ACTIONS: Record<string, { path: string; status: number }> = {
  start: { path: "/adv/v0/start", status: 9 },
  pause: { path: "/adv/v0/pause", status: 11 },
  stop: { path: "/adv/v0/stop", status: 7 },
};

// Массовое действие над набором кампаний. Между запросами — пауза (rate limit WB).
export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => ({}));
  const ids: number[] = Array.isArray(b.advertIds) ? b.advertIds.filter((x: unknown) => typeof x === "number") : [];
  const action: string = typeof b.action === "string" ? b.action : "";

  if (!ids.length || !ACTIONS[action]) {
    return NextResponse.json({ error: "Неверные параметры (advertIds/action)" }, { status: 400 });
  }
  const resolved = await resolveAdvertCabinetContext({ cabinetId: b.cabinetId, advertIds: ids });
  if (resolved.response) return resolved.response;
  const context = resolved.context;

  const { path, status } = ACTIONS[action];
  const results: { advertId: number; ok: boolean; error?: string }[] = [];

  for (let i = 0; i < ids.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 700)); // мягкая пауза для rate limit
    const advertId = ids[i];
    try {
      const res = await fetch(`${ADV_BASE}${path}?id=${advertId}`, {
        method: "GET",
        headers: { Authorization: context.token },
        cache: "no-store",
      });
      if (res.ok) {
        await context.db.from("wb_adverts").update({ status }).eq("advert_id", advertId).eq("cabinet_id", context.cabinet.id);
        await auditAdvertOperation({ context, advertId, action, status: "ok", oldValue: context.adverts.get(advertId)?.status ?? null, newValue: status, wbResult: { status: res.status } });
        results.push({ advertId, ok: true });
      } else {
        const message = `WB ${res.status}: ${(await res.text()).slice(0, 160)}`;
        await auditAdvertOperation({ context, advertId, action, status: "error", oldValue: context.adverts.get(advertId)?.status ?? null, newValue: status, wbResult: message });
        results.push({ advertId, ok: false, error: `WB ${res.status}` });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "error";
      await auditAdvertOperation({ context, advertId, action, status: "error", oldValue: context.adverts.get(advertId)?.status ?? null, newValue: status, wbResult: message });
      results.push({ advertId, ok: false, error: message });
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  const ok = okCount === ids.length;
  return NextResponse.json(
    { ok, total: ids.length, success: okCount, failed: ids.length - okCount, results },
    { status: ok ? 200 : 502 },
  );
}
