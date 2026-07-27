import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { Account, Payment } from "@/lib/types";
import { requireApiSession } from "@/lib/auth/apiGuard";

export async function POST(request: Request) {
  const gate = await requireApiSession(["director", "finance"]);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Серверная база не настроена" }, { status: 503 });
  try {
    const body = await request.json() as { accounts?: Account[]; payments?: Payment[] };
    if (!Array.isArray(body.accounts) || !Array.isArray(body.payments)) {
      return NextResponse.json({ error: "Нужны массивы accounts и payments" }, { status: 400 });
    }
    const accountRows = body.accounts.map((account) => ({
      id: account.id,
      name: account.name,
      type: account.type,
      currency: account.currency,
      balance: account.balance,
      updated_at: new Date().toISOString(),
    }));
    const paymentRows = body.payments.map((payment) => ({
      id: payment.id,
      date: payment.date,
      name: payment.name,
      amount: payment.amount,
      category: payment.category,
      account_id: payment.accountId,
      status: payment.status,
      counterparty: payment.counterparty,
      comment: payment.comment ?? null,
      updated_at: new Date().toISOString(),
    }));
    const accountResult = accountRows.length
      ? await db.from("finance_accounts").upsert(accountRows, { onConflict: "id" })
      : { error: null };
    if (accountResult.error) throw new Error(accountResult.error.message);
    const paymentResult = paymentRows.length
      ? await db.from("finance_payments").upsert(paymentRows, { onConflict: "id" })
      : { error: null };
    if (paymentResult.error) throw new Error(paymentResult.error.message);
    return NextResponse.json({ ok: true, accounts: accountRows.length, payments: paymentRows.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось синхронизировать финансы" },
      { status: 500 },
    );
  }
}
