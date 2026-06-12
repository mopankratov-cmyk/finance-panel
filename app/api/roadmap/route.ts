import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

interface Row {
  id: number;
  title: string;
  body: string | null;
  status: string;
  priority: number;
}

function toItem(r: Row) {
  return { id: r.id, title: r.title, summary: r.body ?? "", details: "", status: r.status, priority: r.priority, tags: [] as string[] };
}

// Контракт inferno: GET → {items:[...]}; POST → {item}
export async function GET() {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ items: [] });
  const { data, error } = await db.from("roadmap").select("id, title, body, status, priority").order("created_at", { ascending: false });
  if (error) return NextResponse.json({ items: [], error: error.message });
  return NextResponse.json({ items: (data as Row[]).map(toItem) });
}

export async function POST(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const b = await request.json().catch(() => ({}));
  if (!b.title) return NextResponse.json({ error: "Нужен title" }, { status: 400 });
  const { data, error } = await db
    .from("roadmap")
    .insert({ title: b.title, body: b.summary || b.details || null, status: b.status || "todo", priority: b.priority ?? 5 })
    .select("id, title, body, status, priority")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: toItem(data as Row) });
}
