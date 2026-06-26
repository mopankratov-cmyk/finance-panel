import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { collectBalances, SERVICE_REGISTRY } from "@/lib/factory/balances";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Дашборд балансов сервисов завода.
//   GET  → { ok, services:[{service,label,balance,currency,source,low,threshold,history,...}], low:[...], updated_at }
//          Живой опрос баланс-способных сервисов (virlo/creatify/fal) + последний снимок для manual/estimated.
//          Пишет свежий api-снимок в историю (троттлинг 30 мин) — тренд растёт и без крона.
//   POST { service, threshold?, balance?, currency?, notes? }
//          threshold → порог предупреждения (service_thresholds). balance → ручной баланс (снимок source=manual).
// Всё в одном try/catch → всегда JSON (принятый в проекте паттерн). Ключи берутся из env (владелец → Vercel).

const SERVICES = new Set(SERVICE_REGISTRY.map((s) => s.service));
const THROTTLE_MS = 30 * 60 * 1000; // не чаще снимка раз в 30 мин на GET
function emptyServices() {
  return SERVICE_REGISTRY.map((s) => ({
    ...s,
    balance: null,
    currency: s.unit,
    source: s.capability === "api" ? "api" : s.capability,
    threshold: null,
    low: false,
    updated_at: null,
    history: [],
    note: "баланс временно недоступен",
  }));
}

export async function GET() {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: true, services: emptyServices(), low: [], warning: "Supabase не настроен — балансы временно пустые", updated_at: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
    const services = await collectBalances(db, { persist: true, throttleMs: THROTTLE_MS });
    const low = services.filter((s) => s.low).map((s) => s.service);
    return NextResponse.json(
      { ok: true, services, low, updated_at: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json({ ok: true, services: emptyServices(), low: [], warning: "балансы упали: " + String((e as Error)?.message || e).slice(0, 160), updated_at: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const service = String(body.service || "").trim();
    if (!SERVICES.has(service)) return NextResponse.json({ error: `неизвестный сервис: ${service || "(пусто)"}` }, { status: 400 });

    const meta = SERVICE_REGISTRY.find((s) => s.service === service)!;
    const hasThreshold = body.threshold !== undefined;
    const hasBalance = body.balance !== undefined && body.balance !== null && body.balance !== "";
    if (!hasThreshold && !hasBalance) return NextResponse.json({ error: "нужен threshold и/или balance" }, { status: 400 });

    // порог предупреждения (NULL = снять слежение). Сброс alerted_at — чтобы новый порог сработал сразу.
    if (hasThreshold) {
      const threshold = body.threshold === null || body.threshold === "" ? null : Number(body.threshold);
      if (threshold !== null && !Number.isFinite(threshold)) return NextResponse.json({ error: "threshold не число" }, { status: 400 });
      const { error } = await db.from("service_thresholds").upsert(
        { service, threshold, notes: typeof body.notes === "string" ? body.notes : undefined, alerted_at: null, updated_at: new Date().toISOString() },
        { onConflict: "service" },
      );
      if (error) return NextResponse.json({ error: `порог: ${error.message}` }, { status: 500 });
    }

    // ручной баланс → снимок (source=manual); становится «текущим» для manual/estimated сервисов
    if (hasBalance) {
      const balance = Number(body.balance);
      if (!Number.isFinite(balance)) return NextResponse.json({ error: "balance не число" }, { status: 400 });
      const currency = typeof body.currency === "string" && body.currency ? body.currency : meta.unit;
      const { error } = await db.from("service_balances").insert({ service, balance, currency, source: "manual", raw: { manual: true } });
      if (error) return NextResponse.json({ error: `баланс: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true, service });
  } catch (e) {
    return NextResponse.json({ error: "сохранение баланса упало: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}
