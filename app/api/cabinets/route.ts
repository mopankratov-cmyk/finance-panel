import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { validateWbToken } from "@/lib/wb/sellerInfo";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const mask = (t: string) => (t ? "••••" + t.slice(-4) : "");

// GET — список кабинетов (токены замаскированы).
export async function GET() {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ cabinets: [] });
  const { data, error } = await db
    .from("wb_cabinets")
    .select("id, name, trade_mark, seller_id, inn, token, token_advert, token_content, is_active, created_at")
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ cabinets: [], error: error.message });
  const cabinets = (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    trade_mark: c.trade_mark,
    seller_id: c.seller_id,
    inn: c.inn,
    is_active: c.is_active,
    created_at: c.created_at,
    token_mask: mask(c.token as string),
    has_advert: !!c.token_advert,
    has_content: !!c.token_content,
  }));
  return NextResponse.json({ cabinets, count: cabinets.length });
}

// POST — добавить кабинет: {token, name?, token_advert?, token_content?}. Токен валидируется через WB.
export async function POST(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const b = (await request.json().catch(() => ({}))) as {
    token?: string; name?: string; token_advert?: string; token_content?: string;
  };
  const token = (b.token || "").trim();
  if (!token) return NextResponse.json({ error: "Укажите API-токен WB" }, { status: 400 });

  const v = await validateWbToken(token);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const row = {
    name: (b.name || "").trim() || v.seller.tradeMark || v.seller.name || "Кабинет WB",
    trade_mark: v.seller.tradeMark ?? null,
    seller_id: v.seller.sid,
    inn: v.seller.tin ?? null,
    token,
    token_advert: (b.token_advert || "").trim() || null,
    token_content: (b.token_content || "").trim() || null,
    is_active: true,
  };

  const { data, error } = await db
    .from("wb_cabinets")
    .upsert(row, { onConflict: "seller_id" })
    .select("id, name, trade_mark, seller_id, inn, is_active, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, cabinet: data });
}
