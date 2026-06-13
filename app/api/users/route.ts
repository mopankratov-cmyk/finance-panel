import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getServerSession } from "@/lib/auth/server";
import { hashPassword } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

async function requireDirector() {
  const s = await getServerSession();
  return s && s.role === "director" ? s : null;
}

export async function GET() {
  if (!(await requireDirector())) return NextResponse.json({ error: "Доступ только для директора" }, { status: 403 });
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ users: [] });
  const { data } = await db.from("app_users").select("id, email, role, cabinet_ids, is_active, created_at").order("created_at");
  return NextResponse.json({ users: data ?? [] });
}

export async function POST(request: NextRequest) {
  if (!(await requireDirector())) return NextResponse.json({ error: "Доступ только для директора" }, { status: 403 });
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const b = (await request.json().catch(() => ({}))) as { email?: string; password?: string; role?: string; cabinet_ids?: string[] };
  const email = (b.email || "").trim().toLowerCase();
  const role = ["director", "finance", "manager"].includes(b.role || "") ? b.role : "manager";
  if (!email || !b.password || b.password.length < 6) return NextResponse.json({ error: "Email и пароль (≥6 символов)" }, { status: 400 });
  const password_hash = await hashPassword(b.password);
  const { data: existing } = await db.from("app_users").select("id").eq("email", email).maybeSingle();
  let error;
  if (existing) ({ error } = await db.from("app_users").update({ role, cabinet_ids: b.cabinet_ids ?? [], password_hash, is_active: true }).eq("id", existing.id));
  else ({ error } = await db.from("app_users").insert({ email, password_hash, role, cabinet_ids: b.cabinet_ids ?? [], is_active: true }));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
