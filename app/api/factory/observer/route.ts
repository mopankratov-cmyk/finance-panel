import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadObserverPulse } from "@/lib/factory/observerPulse";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

// Read-only оперативный «пульс» завода для внешнего наблюдателя.
// GET /api/factory/observer → { ok, updated_at, heartbeat, gens, otk, runs, batches_active, signals }
// Источник данных общий с /api/factory/ops, чтобы UI и внешние наблюдатели смотрели на один и тот же pulse.

export async function GET() {
  try {
    const db = getSupabaseAdmin();
    if (!db) {
      return NextResponse.json({
        ok: true,
        partial: true,
        updated_at: new Date().toISOString(),
        error: "Supabase не настроен",
      }, { headers: { "Cache-Control": "no-store" } });
    }
    const pulse = await loadObserverPulse(db);
    return NextResponse.json(pulse, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: true,
      partial: true,
      updated_at: new Date().toISOString(),
      error: "observer crash: " + String((e as Error)?.message || e).slice(0, 160),
    }, { headers: { "Cache-Control": "no-store" } });
  }
}
