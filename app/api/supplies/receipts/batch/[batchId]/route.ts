import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";

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

  const { data: existing, error: findError } = await db.from("purchase_receipts").select("cabinet_id").eq("batch_id", batchId).limit(1).maybeSingle();
  if (findError) return NextResponse.json({ data: null, error: findError.message }, { status: 500 });
  if (!existing) return NextResponse.json({ data: null, error: "Поставка не найдена" }, { status: 404 });
  if (!(await hasCabinetAccess(existing.cabinet_id as string))) {
    return NextResponse.json({ data: null, error: "Нет доступа к кабинету" }, { status: 403 });
  }

  const now = new Date().toISOString();
  const { data, error } = await db.from("purchase_receipts")
    .update({ status: "received", received_qty: 0, received_at: now, updated_at: now })
    .eq("batch_id", batchId).eq("cabinet_id", existing.cabinet_id).eq("status", "expected")
    .select("id");
  if (error) return NextResponse.json({ data: null, error: error.message }, { status: 500 });

  return NextResponse.json({ data: { batchId, closed: (data ?? []).length }, error: null });
}
