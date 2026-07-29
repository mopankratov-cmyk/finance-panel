import { NextRequest, NextResponse } from "next/server";
import { auditAdvertOperation, resolveAdvertCabinetContext } from "@/lib/adverts/cabinetGuard";

export const dynamic = "force-dynamic";

const ADV_BASE = "https://advert-api.wildberries.ru";

// Пополнение бюджета кампании. type источника: 0 — счёт, 1 — баланс, 3 — бонусы.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const advertId: number | null = typeof body.advertId === "number" ? body.advertId : null;
  const sum: number | null = typeof body.sum === "number" ? body.sum : null;
  const type: number = typeof body.type === "number" ? body.type : 1; // по умолчанию — баланс

  if (!advertId || !sum || sum < 50) {
    return NextResponse.json({ error: "Сумма пополнения минимум 50 ₽" }, { status: 400 });
  }
  const resolved = await resolveAdvertCabinetContext({ cabinetId: body.cabinetId, advertIds: [advertId] });
  if (resolved.response) return resolved.response;
  const context = resolved.context;

  try {
    const url = `${ADV_BASE}/adv/v1/budget/deposit?id=${advertId}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: context.token, "Content-Type": "application/json" },
      body: JSON.stringify({ sum, type, return: true }),
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      await auditAdvertOperation({ context, advertId, action: "deposit", status: "error", oldValue: null, newValue: { sum, type }, wbResult: `WB ${res.status}: ${text.slice(0, 200)}` });
      return NextResponse.json({ error: `WB ${res.status}: ${text.slice(0, 200)}` }, { status: 502 });
    }
    const data = await res.json().catch(() => ({}));
    await auditAdvertOperation({ context, advertId, action: "deposit", status: "ok", oldValue: null, newValue: { sum, type }, wbResult: { total: data?.total ?? null } });
    return NextResponse.json({ ok: true, advertId, total: data?.total ?? null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await auditAdvertOperation({ context, advertId, action: "deposit", status: "error", oldValue: null, newValue: { sum, type }, wbResult: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
