import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { Account, Payment } from "@/lib/types";
import { loadFinanceStateServer } from "@/lib/finance/dbServer";
import { requireApiSession } from "@/lib/auth/apiGuard";

export async function POST(request: Request) {
  const gate = await requireApiSession(["director", "fin_director", "financier"]);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Серверная база не настроена" }, { status: 503 });
  try {
    const body = await request.json().catch(() => null) as { accounts?: Account[]; payments?: Payment[] } | null;
    const state = Array.isArray(body?.accounts) && Array.isArray(body?.payments)
      ? { accounts: body.accounts, payments: body.payments }
      : await loadFinanceStateServer();
    const accountRows = state.accounts.map((account) => ({
      id: account.id,
      name: account.name,
      type: account.type,
      currency: account.currency,
      balance: account.balance,
      updated_at: new Date().toISOString(),
    }));
    const paymentRows = state.payments.map((payment) => ({
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
    for (let offset = 0; offset < accountRows.length; offset += 500) {
      const result = await db.from("finance_accounts").upsert(accountRows.slice(offset, offset + 500), { onConflict: "id" });
      if (result.error) throw new Error(result.error.message);
    }
    for (let offset = 0; offset < paymentRows.length; offset += 500) {
      const result = await db.from("finance_payments").upsert(paymentRows.slice(offset, offset + 500), { onConflict: "id" });
      if (result.error) throw new Error(result.error.message);
    }
    return NextResponse.json({ ok: true, accounts: accountRows.length, payments: paymentRows.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось синхронизировать финансы" },
      { status: 500 },
    );
  }
}
