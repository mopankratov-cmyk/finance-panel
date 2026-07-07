import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { validateMoySkladToken } from "@/lib/moysklad/api";

export const dynamic = "force-dynamic";

const mask = (t: string) => (t ? "••••" + t.slice(-4) : "");

export async function GET() {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ connected: false });
  const { data } = await db.from("moysklad_connection").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!data || !data.is_active) return NextResponse.json({ connected: false });
  return NextResponse.json({
    connected: true,
    accountName: data.account_name as string | null,
    tokenMask: mask(data.token as string),
    lastSyncAt: data.last_sync_at as string | null,
    lastSyncError: data.last_sync_error as string | null,
  });
}

// POST — сохранить и проверить токен (валидация до записи, добавится только рабочий).
export async function POST(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const body = (await request.json().catch(() => ({}))) as { token?: string };
  const token = (body.token || "").trim();
  if (!token) return NextResponse.json({ error: "Укажите API-токен МойСклад" }, { status: 400 });

  const v = await validateMoySkladToken(token);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const { data: existing } = await db.from("moysklad_connection").select("id").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const row = { token, account_name: v.accountName, is_active: true, last_sync_error: null, updated_at: new Date().toISOString() };
  const { error } = existing?.id
    ? await db.from("moysklad_connection").update(row).eq("id", existing.id)
    : await db.from("moysklad_connection").insert(row);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, accountName: v.accountName });
}

// DELETE — отключить (не удаляем строку, чтобы сохранить историю last_sync_*).
export async function DELETE() {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const { error } = await db.from("moysklad_connection").update({ is_active: false }).eq("is_active", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
