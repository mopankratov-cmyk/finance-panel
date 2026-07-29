import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireApiSession } from "@/lib/auth/apiGuard";

export async function GET() {
  const gate = await requireApiSession(["director", "finance"]);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Серверная база не настроена" }, { status: 503 });
  const { data, error } = await db
    .from("finance_tasks")
    .select("id,text,status,source,author_name,result_text,created_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tasks: data ?? [] });
}

export async function PATCH(request: Request) {
  const gate = await requireApiSession(["director", "finance"]);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Серверная база не настроена" }, { status: 503 });
  const body = await request.json() as { id?: number; status?: string; resultText?: string };
  if (!body.id || !["new", "in_progress", "done", "cancelled"].includes(body.status ?? "")) {
    return NextResponse.json({ error: "Некорректная задача или статус" }, { status: 400 });
  }
  const { error } = await db.from("finance_tasks").update({
    status: body.status,
    result_text: body.resultText?.trim() || null,
    updated_at: new Date().toISOString(),
  }).eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
