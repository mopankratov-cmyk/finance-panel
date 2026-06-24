import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// POST — создать/обновить/переключить стратегию. id задан → update (в т.ч. toggle enabled), иначе insert.
export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const b = (await request.json().catch(() => ({}))) as {
    id?: number; name?: string; action?: string; amount?: number;
    marginFloor?: number; conditions?: unknown[]; priority?: number; enabled?: boolean;
  };

  if (b.id) {
    const patch: Record<string, unknown> = {};
    if (b.name != null) patch.name = b.name;
    if (b.action != null) patch.action = b.action;
    if (b.amount != null) patch.amount = b.amount;
    if (b.marginFloor != null) patch.margin_floor = b.marginFloor;
    if (b.conditions != null) patch.conditions = b.conditions;
    if (b.priority != null) patch.priority = b.priority;
    if (b.enabled != null) patch.enabled = b.enabled;
    const { error } = await db.from("repricer_strategies").update(patch).eq("id", b.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, id: b.id });
  }

  if (!b.name || !b.action) return NextResponse.json({ error: "Укажите name и action" }, { status: 400 });
  const { data, error } = await db
    .from("repricer_strategies")
    .insert({
      name: b.name, action: b.action, amount: b.amount ?? 5, margin_floor: b.marginFloor ?? 15,
      conditions: b.conditions ?? [], priority: b.priority ?? 100, enabled: b.enabled ?? true,
    })
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data?.id });
}
