import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export interface CabinetGroup { id: number; name: string; marketplace: string; memberIds: string[] }

export async function GET(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ groups: [] });
  const mp = new URL(req.url).searchParams.get("mp") || "wb";
  const { data, error } = await db.from("cabinet_groups").select("id, name, marketplace, member_ids").eq("marketplace", mp).order("created_at", { ascending: true });
  if (error) return NextResponse.json({ groups: [], error: error.message });
  const groups: CabinetGroup[] = (data ?? []).map((g) => ({ id: g.id as number, name: g.name as string, marketplace: g.marketplace as string, memberIds: (g.member_ids as string[]) ?? [] }));
  return NextResponse.json({ groups });
}

export async function POST(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const body = (await req.json().catch(() => ({}))) as { name?: string; marketplace?: string; memberIds?: string[] };
  const name = (body.name || "").trim();
  const marketplace = body.marketplace === "ozon" ? "ozon" : "wb";
  const memberIds = (body.memberIds || []).filter(Boolean);
  if (!name) return NextResponse.json({ error: "Укажите название группы" }, { status: 400 });
  if (memberIds.length < 2) return NextResponse.json({ error: "Выберите минимум 2 кабинета" }, { status: 400 });

  const { data, error } = await db.from("cabinet_groups").insert({ name, marketplace, member_ids: memberIds }).select("id, name, marketplace, member_ids").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, group: { id: data.id, name: data.name, marketplace: data.marketplace, memberIds: data.member_ids } });
}
