import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export interface AgentInsight {
  id: number;
  module: string;
  severity: string;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
}

export async function GET(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) {
    return NextResponse.json({ data: null, error: "Supabase не настроен" }, { status: 500 });
  }
  const limit = Math.min(200, Math.max(1, Number(new URL(request.url).searchParams.get("limit")) || 50));
  const { data, error } = await db
    .from("agent_insights")
    .select("id, module, severity, title, body, is_read, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 });
  }
  const rows = (data ?? []) as AgentInsight[];
  const unread = rows.filter((r) => !r.is_read).length;
  return NextResponse.json({ data: rows, unread, error: null });
}

// Пометить инсайты прочитанными (все или по id)
export async function PATCH(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) {
    return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  }
  const body = await request.json().catch(() => ({}));
  const q = db.from("agent_insights").update({ is_read: true });
  const { error } = Array.isArray(body.ids) && body.ids.length
    ? await q.in("id", body.ids)
    : await q.eq("is_read", false);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
