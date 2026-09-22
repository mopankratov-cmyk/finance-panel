import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { isDdsActualPayment } from "@/lib/finance/bankDdsPayment";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireApiSession(["director", "fin_director", "financier"]);
  if (gate) return gate;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Некорректный идентификатор платежа" }, { status: 400 });

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const payment = await db.from("payments").select("id,status,import_source").eq("id", id).maybeSingle();
  if (payment.error) return NextResponse.json({ error: payment.error.message }, { status: 500 });
  if (!payment.data) return NextResponse.json({ error: "Платёж не найден" }, { status: 404 });
  if (!isDdsActualPayment({ status: payment.data.status, importSource: payment.data.import_source })) {
    return NextResponse.json({ error: "Через реестр ДДС можно удалить только банковский факт или операцию наличными" }, { status: 409 });
  }

  const result = await db.rpc("delete_dds_payment", { p_payment_id: id });
  if (result.error) {
    const missing = result.error.code === "42883" || /delete_dds_payment.*(?:does not exist|schema cache)/i.test(result.error.message);
    return NextResponse.json({
      error: missing
        ? "Безопасное удаление ещё не включено: владельцу нужно применить миграцию delete_dds_payment"
        : result.error.message,
    }, { status: missing ? 503 : 500 });
  }
  return NextResponse.json(result.data);
}
