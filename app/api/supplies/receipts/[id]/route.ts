import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireApiSession } from "@/lib/auth/apiGuard";

export const dynamic = "force-dynamic";

// PATCH — либо отметить факт приёмки ({receivedQty}), либо править открытую строку
// ({expectedQty?, expectedAt?, warehouse?, note?}) — различается по наличию receivedQty.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const { id } = await ctx.params;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ data: null, error: "Supabase не настроен" }, { status: 500 });

  const body = (await req.json().catch(() => ({}))) as {
    receivedQty?: number; expectedQty?: number; expectedAt?: string; warehouse?: string; note?: string;
  };

  const { data: existing, error: findErr } = await db.from("purchase_receipts").select("status").eq("id", id).maybeSingle();
  if (findErr) return NextResponse.json({ data: null, error: findErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ data: null, error: "Позиция не найдена" }, { status: 404 });

  if (typeof body.receivedQty === "number") {
    if (existing.status !== "expected") return NextResponse.json({ data: null, error: "Эта позиция уже принята" }, { status: 400 });
    if (!Number.isFinite(body.receivedQty) || body.receivedQty < 0) return NextResponse.json({ data: null, error: "Некорректное количество" }, { status: 400 });
    const { data, error } = await db.from("purchase_receipts")
      .update({ received_qty: Math.round(body.receivedQty), received_at: new Date().toISOString(), status: "received", updated_at: new Date().toISOString() })
      .eq("id", id).select("*").single();
    if (error) return NextResponse.json({ data: null, error: error.message }, { status: 500 });
    return NextResponse.json({ data, error: null });
  }

  if (existing.status !== "expected") return NextResponse.json({ data: null, error: "Нельзя менять принятую позицию" }, { status: 400 });
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.expectedQty === "number" && body.expectedQty > 0) patch.expected_qty = Math.round(body.expectedQty);
  if (typeof body.expectedAt === "string") patch.expected_at = body.expectedAt || null;
  if (typeof body.warehouse === "string") patch.warehouse = body.warehouse || null;
  if (typeof body.note === "string") patch.note = body.note || null;
  if (Object.keys(patch).length === 1) return NextResponse.json({ data: null, error: "Нечего обновлять" }, { status: 400 });

  const { data, error } = await db.from("purchase_receipts").update(patch).eq("id", id).select("*").single();
  if (error) return NextResponse.json({ data: null, error: error.message }, { status: 500 });
  return NextResponse.json({ data, error: null });
}

// DELETE — только пока строка ещё не принята (status='expected'); принятые — история.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const { id } = await ctx.params;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ data: null, error: "Supabase не настроен" }, { status: 500 });

  const { data: existing, error: findErr } = await db.from("purchase_receipts").select("status").eq("id", id).maybeSingle();
  if (findErr) return NextResponse.json({ data: null, error: findErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ data: null, error: "Позиция не найдена" }, { status: 404 });
  if (existing.status !== "expected") return NextResponse.json({ data: null, error: "Нельзя удалить принятую позицию — это история" }, { status: 409 });

  const { error } = await db.from("purchase_receipts").delete().eq("id", id);
  if (error) return NextResponse.json({ data: null, error: error.message }, { status: 500 });
  return NextResponse.json({ data: { id: Number(id) }, error: null });
}
