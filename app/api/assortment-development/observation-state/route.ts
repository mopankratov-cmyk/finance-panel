import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { ASSORTMENT_ROLES } from "@/lib/assortment/constants";
import { loadHistoryState } from "@/lib/assortment/observationStateStore";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** «Состояние данных»: сколько истории наблюдений накоплено по источникам и чему на ней уже можно верить. */
export async function GET() {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  try {
    return NextResponse.json(await loadHistoryState(db), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Состояние данных не посчиталось" }, { status: 500 });
  }
}
