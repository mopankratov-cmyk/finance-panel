import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export interface CtrVariant {
  id: number;
  test_id: number;
  label: string | null;
  image_url: string;
  source: string | null;
  prompt: string | null;
  is_winner: boolean;
}
export interface CtrTest {
  id: number;
  nm_id: number;
  article: string | null;
  name: string | null;
  status: string;
  created_at: string;
  variants: CtrVariant[];
}

export async function GET() {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ data: null, error: "Supabase не настроен" }, { status: 500 });
  const [testsRes, varsRes] = await Promise.all([
    db.from("ctr_tests").select("id, nm_id, article, name, status, created_at").order("created_at", { ascending: false }),
    db.from("ctr_variants").select("id, test_id, label, image_url, source, prompt, is_winner"),
  ]);
  if (testsRes.error) return NextResponse.json({ data: null, error: testsRes.error.message }, { status: 500 });
  const byTest = new Map<number, CtrVariant[]>();
  for (const v of (varsRes.data ?? []) as CtrVariant[]) {
    if (!byTest.has(v.test_id)) byTest.set(v.test_id, []);
    byTest.get(v.test_id)!.push(v);
  }
  const data: CtrTest[] = (testsRes.data ?? []).map((t) => ({ ...t, variants: byTest.get(t.id) ?? [] }));
  return NextResponse.json({ data, error: null });
}

export async function POST(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const b = await request.json().catch(() => ({}));
  if (!b.nm_id) return NextResponse.json({ error: "Нужен nm_id" }, { status: 400 });
  const { data, error } = await db
    .from("ctr_tests")
    .insert({ nm_id: b.nm_id, article: b.article ?? null, name: b.name ?? null })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function DELETE(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Нужен id" }, { status: 400 });
  const { error } = await db.from("ctr_tests").delete().eq("id", Number(id));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
