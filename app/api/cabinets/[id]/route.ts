import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireApiSession } from "@/lib/auth/apiGuard";

export const dynamic = "force-dynamic";

// PATCH — переименовать / вкл-выкл кабинет: {name?, is_active?}.
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession(["director"]);
  if (gate) return gate;
  const { id } = await ctx.params;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const b = (await request.json().catch(() => ({}))) as { name?: string; is_active?: boolean };
  const patch: Record<string, unknown> = {};
  if (typeof b.name === "string" && b.name.trim()) patch.name = b.name.trim();
  if (typeof b.is_active === "boolean") patch.is_active = b.is_active;
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Нечего обновлять" }, { status: 400 });
  const { error } = await db.from("wb_cabinets").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE — удалить кабинет.
export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession(["director"]);
  if (gate) return gate;
  const { id } = await ctx.params;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const { error } = await db.from("wb_cabinets").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
