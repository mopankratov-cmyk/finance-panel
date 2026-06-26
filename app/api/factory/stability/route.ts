import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadStabilitySnapshot } from "@/lib/factory/runSnapshots";
import { readStressHistorySummary } from "@/lib/factory/stabilityArtifacts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

export async function GET() {
  try {
    const db = getSupabaseAdmin();
    const stressHistoryPromise = readStressHistorySummary();
    if (!db) {
      return NextResponse.json({
        ok: true,
        partial: true,
        warning: "Supabase не настроен — DB-снимок стабильности временно пустой",
        stability: null,
        stress_history: await stressHistoryPromise,
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const [{ stability }, stressHistory] = await Promise.all([
      loadStabilitySnapshot(db, 48),
      stressHistoryPromise,
    ]);
    return NextResponse.json({
      ok: true,
      stability,
      stress_history: stressHistory,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const stressHistory = await readStressHistorySummary().catch(() => null);
    return NextResponse.json({
      ok: true,
      partial: true,
      warning: "снимок стабильности упал: " + String((e as Error)?.message || e).slice(0, 160),
      stability: null,
      stress_history: stressHistory,
    }, { headers: { "Cache-Control": "no-store" } });
  }
}
