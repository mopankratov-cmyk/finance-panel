import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// GET — конфиги докидывания + последние записи лога.
export async function GET() {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ configs: [], log: [] });
  const { data: configs } = await db.from("advert_docking_config").select("*").order("advert_id");
  const { data: log } = await db.from("advert_docking_log").select("*").order("created_at", { ascending: false }).limit(100);
  return NextResponse.json({ configs: configs ?? [], log: log ?? [], killSwitch: process.env.ADVERT_DOCKING_OFF === "1" });
}

// POST — создать/обновить/переключить конфиг по advert_id. apiGuard (деньги/конфиг авто-списания).
export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const b = (await request.json().catch(() => ({}))) as {
    advertId?: number; cabinet?: string; nmId?: number; name?: string;
    enabled?: boolean; hours?: number[]; amountRub?: number; thresholdRub?: number;
  };
  if (!b.advertId) return NextResponse.json({ error: "Укажите advertId" }, { status: 400 });

  const row: Record<string, unknown> = { advert_id: b.advertId, updated_at: new Date().toISOString() };
  if (b.cabinet != null) row.cabinet = b.cabinet;
  if (b.nmId != null) row.nm_id = b.nmId;
  if (b.name != null) row.name = b.name;
  if (b.enabled != null) row.enabled = b.enabled;
  if (b.hours != null) row.hours = b.hours;
  if (b.amountRub != null) row.amount_rub = b.amountRub;
  if (b.thresholdRub != null) row.threshold_rub = b.thresholdRub;

  const { error } = await db.from("advert_docking_config").upsert(row, { onConflict: "advert_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, advertId: b.advertId });
}
