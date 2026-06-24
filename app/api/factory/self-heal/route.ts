import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { internalFetch } from "@/lib/internalFetch";
import { wakeStaleRecipes } from "@/lib/factory/graphWatchdog";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function runRejudge(origin: string, body: Record<string, unknown>) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) throw new Error("CRON_SECRET не настроен");
  const r = await internalFetch(`${origin}/api/factory/graph-run/rejudge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`rejudge ${r.status}: ${String(j?.error || j?.detail || r.statusText || "ошибка").slice(0, 180)}`);
  return j;
}

// Ops-safe helper для ручного self-heal из студии:
// - action=wake    → будит зависшие running-графы по watchdog-логике;
// - action=rejudge → переоценивает otk_pass без otk_score и, если apply=true, докладывает в библиотеку.
export async function POST(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "wake");
    const origin = req.nextUrl.origin;

    if (action === "rejudge") {
      const result = await runRejudge(origin, {
        apply: body.apply === true,
        max_items: body.max_items,
        since_hours: body.since_hours,
        recipe_ids: Array.isArray(body.recipe_ids) ? body.recipe_ids : undefined,
      });
      return NextResponse.json({ ok: true, action, result }, { headers: { "Cache-Control": "no-store" } });
    }

    const result = await wakeStaleRecipes(db, origin, {
      trigger: "manual",
      staleMs: Number(body.stale_ms) || undefined,
      maxWake: Number(body.max_wake) || undefined,
    });
    return NextResponse.json({ ok: true, action: "wake", result }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "self-heal crash: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
