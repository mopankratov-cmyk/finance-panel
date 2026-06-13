import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getServerSession } from "@/lib/auth/server";
import { hashPassword } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

async function director() {
  const s = await getServerSession();
  return s && s.role === "director" ? s : null;
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await director())) return NextResponse.json({ error: "Доступ только для директора" }, { status: 403 });
  const { id } = await ctx.params;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const b = (await request.json().catch(() => ({}))) as { role?: string; cabinet_ids?: string[]; is_active?: boolean; password?: string };
  const patch: Record<string, unknown> = {};
  if (b.role && ["director", "finance", "manager"].includes(b.role)) patch.role = b.role;
  if (Array.isArray(b.cabinet_ids)) patch.cabinet_ids = b.cabinet_ids;
  if (typeof b.is_active === "boolean") patch.is_active = b.is_active;
  if (b.password && b.password.length >= 6) patch.password_hash = await hashPassword(b.password);
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Нечего обновлять" }, { status: 400 });
  const { error } = await db.from("app_users").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await director();
  if (!s) return NextResponse.json({ error: "Доступ только для директора" }, { status: 403 });
  const { id } = await ctx.params;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  if (s.uid === id) return NextResponse.json({ error: "Нельзя удалить себя" }, { status: 400 });
  const { error } = await db.from("app_users").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
