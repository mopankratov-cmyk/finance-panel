import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { audit } from "@/lib/audit/log";
import { isDdsActualPayment } from "@/lib/finance/bankDdsPayment";
import { validateOpiuPaymentPeriodDrafts, type OpiuPaymentPeriodDraft } from "@/lib/opiu/paymentPeriodAllocations";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const missingMigration = (message: string) => /opiu_payment_period|schema cache|does not exist|could not find the function/i.test(message);

async function paymentForAllocation(id: string) {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase не настроен");
  const result = await db.from("payments")
    .select("id,date,name,amount,category,status,import_source")
    .eq("id", id)
    .maybeSingle();
  if (result.error) throw result.error;
  return { db, payment: result.data };
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession(["director", "fin_director", "financier"]);
  if (gate) return gate;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Некорректный идентификатор платежа" }, { status: 400 });
  try {
    const { db, payment } = await paymentForAllocation(id);
    if (!payment) return NextResponse.json({ error: "Платёж не найден" }, { status: 404 });
    if (!isDdsActualPayment({ status: payment.status, importSource: payment.import_source }) || Number(payment.amount) >= 0) {
      return NextResponse.json({ error: "По месяцам ОПиУ можно распределить только фактический расход ДДС" }, { status: 409 });
    }
    const result = await db.from("opiu_payment_period_allocations")
      .select("id,payment_id,period_month,amount")
      .eq("payment_id", id)
      .order("period_month", { ascending: true });
    if (result.error) {
      return NextResponse.json({
        error: missingMigration(result.error.message)
          ? "Распределение по месяцам ещё не включено: примените миграцию 202609240004"
          : result.error.message,
      }, { status: missingMigration(result.error.message) ? 503 : 500 });
    }
    return NextResponse.json({
      payment: {
        id: payment.id,
        date: String(payment.date).slice(0, 10),
        name: payment.name,
        amount: Number(payment.amount),
        category: payment.category,
      },
      rows: (result.data ?? []).map((row) => ({
        id: row.id,
        paymentId: row.payment_id,
        month: String(row.period_month).slice(0, 7),
        amount: Number(row.amount),
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить распределение" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession(["director", "fin_director", "financier"]);
  if (gate) return gate;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Некорректный идентификатор платежа" }, { status: 400 });
  const body = await request.json().catch(() => null) as { rows?: OpiuPaymentPeriodDraft[] } | null;
  if (!body || !Array.isArray(body.rows)) return NextResponse.json({ error: "Передайте строки распределения" }, { status: 400 });
  try {
    const { db, payment } = await paymentForAllocation(id);
    if (!payment) return NextResponse.json({ error: "Платёж не найден" }, { status: 404 });
    if (!isDdsActualPayment({ status: payment.status, importSource: payment.import_source }) || Number(payment.amount) >= 0) {
      return NextResponse.json({ error: "По месяцам ОПиУ можно распределить только фактический расход ДДС" }, { status: 409 });
    }
    const rows = validateOpiuPaymentPeriodDrafts(Number(payment.amount), body.rows);
    const result = await db.rpc("save_opiu_payment_period_allocations", {
      p_payment_id: id,
      p_rows: rows,
    });
    if (result.error) {
      return NextResponse.json({
        error: missingMigration(result.error.message)
          ? "Распределение по месяцам ещё не включено: примените миграцию 202609240004"
          : result.error.message,
      }, { status: missingMigration(result.error.message) ? 503 : 400 });
    }
    await audit(request, await getServerSession(), {
      action: "payment.update",
      subject: `opiu-periods:${id}`,
      after: { rows },
    });
    return NextResponse.json({ ok: true, result: result.data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось сохранить распределение" }, { status: 400 });
  }
}

