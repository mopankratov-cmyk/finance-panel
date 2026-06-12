import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export interface CardChange {
  id: number;
  nm_id: number;
  article: string | null;
  change_type: string;
  note: string | null;
  old_value: string | null;
  new_value: string | null;
  date: string;
  // эффект: ср. заказы/день за 7 дней до и после изменения
  ordersBefore: number | null;
  ordersAfter: number | null;
  effectPct: number | null;
}

const WINDOW = 7;

export async function GET() {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ data: null, error: "Supabase не настроен" }, { status: 500 });

  const { data: changes, error } = await db
    .from("card_changes")
    .select("id, nm_id, article, change_type, note, old_value, new_value, date")
    .order("date", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ data: null, error: error.message }, { status: 500 });

  const rows = changes ?? [];
  const nmIds = [...new Set(rows.map((r) => r.nm_id))];

  // воронка по этим nm для расчёта эффекта
  const byNmDate = new Map<string, number>();
  if (nmIds.length) {
    const { data: funnel } = await db
      .from("wb_funnel_daily")
      .select("nm_id, date, orders")
      .in("nm_id", nmIds);
    for (const f of funnel ?? []) {
      byNmDate.set(`${f.nm_id}|${String(f.date).slice(0, 10)}`, Number(f.orders ?? 0));
    }
  }

  const avgAround = (nm: number, fromDate: Date): number | null => {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < WINDOW; i++) {
      const d = new Date(fromDate);
      d.setDate(d.getDate() + i);
      const key = `${nm}|${d.toISOString().slice(0, 10)}`;
      if (byNmDate.has(key)) {
        sum += byNmDate.get(key)!;
        n++;
      }
    }
    return n > 0 ? sum / n : null;
  };

  const data: CardChange[] = rows.map((r) => {
    const dt = new Date(r.date);
    const beforeStart = new Date(dt);
    beforeStart.setDate(beforeStart.getDate() - WINDOW);
    const ordersBefore = avgAround(r.nm_id, beforeStart);
    const ordersAfter = avgAround(r.nm_id, dt);
    const effectPct =
      ordersBefore != null && ordersAfter != null && ordersBefore > 0
        ? ((ordersAfter - ordersBefore) / ordersBefore) * 100
        : null;
    return {
      id: r.id,
      nm_id: r.nm_id,
      article: r.article,
      change_type: r.change_type,
      note: r.note,
      old_value: r.old_value,
      new_value: r.new_value,
      date: String(r.date).slice(0, 10),
      ordersBefore: ordersBefore != null ? Math.round(ordersBefore * 10) / 10 : null,
      ordersAfter: ordersAfter != null ? Math.round(ordersAfter * 10) / 10 : null,
      effectPct: effectPct != null ? Math.round(effectPct * 10) / 10 : null,
    };
  });

  return NextResponse.json({ data, error: null });
}

export async function POST(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const b = await request.json().catch(() => ({}));
  if (!b.nm_id || !b.change_type) {
    return NextResponse.json({ error: "Нужны nm_id и тип изменения" }, { status: 400 });
  }
  const { error } = await db.from("card_changes").insert({
    nm_id: b.nm_id,
    article: b.article ?? null,
    change_type: b.change_type,
    note: b.note ?? null,
    old_value: b.old_value ?? null,
    new_value: b.new_value ?? null,
    date: b.date ?? new Date().toISOString().slice(0, 10),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Нужен id" }, { status: 400 });
  const { error } = await db.from("card_changes").delete().eq("id", Number(id));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
