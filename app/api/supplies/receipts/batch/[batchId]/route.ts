import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireApiSession } from "@/lib/auth/apiGuard";

export const dynamic = "force-dynamic";

// PATCH {action:"close"} — закрывает разом все ещё не тронутые (status='expected')
// строки поставки: "поставщик больше не довезёт" — не трогает уже принятые построчно.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ batchId: string }> }) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const { batchId } = await ctx.params;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ data: null, error: "Supabase не настроен" }, { status: 500 });

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "close") return NextResponse.json({ data: null, error: "Неизвестное действие" }, { status: 400 });

  const now = new Date().toISOString();
  const { data, error } = await db.from("purchase_receipts")
    .update({ status: "received", received_qty: 0, received_at: now, updated_at: now })
    .eq("batch_id", batchId).eq("status", "expected")
    .select("id");
  if (error) return NextResponse.json({ data: null, error: error.message }, { status: 500 });

  return NextResponse.json({ data: { batchId, closed: (data ?? []).length }, error: null });
}
