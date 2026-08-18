import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildForecastPayments, forecastScopeKey, mergeForecastPublication, type ForecastPublishRow, type ForecastPublishScope } from "@/lib/opiu/calendarForecastPublish";

const ISO_DATE = /^20\d{2}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;

export async function POST(request: Request) {
  const gate = await requireApiSession(["director", "finance"]);
  if (gate) return gate;
  const body = await request.json().catch(() => null) as { scope?: ForecastPublishScope; rows?: ForecastPublishRow[]; approved?: boolean } | null;
  const scope = body?.scope;
  const rows = body?.rows;
  if (!scope || body?.approved !== true || !Array.isArray(rows) || rows.length === 0 || rows.length > 100) {
    return NextResponse.json({ error: "Нужен подтверждённый непустой график поступлений" }, { status: 400 });
  }
  if (!(["wb", "ozon"] as const).includes(scope.marketplace) || !scope.cabinetId || !scope.companyId || !scope.accountId) {
    return NextResponse.json({ error: "Не выбраны маркетплейс, кабинет, компания или счёт" }, { status: 400 });
  }
  if (!Number.isInteger(scope.year) || !Number.isInteger(scope.month) || scope.month < 1 || scope.month > 12) {
    return NextResponse.json({ error: "Некорректный период прогноза" }, { status: 400 });
  }
  if (rows.some((row) => !row.key || !ISO_DATE.test(row.date) || !Number.isFinite(row.amount) || row.amount <= 0 || !["forecast", "financial_report"].includes(row.source))) {
    return NextResponse.json({ error: "В графике есть некорректная дата, сумма или источник" }, { status: 400 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const company = await db.from("companies").select("id").eq("id", scope.companyId).eq("is_active", true).maybeSingle();
  if (company.error || !company.data) return NextResponse.json({ error: "Компания не найдена или отключена" }, { status: 400 });
  const account = await db.from("finance_accounts").select("id").eq("id", scope.accountId).maybeSingle();
  if (account.error || !account.data) return NextResponse.json({ error: "Счёт получения не найден" }, { status: 400 });

  const scopeKey = forecastScopeKey(scope);
  const current = await db.from("payments")
    .select("id,date,name,amount,category,account_id,status,counterparty,comment")
    .eq("company_id", scope.companyId)
    .like("comment", `%[forecast-scope:${scopeKey}]%`);
  if (current.error) return NextResponse.json({ error: current.error.message }, { status: 500 });
  const existing = (current.data ?? []).map((row) => ({
    id: row.id, date: row.date, name: row.name, amount: Number(row.amount), category: row.category,
    accountId: row.account_id, status: row.status, counterparty: row.counterparty, comment: row.comment ?? undefined,
  }));
  const desired = buildForecastPayments(scope, rows);
  const merged = mergeForecastPublication(existing, desired, scopeKey);
  const payload = merged.map((payment) => ({
    id: payment.id, name: payment.name, amount: payment.amount, type: "income", category: payment.category,
    account_id: payment.accountId, date: payment.date, status: payment.status, counterparty: payment.counterparty,
    comment: payment.comment ?? null, company_id: scope.companyId,
  }));
  const saved = await db.from("payments").upsert(payload, { onConflict: "id" }).select("id");
  if (saved.error) return NextResponse.json({ error: saved.error.message }, { status: 500 });
  return NextResponse.json({ ok: true, published: desired.length, cancelled: merged.length - desired.length });
}
