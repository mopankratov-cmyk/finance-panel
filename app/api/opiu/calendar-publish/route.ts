import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadPlanningState } from "@/lib/planning/stateStore";
import { deriveWbPlanForMonth, selectWbPlanDocument } from "@/lib/opiu/wbPlan";
import { getOzonPayoutMapping } from "@/lib/opiu/ozonPayoutIdentity";
import { buildForecastPayments, forecastScopeKey, mergeForecastPublication, type ForecastPublishRow, type ForecastPublishScope } from "@/lib/opiu/calendarForecastPublish";
import { findPlanFactMatches, withCalendarFactLink } from "@/components/calendar/calendarPlan";
import type { Payment } from "@/lib/types";

const ISO_DATE = /^20\d{2}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
const SAFE_ID = /^[^\[\]\r\n]{1,160}$/;

function validDate(value: string) {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function hasApprovedPlan(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>, scope: ForecastPublishScope) {
  const snapshot = await loadPlanningState<{
    sales_plan_v1?: { wb?: Record<string, unknown>; ozon?: Record<string, unknown> };
  }>(db, scope.year);
  const monthKey = String(scope.month).padStart(2, "0");
  const plan = snapshot.data.sales_plan_v1?.[scope.marketplace]?.[scope.cabinetId];
  return scope.marketplace === "wb"
    ? deriveWbPlanForMonth(plan, monthKey).source === "approved_sales_plan"
    : selectWbPlanDocument(plan, monthKey)?.source === "approved_sales_plan";
}

function paymentFromRow(row: Record<string, unknown>): Payment {
  return {
    id: String(row.id),
    date: String(row.date),
    name: String(row.name ?? ""),
    amount: Number(row.amount),
    category: String(row.category ?? ""),
    accountId: String(row.account_id ?? ""),
    status: String(row.status) as Payment["status"],
    counterparty: String(row.counterparty ?? ""),
    comment: row.comment == null ? undefined : String(row.comment),
  };
}

export async function POST(request: Request) {
  const gate = await requireApiSession(["director", "finance"]);
  if (gate) return gate;
  const body = await request.json().catch(() => null) as { scope?: ForecastPublishScope; rows?: ForecastPublishRow[]; approved?: boolean } | null;
  const scope = body?.scope;
  const rows = body?.rows;
  if (!scope || body?.approved !== true || !Array.isArray(rows) || rows.length === 0 || rows.length > 100) {
    return NextResponse.json({ error: "Нужен подтверждённый непустой график поступлений" }, { status: 400 });
  }
  if (!(scope.marketplace === "wb" || scope.marketplace === "ozon") || ![scope.cabinetId, scope.companyId, scope.accountId].every((value) => SAFE_ID.test(value))) {
    return NextResponse.json({ error: "Не выбраны маркетплейс, кабинет, компания или счёт" }, { status: 400 });
  }
  if (!Number.isInteger(scope.year) || !Number.isInteger(scope.month) || scope.month < 1 || scope.month > 12) {
    return NextResponse.json({ error: "Некорректный период прогноза" }, { status: 400 });
  }
  const rowKeys = new Set(rows.map((row) => row.key));
  if (rowKeys.size !== rows.length || rows.some((row) =>
    !SAFE_ID.test(row.key)
    || !validDate(row.date)
    || !Number.isFinite(row.amount)
    || row.amount <= 0
    || Math.round(row.amount * 100) > Number.MAX_SAFE_INTEGER
    || !["forecast", "financial_report"].includes(row.source)
    || (row.source === "financial_report" && (!row.reportId || row.reportId !== row.key)))) {
    return NextResponse.json({ error: "В графике есть повторяющаяся или некорректная строка" }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const [company, account] = await Promise.all([
    db.from("companies").select("id").eq("id", scope.companyId).eq("is_active", true).maybeSingle(),
    db.from("finance_accounts").select("id").eq("id", scope.accountId).maybeSingle(),
  ]);
  if (company.error || !company.data) return NextResponse.json({ error: "Компания не найдена или отключена" }, { status: 400 });
  if (account.error || !account.data) return NextResponse.json({ error: "Счёт получения не найден" }, { status: 400 });
  if (!await hasApprovedPlan(db, scope)) {
    return NextResponse.json({ error: "План выбранного кабинета и месяца не утверждён" }, { status: 409 });
  }
  if (scope.marketplace === "ozon") {
    const mapping = getOzonPayoutMapping(scope.cabinetId);
    if (!mapping || mapping.companyId !== scope.companyId || mapping.receivingAccountId !== scope.accountId) {
      return NextResponse.json({ error: "Компания или счёт не соответствуют подтверждённой настройке кабинета Ozon" }, { status: 409 });
    }
  }

  const periodMarker = `[forecast-period:${scope.year}-${String(scope.month).padStart(2, "0")}]`;
  const priorScope = await db.from("payments")
    .select("id,company_id,account_id")
    .like("comment", `%[forecast-marketplace:${scope.marketplace}]%`)
    .like("comment", `%[forecast-cabinet:${scope.cabinetId}]%`)
    .like("comment", `%${periodMarker}%`)
    .eq("status", "planned");
  if (priorScope.error) return NextResponse.json({ error: "Не удалось проверить ранее опубликованный прогноз" }, { status: 500 });
  if ((priorScope.data ?? []).some((row) => row.company_id !== scope.companyId || row.account_id !== scope.accountId)) {
    return NextResponse.json({ error: "Для этого кабинета и месяца уже утверждены другая компания или счёт" }, { status: 409 });
  }

  const scopeKey = forecastScopeKey(scope);
  const current = await db.from("payments")
    .select("id,date,name,amount,category,account_id,status,counterparty,comment")
    .eq("company_id", scope.companyId)
    .like("comment", `%[forecast-scope:${scopeKey}]%`);
  if (current.error) return NextResponse.json({ error: "Не удалось прочитать опубликованный прогноз" }, { status: 500 });
  const existing = (current.data ?? []).map((row) => paymentFromRow(row));
  const desired = buildForecastPayments(scope, rows);
  const merged = mergeForecastPublication(existing, desired, scopeKey);
  const payload = merged.map((payment) => ({
    id: payment.id,
    name: payment.name,
    amount: payment.amount,
    type: "income",
    category: payment.category,
    account_id: payment.accountId,
    date: payment.date,
    status: payment.status,
    counterparty: payment.counterparty,
    comment: payment.comment ?? null,
    company_id: scope.companyId,
  }));
  const saved = await db.from("payments").upsert(payload, { onConflict: "id" }).select("id");
  if (saved.error) return NextResponse.json({ error: "Не удалось атомарно обновить платёжный календарь" }, { status: 500 });
  return NextResponse.json({ ok: true, published: desired.length, cancelled: merged.length - desired.length });
}

export async function PATCH(request: Request) {
  const gate = await requireApiSession(["director", "finance"]);
  if (gate) return gate;
  const body = await request.json().catch(() => null) as { plannedId?: string; factId?: string; mode?: "automatic" | "confirmed" } | null;
  const plannedId = String(body?.plannedId ?? "");
  const factId = String(body?.factId ?? "");
  if (!SAFE_ID.test(plannedId) || !SAFE_ID.test(factId) || plannedId === factId || !["automatic", "confirmed"].includes(String(body?.mode))) {
    return NextResponse.json({ error: "Некорректная связь плана и факта" }, { status: 400 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const result = await db.from("payments")
    .select("id,date,name,amount,category,account_id,status,counterparty,comment,company_id")
    .in("id", [plannedId, factId]);
  if (result.error) return NextResponse.json({ error: "Не удалось проверить план и факт" }, { status: 500 });
  const plannedRow = (result.data ?? []).find((row) => row.id === plannedId);
  const factRow = (result.data ?? []).find((row) => row.id === factId);
  if (!plannedRow || !factRow || factRow.status !== "done" || !["planned", "cancelled"].includes(plannedRow.status)) {
    return NextResponse.json({ error: "План или фактический платёж не найден" }, { status: 404 });
  }
  if (!plannedRow.company_id || plannedRow.company_id !== factRow.company_id) {
    return NextResponse.json({ error: "План и факт относятся к разным компаниям" }, { status: 409 });
  }
  const planned = paymentFromRow(plannedRow);
  const fact = paymentFromRow(factRow);
  const links = new Map<string, string | null>([[planned.id, plannedRow.company_id], [fact.id, factRow.company_id]]);
  const matching = findPlanFactMatches([planned, fact], links);
  const candidate = [...matching.matched, ...matching.review]
    .find((item) => item.planned.id === plannedId && item.fact.id === factId);
  if (!candidate || (body?.mode === "automatic" && !matching.matched.some((item) => item.fact.id === factId))) {
    return NextResponse.json({ error: "Платёж недостаточно похож на выбранный план" }, { status: 409 });
  }
  const linked = withCalendarFactLink(planned, factId);
  const saved = await db.from("payments")
    .update({ status: linked.status, comment: linked.comment ?? null })
    .eq("id", plannedId)
    .in("status", ["planned", "cancelled"])
    .select("id")
    .maybeSingle();
  if (saved.error || !saved.data) return NextResponse.json({ error: "Не удалось сохранить связь плана и факта" }, { status: 409 });
  return NextResponse.json({ ok: true, payment: linked });
}
