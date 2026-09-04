import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { consumedFactIds } from "@/lib/finance/factLinks";
import { buildLoanSchedule, type LoanTerms } from "@/lib/loans/scheduleModel";
import { canCloseRowsWithFact, derivedPaymentForRow, scheduleRowFromDb, type ScheduleRowKind, type ScheduleRowRecord, type ScheduleRowStatus } from "@/lib/loans/scheduleRows";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { Payment } from "@/lib/types";

export const dynamic = "force-dynamic";

// График кредита как сущность (docs/tz/dds-loan-schedule-entity.md, PR-B).
//  GET   ?loan=<id>                   — строки графика (все или одного кредита)
//  POST  { action: "build", terms }   — расчёт графика от условий, без записи
//  PUT   { loanId, accountId, companyId, currency, exchangeRate, creditorName, contractFileName?, rows }
//        — заменить ПЛАНОВЫЕ строки кредита; оплаченные и отменённые не трогаются;
//          плановые платежи календаря пересоздаются как производные от строк
//  PATCH { rowId, factId, confirmed } — закрыть строку фактом ДДС (I1, I2)

const KINDS = new Set<ScheduleRowKind>(["principal", "interest", "penalty", "fine", "fee"]);
const text = (value: unknown, max = 200) => String(value ?? "").trim().slice(0, max);
const isoDate = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")) ? String(value) : null;

async function gate() {
  return requireApiSession(["director", "finance"]);
}

function db() {
  return getSupabaseAdmin();
}

async function loadRows(client: NonNullable<ReturnType<typeof db>>, loanId?: string): Promise<ScheduleRowRecord[]> {
  const rows = await loadAllSupabasePages<Record<string, unknown>>((from, to) => {
    let query = client.from("loan_schedule_rows").select("*").order("due_date", { ascending: true }).order("kind", { ascending: true }).range(from, to);
    if (loanId) query = query.eq("loan_id", loanId);
    return query;
  }, { label: "График кредита", maxPages: 50 });
  return rows.map(scheduleRowFromDb);
}

