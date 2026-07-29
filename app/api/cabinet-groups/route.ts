import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { filterCabinetGroups, type SafeCabinetGroup } from "@/lib/unit/groupListing";

export const dynamic = "force-dynamic";

export type CabinetGroup = SafeCabinetGroup;

export async function GET(req: NextRequest) {
  const gate = await requireApiSession(["director", "finance", "manager"]);
  if (gate) return gate;
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Сервис данных временно недоступен" }, { status: 503 });
  const mp = new URL(req.url).searchParams.get("mp") || "wb";
  const { data, error } = await db.from("cabinet_groups").select("id, name, marketplace, member_ids").eq("marketplace", mp).order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: "Сервис групп временно недоступен" }, { status: 503 });
  const groups = filterCabinetGroups((data ?? []).map((g) => ({
    id: g.id as number,
    name: g.name as string,
    marketplace: g.marketplace as string,
    member_ids: g.member_ids,
  })), session);
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