export async function GET(request: NextRequest) {
  const denied = await gate();
  if (denied) return denied;
  const client = db();
  if (!client) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  try {
    const loanId = request.nextUrl.searchParams.get("loan") ?? undefined;
    return NextResponse.json({ rows: await loadRows(client, loanId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось прочитать график";
    // До применения миграции таблицы нет — отдаём пусто, интерфейс работает по меткам платежей.
    if (/does not exist|schema cache/i.test(message)) return NextResponse.json({ rows: [], missingTable: true });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = await gate();
  if (denied) return denied;
  const body = await request.json().catch(() => null) as { action?: string; terms?: Partial<LoanTerms> } | null;
  if (body?.action !== "build" || !body.terms) return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  const t = body.terms;
  const terms: LoanTerms = {
    principal: Number(t.principal ?? 0),
    startDate: isoDate(t.startDate) ?? "",
    dueDate: isoDate(t.dueDate) ?? "",
    annualRate: Number(t.annualRate ?? 0),
    monthlyRate: t.monthlyRate == null ? undefined : Number(t.monthlyRate),
    interestFrequency: t.interestFrequency === "quarterly" || t.interestFrequency === "at_maturity" ? t.interestFrequency : "monthly",
    paymentDay: t.paymentDay == null ? undefined : Math.min(31, Math.max(1, Number(t.paymentDay))),
    rateMode: t.rateMode === "flat_period" ? "flat_period" : "actual_days",
    dayCountBasis: t.dayCountBasis === 360 ? 360 : t.dayCountBasis === 366 ? 366 : 365,
    interestPayout: t.interestPayout === "capitalized" ? "capitalized" : "paid",
    reinvestEveryPeriods: t.reinvestEveryPeriods ? Math.max(1, Number(t.reinvestEveryPeriods)) : undefined,
    extraContributions: Array.isArray(t.extraContributions) ? t.extraContributions.filter((item) => isoDate(item?.date) && Number(item?.amount) > 0).map((item) => ({ date: String(item.date), amount: Number(item.amount) })) : [],
    tranches: Array.isArray(t.tranches) ? t.tranches.filter((item) => isoDate(item?.date) && Number(item?.amount) > 0).map((item) => ({ date: String(item.date), amount: Number(item.amount) })) : [],
  };
  if (!terms.startDate || !terms.dueDate || terms.principal <= 0) return NextResponse.json({ error: "Нужны сумма, дата выдачи и дата возврата" }, { status: 400 });
  return NextResponse.json({ rows: buildLoanSchedule(terms) });
}

type PutBody = {
  loanId?: string; accountId?: string; companyId?: string | null; currency?: string; exchangeRate?: number; creditorName?: string; contractFileName?: string;
  rows?: Array<{ id?: string; dueDate?: string; kind?: string; amountRub?: number; amountOriginal?: number | null; balanceBefore?: number | null; balanceAfter?: number | null; status?: string }>;
};

export async function PUT(request: Request) {
  const denied = await gate();
  if (denied) return denied;
  const client = db();
  if (!client) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const body = await request.json().catch(() => null) as PutBody | null;
  const loanId = text(body?.loanId, 80);
  const accountId = text(body?.accountId, 80);
  if (!loanId || !accountId || !Array.isArray(body?.rows)) return NextResponse.json({ error: "Нужны кредит, счёт и строки графика" }, { status: 400 });
  if (body.rows.length > 500) return NextResponse.json({ error: "Слишком много строк графика" }, { status: 413 });
  const currency = text(body.currency, 3) || "RUB";
  const exchangeRate = Number(body.exchangeRate) > 0 ? Number(body.exchangeRate) : 1;
  const companyId = text(body.companyId, 80) || null;

  const existing = await loadRows(client, loanId);
  const keep = existing.filter((row) => row.status !== "planned");
  const removedPlanned = existing.filter((row) => row.status === "planned");
  const keepIds = new Set(keep.map((row) => row.id));
  const incoming: ScheduleRowRecord[] = body.rows.flatMap((row) => {
    const dueDate = isoDate(row.dueDate);
    const kind = String(row.kind ?? "") as ScheduleRowKind;
    const amountRub = Math.round(Number(row.amountRub ?? 0) * 100) / 100;
    if (!dueDate || !KINDS.has(kind) || !(amountRub > 0)) return [];
    const reuse = row.id ? removedPlanned.find((item) => item.id === row.id) : undefined;
    return [{
      id: reuse ? reuse.id : randomUUID(),
      loanId, dueDate, kind, amountRub,
      amountOriginal: row.amountOriginal == null ? null : Math.round(Number(row.amountOriginal) * 100) / 100,
      currency,
      // Из формы может прийти «оплачено» без факта (как раньше: план и есть факт) или «отменено».
      status: (row.status === "paid" || row.status === "cancelled" ? row.status : "planned") as ScheduleRowStatus,
      paidByPaymentId: null,
      calendarPaymentId: reuse?.calendarPaymentId ?? null,
      originalDueDate: reuse?.originalDueDate ?? null,
      balanceBefore: row.balanceBefore == null ? null : Number(row.balanceBefore),
      balanceAfter: row.balanceAfter == null ? null : Number(row.balanceAfter),
    }];
  });
  // Строки, которые в оплаченные/отменённые не входят и в новый набор не попали, — удаляем вместе с их платежами.
  const incomingIds = new Set(incoming.map((row) => row.id));
  const toDelete = removedPlanned.filter((row) => !incomingIds.has(row.id) && !keepIds.has(row.id));
  const paymentsToDelete = toDelete.map((row) => row.calendarPaymentId).filter((id): id is string => Boolean(id));
  if (toDelete.length) {
    const deleted = await client.from("loan_schedule_rows").delete().in("id", toDelete.map((row) => row.id));
    if (deleted.error) return NextResponse.json({ error: deleted.error.message }, { status: 500 });
  }
  if (paymentsToDelete.length) {
    const deleted = await client.from("payments").delete().in("id", paymentsToDelete);
    if (deleted.error) return NextResponse.json({ error: deleted.error.message }, { status: 500 });
  }
  // Производные платежи: один на строку, с прежней меткой для календаря.
  const input = { loanId, creditorName: text(body.creditorName, 200) || "Кредитор", accountId, currency, exchangeRate, contractFileName: text(body.contractFileName, 255) || undefined };
  const payments = incoming.map((row) => derivedPaymentForRow(row, input));
  incoming.forEach((row, index) => { row.calendarPaymentId = payments[index].id; });
  const paymentRows = payments.map((payment) => ({
    id: payment.id, name: payment.name, amount: payment.amount, type: "expense", category: payment.category, account_id: payment.accountId,
    date: payment.date, status: payment.status, counterparty: payment.counterparty, comment: payment.comment ?? null, company_id: companyId,
  }));
  if (paymentRows.length) {
    const saved = await client.from("payments").upsert(paymentRows, { onConflict: "id" });
    if (saved.error) return NextResponse.json({ error: saved.error.message }, { status: 500 });
  }
  const scheduleRows = incoming.map((row) => ({
    id: row.id, loan_id: row.loanId, due_date: row.dueDate, kind: row.kind, amount_rub: row.amountRub, amount_original: row.amountOriginal, currency: row.currency,
    status: row.status, paid_by_payment_id: null, calendar_payment_id: row.calendarPaymentId, original_due_date: row.originalDueDate,
    balance_before: row.balanceBefore, balance_after: row.balanceAfter, updated_at: new Date().toISOString(),
  }));
  if (scheduleRows.length) {
    const saved = await client.from("loan_schedule_rows").upsert(scheduleRows, { onConflict: "id" });
    if (saved.error) return NextResponse.json({ error: saved.error.message }, { status: 500 });
  }
  return NextResponse.json({ rows: [...keep, ...incoming], payments });
}

export async function PATCH(request: Request) {
  const denied = await gate();
  if (denied) return denied;
  const client = db();
  if (!client) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const body = await request.json().catch(() => null) as { rowId?: string; rowIds?: string[]; factId?: string; confirmed?: boolean } | null;
  const rowIds = [...new Set([...(Array.isArray(body?.rowIds) ? body.rowIds : []), body?.rowId].map((value) => text(value, 80)).filter(Boolean))];
  const factId = text(body?.factId, 80);
  if (!rowIds.length || rowIds.length > 20 || !factId) return NextResponse.json({ error: "Нужны строки графика и факт" }, { status: 400 });
  const rowsResult = await client.from("loan_schedule_rows").select("*").in("id", rowIds);
  if (rowsResult.error) return NextResponse.json({ error: rowsResult.error.message }, { status: 500 });
  const rows = (rowsResult.data ?? []).map(scheduleRowFromDb);
  if (rows.length !== rowIds.length) return NextResponse.json({ error: "Строка графика не найдена" }, { status: 404 });
  const [factResult, allPayments] = await Promise.all([
    client.from("payments").select("id,status,amount").eq("id", factId).maybeSingle(),
    loadAllSupabasePages<{ id: string; comment: string | null }>((from, to) => client.from("payments").select("id,comment").not("comment", "is", null).like("comment", "%[%").order("id", { ascending: true }).range(from, to), { label: "Занятые факты", maxPages: 60 }),
  ]);
  if (factResult.error) return NextResponse.json({ error: factResult.error.message }, { status: 500 });
  const fact = factResult.data ? { id: String(factResult.data.id), status: String(factResult.data.status) as Payment["status"], amount: Number(factResult.data.amount) } : undefined;
  const check = canCloseRowsWithFact(rows, fact, consumedFactIds(allPayments), Boolean(body?.confirmed));
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 409 });
  const now = new Date().toISOString();
  const updated = await client.from("loan_schedule_rows").update({ status: "paid", paid_by_payment_id: factId, updated_at: now }).in("id", rowIds).eq("status", "planned").select("id");
  if (updated.error || (updated.data ?? []).length !== rowIds.length) return NextResponse.json({ error: updated.error?.message ?? "Строка уже закрыта" }, { status: 409 });
  for (const row of rows) {
    if (!row.calendarPaymentId) continue;
    // План в календаре отменяется с меткой [paid-by:] — так его читают календарь и сверка.
    const planned = await client.from("payments").select("comment").eq("id", row.calendarPaymentId).maybeSingle();
    const comment = `${String(planned.data?.comment ?? "").replace(/\s*\[paid-by:[^\]]+\]/g, "").trim()} [paid-by:${factId}]`.trim();
    await client.from("payments").update({ status: "cancelled", comment }).eq("id", row.calendarPaymentId);
  }
  return NextResponse.json({ ok: true, rows: rows.map((row) => ({ ...row, status: "paid", paidByPaymentId: factId })) });
}
